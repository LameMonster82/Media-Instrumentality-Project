import type { RTCHosterWorkerInit, RTCUpdateMaxMsgSize } from "./types";
import rtcHosterWorker from "./rtcHost.worker?worker";

export default class RTCHost {
    private connection: RTCPeerConnection;
    private hosterWorker: Worker;
    public otherID: string;


    constructor(
        file: File,
        otherID: string,
        info: RTCConfiguration,
        onIceCandidate: (candidate: RTCIceCandidateInit) => void,
    ) {
        this.otherID = otherID;

        this.connection = new RTCPeerConnection(info);
        this.connection.onicecandidate = (event) => {
            if (event.candidate) onIceCandidate(event.candidate.toJSON());
        };

        const channel = this.connection.createDataChannel("data-channel");
        this.hosterWorker = rtcHosterWorker({ name: "I willingly give up your file to your friend. They asked nicely" });

        this.hosterWorker.postMessage({
            kind: "init",
            file,
            channel,
            maxSize: this.getMaxPacketSize()
        } as RTCHosterWorkerInit, [channel]);
    }

    public async getOffer() {
        const offer = await this.connection.createOffer();
        await this.connection.setLocalDescription(offer);

        return this.connection.localDescription!;
    }

    public async setSDP(sdp: RTCSessionDescriptionInit) {
        await this.connection.setRemoteDescription(new RTCSessionDescription(sdp));
        this.hosterWorker.postMessage({
            kind: "updateMsgSize",
            maxSize: this.getMaxPacketSize()
        } as RTCUpdateMaxMsgSize);
    }
    public async addICECandidates(candidate: RTCLocalIceCandidateInit) {
        await this.connection.addIceCandidate(new RTCIceCandidate(candidate));
    }

    public getMaxPacketSize() {
        return this.connection.sctp?.maxMessageSize ?? 65536;
    }
}