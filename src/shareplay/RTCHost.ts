import { RTC_CONFIG, type RtcSignal } from "./types";

type RangeRequest = { type: "requestRange"; offset: number; size: number };

/**
 * Host side of the media transfer. Each peer connects with a WebRTC data
 * channel ("media"); the host reads the requested byte range from its local
 * File and writes the raw bytes back over that channel.
 */
export class RTCHost {
    private file: File;
    private pcs = new Map<string, RTCPeerConnection>();

    onSignal: (to: string, data: RtcSignal) => void = () => { };

    constructor(file: File) {
        this.file = file;
    }

    /** Handle an offer/answer/ICE candidate coming from a peer. */
    async handleSignal(from: string, data: RtcSignal): Promise<void> {
        let pc = this.pcs.get(from);
        if (!pc) {
            pc = new RTCPeerConnection(RTC_CONFIG);
            this.pcs.set(from, pc);

            pc.onicecandidate = (e) => {
                if (e.candidate) this.onSignal(from, { ice: e.candidate.toJSON() });
            };
            pc.ondatachannel = (e) => this.attachChannel(e.channel, pc?.sctp?.maxMessageSize ?? 16384);
        }

        if ("sdp" in data) {
            await pc.setRemoteDescription(data.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (pc.localDescription)
                this.onSignal(from, { sdp: pc.localDescription.toJSON() });
        } else {
            await pc.addIceCandidate(data.ice);
        }
    }

    setFile(file: File): void {
        this.file = file;
    }

    private attachChannel(channel: RTCDataChannel, maxSize: number): void {
        channel.onmessage = async (e: MessageEvent<string>) => {
            if (typeof e.data !== "string") return;
            let msg: RangeRequest;
            try {
                msg = JSON.parse(e.data);
            } catch {
                return;
            }

            if (msg.type === "requestRange") {
                const size = Math.min(msg.size, maxSize)
                const blob = this.file.slice(msg.offset, msg.offset + size);
                const bytes = await blob.arrayBuffer();
                channel.send(bytes);
            }
        };
    }

    close(): void {
        for (const pc of this.pcs.values()) pc.close();
        this.pcs.clear();
    }
}
