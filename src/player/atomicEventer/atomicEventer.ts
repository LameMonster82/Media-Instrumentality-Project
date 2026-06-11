import type { Dictionary } from "@/core/types";
import type { AtomicEventerBuffers, DecodeTemplate, SerializableStuff } from "./types";

/**
 * A type of way to send data between threads. This method uses
 * a SharedArrayBuffer to communicate between threads without message queues.
 * Should be faster than postMessage or MessageChannels
 *
 * @param T type is the enum event youre going to send to the other thread
 * @param K type is the enum event youre goung to receive from the other thread
 *
 * I know the type definition may get a bit long but trust me on this one
 * @example AtomicEventer<
                SeekerResponseType,
                SeekerRequestType,
                typeof seekerResponseTemplates,
                typeof seekerRequestTemplates
            >;

            this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, { dataToSend: genericType })

 */
export default class AtomicEventer<
    SendEnum extends number,
    ReceiveEnum extends number,
    SendMap extends Record<SendEnum, Record<string, SerializableStuff>>,
    ReceiveMap extends Record<ReceiveEnum, Record<string, SerializableStuff>>,
> {
    /**
     * memory layout goes like
     *
     * byte 0   = Event notify. Notifies the receiver of a new event
     * byte 1   = Event type
     * byte ... = data
     */
    private bufferToSendTo: SharedArrayBuffer;
    private bufferToReceiveFrom: SharedArrayBuffer;
    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();
    private destroyed: boolean = false;
    private destroyedPromise: Promise<void>;
    private destroyedResolver: () => void;

    private readonly sendTemplate: SendMap;
    private readonly receiveTemplate: ReceiveMap;

    constructor(buffers: AtomicEventerBuffers | undefined, sendTemplate: SendMap, receiveTemplate: ReceiveMap) {
        this.bufferToReceiveFrom = buffers?.senderBuffer ?? new SharedArrayBuffer(512, { maxByteLength: 16384 });
        this.bufferToSendTo = buffers?.receiverBuffer ?? new SharedArrayBuffer(512, { maxByteLength: 16384 });

        this.sendTemplate = sendTemplate;
        this.receiveTemplate = receiveTemplate;

        const { promise, resolve } = Promise.withResolvers<void>();
        this.destroyedPromise = promise;
        this.destroyedResolver = resolve;
    }


    /**
     *  Send an event for a receiver to receive
     * @param type An event identifier. Usually an enum
     * @param data The data to send
     * @param typeOfData A template of the data that will be sent. Use the same template to receive the data back
     *
     */
    async sendEvent<E extends SendEnum>(type: E, data: DecodeTemplate<(typeof this.sendTemplate)[E]>, awaitable: boolean = false) {
        const typeOfData = this.sendTemplate[type] as Dictionary<SerializableStuff>;
        const entries = Object.entries(typeOfData);
        const totalEventSize = entries.map(e => {
            if (e[1].type === "str") {
                return this.textEncoder.encode(data[e[0]] as string).length + 4;
            }
            if (e[1].type === "byteArray") {
                return (data[e[0]] as Uint8Array).length + 4;
            }
            return e[1].size;
        }).reduce((a, b) => a + b);

        if (this.bufferToSendTo.byteLength < totalEventSize + 2) { // for the event stuff
            this.bufferToSendTo.grow(totalEventSize + 2);
        }

        const view = new DataView(this.bufferToSendTo);
        const intBuffer = new Int32Array(this.bufferToSendTo);
        const uintBuffer = new Uint8Array(this.bufferToSendTo);
        if (awaitable)
            await Atomics.waitAsync(intBuffer, 0, 1).value;
        else Atomics.wait(intBuffer, 0, 1);
        Atomics.store(intBuffer, 0, 0);
        view.setUint8(4, type as number);

        let offset = 5;
        for (const entry of entries) {
            switch (entry[1].type) {
                case "bool":
                    view.setUint8(offset, (data[entry[0]] as boolean) ? 1 : 0);
                    break;
                case "f64":
                    view.setFloat64(offset, data[entry[0]] as number);
                    break;
                case "u64":
                    view.setBigUint64(offset, data[entry[0]] as bigint);
                    break;
                case "i64":
                    view.setBigInt64(offset, data[entry[0]] as bigint);
                    break;

                case "str": {
                    const targetArray = new Uint8Array(this.bufferToSendTo);
                    const result = this.textEncoder.encode(data[entry[0]] as string);
                    targetArray.set(result, offset + 4);
                    view.setUint32(offset, result.byteLength);
                    offset += result.byteLength + 4;
                    break;
                }
                case "byteArray": {
                    const array = data[entry[0]] as Uint8Array;
                    uintBuffer.set(array, offset + 4);
                    view.setUint32(offset, array.length);
                    offset += array.length + 4;
                    break;
                }
                default:
                    console.error("what are you doing??????????????????//");
                    break;
            }

            if (entry[1].type !== "byteArray" && entry[1].type !== "str")
                offset += entry[1].size;
        }

        Atomics.store(intBuffer, 0, 1);
        Atomics.notify(intBuffer, 0);
    }


    /**
     * receive an event from the other AtomicEventer. It will call callback when that happens
     * @param eventMap A map that maps Enums to templates of the event data
     * @param callback A callback that to receive the event
     */
    receiveEvent<E extends ReceiveEnum>(callback: (type: E, data: DecodeTemplate<(typeof this.receiveTemplate)[E]>) => void) {
        const intArray = new Int32Array(this.bufferToReceiveFrom);
        const uintArray = new Uint8Array(this.bufferToReceiveFrom);
        const infiniteLoop = async () => {
            while (true) {
                if (this.destroyed) return;

                const waiter = Atomics.waitAsync(intArray, 0, 0);
                if (waiter.async) {
                    await Promise.race([waiter.value, this.destroyedPromise]);
                    if (this.destroyed) return;
                }

                const event = Atomics.load(uintArray, 4) as E;
                const data = this.readEvent<E>(this.receiveTemplate[event as E]);
                Atomics.store(intArray, 0, 0);
                Atomics.notify(intArray, 0);
                callback(event, data);
            }
        };

        infiniteLoop();
    }

    lockUntilEvent<E extends ReceiveEnum>(event: E): DecodeTemplate<(typeof this.receiveTemplate)[E]> {
        const intArray = new Int32Array(this.bufferToReceiveFrom);
        const uintArray = new Uint8Array(this.bufferToReceiveFrom);
        while (true) {
            Atomics.wait(intArray, 0, 0);
            const event = Atomics.load(uintArray, 4) as E;
            if (event === event) break;
        }

        const data = this.readEvent<E>(this.receiveTemplate[event as E]);
        Atomics.store(intArray, 0, 0);
        Atomics.notify(intArray, 0);

        return data;
    }

    getBuffers(): AtomicEventerBuffers {
        return { senderBuffer: this.bufferToSendTo, receiverBuffer: this.bufferToReceiveFrom };
    }

    destroy() {
        this.destroyed = true;
        this.destroyedResolver();
    }

    private readEvent<E extends ReceiveEnum>(template: Dictionary<SerializableStuff>): DecodeTemplate<(typeof this.receiveTemplate)[E]> {
        const view = new DataView(this.bufferToReceiveFrom);
        const uintBuffer = new Uint8Array(this.bufferToReceiveFrom);
        const entries = Object.entries(template);

        const data: Dictionary<unknown> = {};

        let offset = 5;
        for (const entry of entries) {
            const name = entry[0];
            switch (entry[1].type) {
                case "bool":
                    data[name] = view.getUint8(offset) > 0 ? true : false;
                    break;
                case "f64":
                    data[name] = view.getFloat64(offset);
                    break;
                case "u64":
                    data[name] = view.getBigUint64(offset);
                    break;
                case "i64":
                    data[name] = view.getBigInt64(offset);
                    break;

                case "str": {
                    const length = view.getUint32(offset);
                    const targetArray = new Uint8Array(this.bufferToReceiveFrom);
                    const tempArray = targetArray.slice(offset + 4, offset + 4 + length);
                    const result = this.textDecoder.decode(tempArray);
                    data[name] = result;
                    offset += length + 4;
                    break;
                }
                case "byteArray": {
                    const length = view.getUint32(offset);
                    data[name] = uintBuffer.slice(offset + 4, offset + 4 + length);
                    offset += length + 4;
                    break;
                }
                default:
                    console.error("what are you doing 2 ?????????????????//");
                    break;
            }

            if (entry[1].type !== "byteArray" && entry[1].type !== "str")
                offset += entry[1].size;
        }

        return data as DecodeTemplate<(typeof this.receiveTemplate)[E]>;
    }
}
