import type { RTCRequestData } from "./types";

export default class RTCHost {
    private file: File;
    private connection: RTCPeerConnection;
    private channel: RTCDataChannel | undefined;
    public otherID: string;
    private lastBuffer: Uint8Array<ArrayBuffer> | undefined;


    constructor(file: File, otherID: string, info: RTCConfiguration) {
        this.file = file;
        this.otherID = otherID;

        this.connection = new RTCPeerConnection(info);
    }

    public createChannel() {
        if (this.channel) return;
        this.channel = this.connection.createDataChannel("data-channel");
        this.channel.onopen = () => { console.log("channel opened"); };
        this.channel.onclose = () => { console.log("channel close"); };
        this.channel.onmessage = this.handleMessages.bind(this);
    }

    public async getOffer() {
        const offer = await this.connection.createOffer();
        await this.connection.setLocalDescription(offer);

        return this.connection.localDescription!;
    }

    public async setSDP(sdp: RTCSessionDescriptionInit) {
        await this.connection.setRemoteDescription(new RTCSessionDescription(sdp));
    }
    public async addICECandidates(candidate: RTCLocalIceCandidateInit) {
        await this.connection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    private async handleMessages(ev: MessageEvent<string>) {
        if (typeof ev.data !== "string") return;
        const data = JSON.parse(ev.data) as RTCRequestData;
        if (data.kind != "requestData") return;

        const maxMessageSize = this.connection.sctp?.maxMessageSize ?? 65565;

        const maxSize = Math.min(maxMessageSize - 8, data.size, this.file.size - data.offset);
        let targetBuffer = this.lastBuffer;
        if (!targetBuffer || targetBuffer.byteLength !== maxSize + 8) {
            targetBuffer = new Uint8Array(maxSize + 8);
            this.lastBuffer = targetBuffer;
        }

        const dataView = new DataView(targetBuffer.buffer);
        dataView.setBigUint64(0, BigInt(data.offset));

        const blob = this.file.slice(data.offset, data.offset + maxSize);
        const array = await blob.arrayBuffer();
        targetBuffer.set(new Uint8Array(array), 8);

        this.channel?.send(targetBuffer);
    }
}