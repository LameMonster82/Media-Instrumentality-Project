import type { RTCHosterWorkerInit, RTCBlockSize } from "./types";
import rtcHosterWorker from "./rtcHost.worker?worker";

export default class RTCHost {
    private connection: RTCPeerConnection[] = [];
    private maxMsgSize: number[] = [];
    private hosterWorker: Worker;
    public otherID: string;

    constructor(
        file: File,
        otherID: string,
        info: RTCConfiguration,
        connectionCount: number,
        onIceCandidate: (conIndex: number, candidate: RTCIceCandidateInit) => void,
    ) {
        this.otherID = otherID;

        const channels: RTCDataChannel[] = [];
        for (let i = 0; i < connectionCount; i++) {
            const connection = new RTCPeerConnection(info);
            connection.onicecandidate = (event) => {
                if (event.candidate) onIceCandidate(i, event.candidate.toJSON());
            };
            channels.push(connection.createDataChannel(`data-channel-${i}`, { ordered: false }));
            this.connection.push(connection);
            this.maxMsgSize.push(-1);
        }

        this.hosterWorker = rtcHosterWorker({ name: "I willingly give up your file to your friend. They asked nicely" });
        this.hosterWorker.postMessage({
            kind: "init",
            file,
            channels,
        } as RTCHosterWorkerInit, channels);
    }

    public async getOffer(conIndex: number) {
        const offer = await this.connection[conIndex].createOffer();
        await this.connection[conIndex].setLocalDescription(offer);

        return this.connection[conIndex].localDescription!;
    }

    public async setSDP(conIndex: number, sdp: RTCSessionDescriptionInit) {
        await this.connection[conIndex].setRemoteDescription(new RTCSessionDescription(sdp));
        this.maxMsgSize[conIndex] = this.connection[conIndex].sctp?.maxMessageSize ?? -1;
        if (this.maxMsgSize.some(s => s === -1)) return;

        this.hosterWorker.postMessage({
            kind: "blockSize",
            blockSize: Math.min(...this.maxMsgSize, 262144)
        } as RTCBlockSize);
    }
    public async addICECandidates(conIndex: number, candidate: RTCLocalIceCandidateInit) {
        await this.connection[conIndex].addIceCandidate(new RTCIceCandidate(candidate));
    }
}