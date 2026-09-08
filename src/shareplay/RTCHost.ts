import type { RTCDataRequesttAnswered, RTCRequestData } from "./types";

export default class RTCHost {
    private file: File;
    private connection: RTCPeerConnection;
    private channel: RTCDataChannel | undefined;
    public otherID: string;


    constructor(
        file: File,
        otherID: string,
        info: RTCConfiguration,
        onIceCandidate: (candidate: RTCIceCandidateInit) => void,
    ) {
        this.file = file;
        this.otherID = otherID;

        this.connection = new RTCPeerConnection(info);
        this.connection.onicecandidate = (event) => {
            if (event.candidate) onIceCandidate(event.candidate.toJSON());
        };
    }

    public createChannel() {
        if (this.channel) return;
        this.channel = this.connection.createDataChannel("data-channel");
        this.channel.onopen = () => { console.log("channel opened"); };
        this.channel.onclose = () => { console.log("channel close"); };
        this.channel.onmessage = this.handleMessages.bind(this);
        this.channel.binaryType = "arraybuffer";
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

        // Stay well under the negotiated max message size. A message of
        // exactly maxMessageSize is rejected by some browsers because of SCTP
        // framing overhead, and huge chunks overflow the send buffer with no
        // backpressure.
        const maxChunk = this.getMaxPacketSize();

        let remaining = data.size;
        let readOffset = data.offset;

        while (remaining > 0) {
            const size = Math.min(maxChunk, remaining, this.file.size - readOffset);
            if (size <= 0) break;

            // Backpressure: let the send buffer drain before sending more.
            while (this.channel.bufferedAmount > 8 * 1024 * 1024) {
                await new Promise(r => setTimeout(r, 0));
            }

            const blob = this.file.slice(readOffset, readOffset + size);
            try {
                this.channel.send(await blob.arrayBuffer());
            } catch {
                break;
            }

            readOffset += size;
            remaining -= size;
        }

        this.channel.send(JSON.stringify({
            kind: "requestAnswered"
        } as RTCDataRequesttAnswered));
    }
}