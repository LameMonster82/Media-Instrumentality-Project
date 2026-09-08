import type { RTCDataRequesttAnswered, RTCRequestData } from "./types";

export default class RTCHost {
    private file: File;
    private connection: RTCPeerConnection;
    private channel: RTCDataChannel | undefined;
    public otherID: string;


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
        this.channel.binaryType = "blob";
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

    public getMaxPacketSize() {
        return this.connection.sctp?.maxMessageSize ?? 65565;
    }

    private async handleMessages(ev: MessageEvent<string>) {
        if (typeof ev.data !== "string") return;
        if (!this.channel) return;
        const data = JSON.parse(ev.data) as RTCRequestData;
        if (data.kind !== "requestData") return;

        const maxMessageSize = this.getMaxPacketSize();


        let messageSizeLeft = data.size;
        let dataOffsetMessage = 0;

        while (messageSizeLeft > 0) {
            const readOffset = data.offset + dataOffsetMessage;
            const maxSize = Math.min(maxMessageSize, messageSizeLeft, this.file.size - readOffset);
            if (maxSize <= 0) break;
            const blob = this.file.slice(readOffset, readOffset + maxSize);
            try {
                this.channel.send(blob);
            } catch {
                break;
            }
            messageSizeLeft -= maxSize;
            dataOffsetMessage += maxSize;
        }

        while (true) {
            try {
                this.channel.send(JSON.stringify({
                    kind: "requestAnswered"
                } as RTCDataRequesttAnswered));
                break;
            } catch {
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }
}