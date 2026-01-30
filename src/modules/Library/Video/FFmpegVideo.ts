
import { type AllWorkerMessages, type AudioMediaStream, AudioTime, type ChapterInfo, type Dictionary, type FFmpegStreams, ffmpegUrl, FrameTime, type SubtitleMediaStream, type ThumnbnailDesc, type VideoMediaStream, WaitATick, type WorkerAssSubtitle, type WorkerAudioData, type WorkerAudioDataInit, type WorkerBitmapSubtitle, type WorkerChangeStream, type WorkerChapterInfo, type WorkerEmbedFont, type WorkerInitFFmpeg, type WorkerMediaInfo, type WorkerRequestAnswered, type WorkerRequestFfmpegSeek, type WorkerRequestFrames, type WorkerSubmitStreams, type WorkerVideoFrame, type WorkerVideoFrameBufferInit, type WorkerVideoFrameImageBitmap } from "../SomeTypes.js";
import { AssSubtitles } from "./AssSubtitleStreamTrack.js";
import { AudioStreamTrack } from "./AudioStreamTrack.js";
import { AudioStreamTrackNative } from "./AudioStreamTrackNative.js";
import { BitmapSubtitle, type BitmapSubtitleInfo } from "./BitmapSubtitle.js";
import { CreateControls, makeDraggable } from "./Controls.js";
import { SharedSeekableStream2 } from "./SharedSeekableStream2.js";
import { VideoStreamTrack } from "./VideoStreamTrack.js";

export class VideoPlayerFFmpeg {
    public video: HTMLVideoElement;

    private videoControls: HTMLDivElement | null = null;

    private videoTrackSelectLabel: HTMLLabelElement | null = null;
    private videoTrackSelect: HTMLSelectElement | null = null;
    private audioTrackSelect: HTMLSelectElement | null = null;
    private subtitleTrackSelect: HTMLSelectElement | null = null;
    private chapterDataList: HTMLDataListElement | null = null;

    private updateTimeCallback: (time: number) => void = () => { };

    private mediaDuration: number = 0;
    private currentTimeProp: number = 0;
    private isPlaying: boolean = false;
    private isSeeking = false;
    private dummyAudio: HTMLAudioElement | undefined;

    private framesBuffer: (WorkerVideoFrame | WorkerVideoFrameImageBitmap)[] = [];
    private audiosBuffer: (WorkerAudioData | WorkerAudioDataInit)[] = [];
    private ffmpegWorker: Worker | null = null;
    private driftAllowed: number = 500;
    private maxFuture: number = 10000;

    private controlsAreVisible: boolean = true;

    /** Time in Seconds */
    public get currentTime(): number {
        return this.currentTimeProp;
    }

    private set currentTime(v: number) {
        this.currentTimeProp = v;
        if(this.controlsAreVisible)
            this.updateTimeCallback(v);
    }

    /** Time in Milliseconds */
    private startTimestamp: number = 0;
    /** Time in Milliseconds */
    private lastTimestamp: number = 0;
    private availableStreams: FFmpegStreams[] = [];
    private mediaStream: MediaStream = new MediaStream();
    private nextFrame: boolean = false;
    private fileName: string | undefined;
    private mediaInfo: Dictionary<string> = {};
    private chapters: ChapterInfo[] = [];
    private frontIcon: HTMLElement | null = null;
    private hasVideo: boolean = false;
    private hasAudio: boolean = false;

    /* when any data is added to the buffers */
    private bufferInsertedResolves: (() => void)[] = [];
    /* When any data is used */
    private bufferPopedResolves: (() => void)[] = [];
    /* when done seeking */
    private seekingResolves: (() => void)[] = [];
    /* when video frame is popped or displayed */
    private videoFramePopedResolves: (() => void)[] = [];
    /* when audio frame is popped or displayed */
    private audioFramePopedResolves: (() => void)[] = [];
    /* when video starts playing */
    private videoStartResolves: (() => void)[] = [];

    private videoFrameWriting: Promise<void> = Promise.resolve();
    private audioFrameWriting: Promise<void> = Promise.resolve();

    private streamDecoderQueue: number[] = [];

    constructor() {
        // Create the video element
        this.video = document.createElement('video');
        this.video.playsInline = true;
        this.video.srcObject = this.mediaStream;

        window.addEventListener('unload', this.Destroy.bind(this));
    }

    async GetFileReady(file: string, fileName?: string, thumbnailUrl?: string, inCaseWeAddAContainer?: (element: HTMLElement) => void, bufferSize: number = 32768) {
        if (!this.videoControls) throw new Error("No Controls");
        this.fileName = fileName ?? file;

        let resolvPlayer = () => { };

        this.video.addEventListener("playPause", () => {
            if (this.isPlaying) {
                this.startTimestamp = performance.now() - this.lastTimestamp;
                this.video.play();
                Resolve(this.videoStartResolves);
            } else {
                this.video.pause();
            }

            this.updateMediaSessionPos();

            //this.ffmpegWorker!.postMessage({ type: "playPause", data: this.isPlaying });
        });

        this.ffmpegWorker = new Worker(ffmpegUrl, { type: 'module', name: "I tell ffmpeg to do the work" });
        this.ffmpegWorker.onmessage = async (e: MessageEvent<AllWorkerMessages>) => {
            switch (e.data.kind) {
                case "streams":
                    if (this.availableStreams.length > 0) {
                        for (const i in e.data.streams) {
                            const index = parseInt(i);
                            this.availableStreams[index] ??= e.data.streams[index];
                            this.availableStreams[index].isUsed = e.data.streams[index].isUsed;
                        }
                        return;
                    } else {
                        this.InitStreams(e.data);
                    }

                    return resolvPlayer();
                case "requestAnswered": { // Got Media Frame?
                    return Resolve(this.bufferInsertedResolves);
                }
                case "videoFrame":
                    //case "videoConstructor":
                case "FrameBitmapConstructor":
                    return this.AddVideoFrame(e.data);
                case "audioData":
                case "audioDataInit":
                    return this.AddAudioData(e.data);
                case "seek":
                    return console.error("Uhh stuff moved");
                case "requestData":
                    return console.error("Uhh stuff moved2");
                case "doneSeeking":
                    return this.SeekFinished(true);
                case "mediaInfo":
                    return this.AddMediaInfo(e.data, thumbnailUrl);
                case "chapterInfo":
                    return this.AddChapter(e.data);
                case "subtitleBitmap":
                    return this.AddSubtitleBitmap(e.data);
                case "subtitleAss":
                    return this.AddSubtitleAss(e.data, inCaseWeAddAContainer);
                case "fontFile":
                    return this.AddFontFile(e.data);
                case "portPost": {
                    e.data.port.onmessage = (j) => {
                        this.ffmpegWorker!.onmessage!(j)
                    }
                    break;
                }
                case "decoderQueueSize": {
                    while (e.data.streamIndex > this.streamDecoderQueue.length) {
                        this.streamDecoderQueue.push(0);
                    }
                    this.streamDecoderQueue[e.data.streamIndex] = e.data.queue;
                }

            }
        };
        this.ffmpegWorker.onerror = (e) => {
            console.error('Worker error:', e);
        };

        this.ffmpegWorker.postMessage({
            kind: "initFfmpeg",
            url: file,
            bufferSize: bufferSize,
        } as WorkerInitFFmpeg);

        return new Promise<void>(res => resolvPlayer = res);
    }

    private async InitStreams(streams: WorkerSubmitStreams, loading?: SVGSVGElement) {
        this.availableStreams = streams.streams;

        console.log(this.availableStreams);

        const videoStream = this.availableStreams.find(stream => stream.type == "video" && stream.isUsed);
        if (videoStream) {
            this.hasVideo = true;
            await this.createVideoStream(videoStream as VideoMediaStream);
        } else if (this.video.poster.length <= 0 && false) {
            const musicSymbol = document.createElement('span');
            musicSymbol.classList.add('zoomin', 'material-symbols-rounded');
            musicSymbol.style.position = 'fixed';
            musicSymbol.style.color = '#d3bcfd';
            musicSymbol.style.fontSize = '256px';
            musicSymbol.style.textAlign = 'center';
            musicSymbol.style.lineHeight = '90vh';
            musicSymbol.style.zIndex = "1002";
            musicSymbol.innerHTML = 'audio_file';
            musicSymbol.style.pointerEvents = "none";
            this.video.parentElement?.appendChild(musicSymbol);
            this.frontIcon = musicSymbol;
        }

        const audioStream = this.availableStreams.find(stream => stream.type == "audio" && stream.isUsed);
        if (audioStream && audioStream.type === "audio") {
            this.hasAudio = true;
            this.createAudioStream(audioStream as AudioMediaStream);
        }



        this.PopulateTrackSelector(this.availableStreams);

        this.SetupMedia();

        //this.video.dispatchEvent(new Event("play"));
        //this.video.dispatchEvent(new Event("playPause"));
        this.startTimestamp = performance.now();
        //this.lastTimestamp = performance.now();

        this.bufferingLoop();
        this.audioLoop();
        this.videoLoop();

        this.video.play().then(res => {
            loading?.remove();
            this.videoControls!.style.display = "";
        }, rej => {
            const playButton = document.createElement('span');
            playButton.classList.add('zoomin', 'material-symbols-rounded');
            playButton.style.position = 'fixed';
            playButton.style.color = 'white';
            playButton.style.fontSize = '256px';
            playButton.style.textAlign = 'center';
            playButton.style.lineHeight = '90vh';
            playButton.style.zIndex = "1003";
            playButton.onclick = () => {
                playButton.remove();
                this.video.play();
            };
            playButton.innerHTML = 'play_arrow';
            this.video.parentElement?.appendChild(playButton);
        })
    }

    private AddVideoFrame(data: WorkerVideoFrame | WorkerVideoFrameImageBitmap) {
        if (!this.isSeeking) {
            this.framesBuffer.push(data);
            //this.framesBuffer.sort((a, b) => a.videoFrame.timestamp - b.videoFrame.timestamp)
            console.log(`Audio: ${this.audiosBuffer.length} and Video ${this.framesBuffer.length}`)
        } else {
            if (data.kind === "videoFrame")
                data.videoFrame.close();
        }
    }

    private AddAudioData(data: WorkerAudioDataInit | WorkerAudioData) {
        if (!this.isSeeking) {
            this.audiosBuffer.push(data);
            this.audiosBuffer.sort((a, b) => {
                const aTime = a.kind === "audioData" ? a.audioData.timestamp : a.dataBuffer.timestamp;
                const bTime = b.kind === "audioData" ? b.audioData.timestamp : b.dataBuffer.timestamp;
                return aTime - bTime;
            })
            console.log(`Audio: ${this.audiosBuffer.length} and Video ${this.framesBuffer.length}`)
        } else {
            if (data.kind === "audioData")
                data.audioData.close()
        }
    }

    private SeekFinished(evictBuffers: boolean) {
        if (evictBuffers) {
            for (const frame of this.framesBuffer) {
                if (frame.kind === "videoFrame")
                    frame.videoFrame.close();
            }
            for (const audio of this.audiosBuffer) {
                if (audio.kind === "audioData")
                    audio.audioData.close();
            }
            this.framesBuffer.length = 0;
            this.audiosBuffer.length = 0;
        } else {
            this.framesBuffer = this.framesBuffer.filter(frame => {
                const { timestamp, duration } = FrameTime(frame);
                const shouldKeep = timestamp / 1000000 >= this.currentTime;
                if (!shouldKeep && frame.kind === "videoFrame") {
                    frame.videoFrame.close();
                }
                return shouldKeep;
            });

            this.audiosBuffer = this.audiosBuffer.filter(audio => {
                const { timestamp } = AudioTime(audio);
                const shouldKeep = timestamp / 1000000 >= this.currentTime;
                if (!shouldKeep && audio.kind === "audioData") {
                    audio.audioData.close();
                }
                return shouldKeep;
            });
        }

        this.lastTimestamp = this.currentTime * 1000;
        this.startTimestamp = performance.now() - this.lastTimestamp;
        this.isSeeking = false;
        this.isPlaying = true;
        for (const stream of this.availableStreams) {
            stream.mediaStream?.SeekTo(this.currentTime, !evictBuffers);
        }

        Resolve(this.seekingResolves);
        Resolve(this.bufferPopedResolves);
        Resolve(this.videoStartResolves);
    }

    private AddMediaInfo(mediaInfo: WorkerMediaInfo, thumbnailUrl?: string) {
        this.mediaInfo = mediaInfo.data;
        document.title = this.mediaInfo["title"] ?? this.mediaInfo["TITLE"] ?? this.fileName;

        const artworks: MediaImage[] = thumbnailUrl ? [{ src: thumbnailUrl }] : [];

        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.mediaInfo["title"] ?? this.mediaInfo["TITLE"] ?? this.fileName,
            artist: this.mediaInfo["artist"] ?? this.mediaInfo["ARTIST"] ?? undefined,
            album: this.mediaInfo["album"] ?? this.mediaInfo["ALBUM"] ?? undefined,
            artwork: artworks
        });
    }

    private AddChapter(chapter: WorkerChapterInfo) {
        this.chapters.push(chapter.data);
        const chapterOption = document.createElement("option");
        const time = chapter.data.start;
        chapterOption.value = time.toString();
        chapterOption.style.left = `calc(${time} / var(--video-duration) * 100% - 1px)`;
        chapterOption.title = chapter.data.data["title"] ?? chapter.data.index;
        chapterOption.onclick = () => {
            this.seekTo(time);
        };
        this.chapterDataList?.appendChild(chapterOption);
    }

    private AddSubtitleBitmap(subtitle: WorkerBitmapSubtitle) {
        let stream = this.availableStreams[subtitle.streamIndex];
        if (!stream.mediaStream) {
            this.availableStreams[subtitle.streamIndex].mediaStream = new BitmapSubtitle(this.video, stream.metadata);
        }
        const data: BitmapSubtitleInfo = {
            image: subtitle.image,
            startTime: 0,
            endTime: this.mediaDuration,
            positionX: subtitle.x,
            positionY: subtitle.y,
            width: subtitle.width,
            height: subtitle.height
        };
        (stream.mediaStream as BitmapSubtitle).WriteData(data);

    }

    private AddSubtitleAss(subtitle: WorkerAssSubtitle, inCaseWeAddAContainer?: (element: HTMLElement) => void) {
        let stream = this.availableStreams[subtitle.streamIndex] as SubtitleMediaStream;
        if (!stream.assHeader) {
            console.warn("ASS subtitles without a header??");
            return;
        }
        if (!stream.mediaStream) {
            const assClass = new AssSubtitles(this.video, stream.assHeader);
            this.availableStreams[subtitle.streamIndex].mediaStream = assClass;
            if (inCaseWeAddAContainer) {
                inCaseWeAddAContainer(assClass.container);
            } else {
                this.video.parentElement?.appendChild(assClass.container);
            }
            if (this.isPlaying)
                this.video.dispatchEvent(new Event("play"));
        }
        (stream.mediaStream as AssSubtitles).WriteData(subtitle.dialog);
    }

    private AddFontFile(fontInfo: WorkerEmbedFont) {
        let stuff: {
            family: string;
            weight?: string;
            style?: string;
        };
        if (fontInfo.fontFamily) {
            stuff = {
                family: fontInfo.fontFamily
            };
        } else {
            stuff = parseFontFilename(fontInfo.fileName);
        }

        const font = new FontFace(stuff.family, fontInfo.data as any, {
            style: stuff.style,
            weight: stuff.weight
        });
        // @ts-ignore
        document.fonts.add(font);
    }

    private async bufferingLoop() {
        while (true) {
            if (this.isSeeking)
                await Wait(this.seekingResolves);

            if (!this.AreBuffersLow())
                await Wait(this.bufferPopedResolves);

            if (!this.ffmpegWorker) return;

            if (this.AreBuffersLow()) {
                this.ffmpegWorker?.postMessage({ kind: "requestFrames" } as WorkerRequestFrames);
                await Wait(this.bufferInsertedResolves);
            } else {
                await WaitATick();
            }


        }
    }

    private AreBuffersLow() {
        return this.IsVideoBufferLow() || this.IsAudioBufferLow();


        if (this.hasVideo) {
            return this.framesBuffer.length < 5 ||
            (this.hasAudio && this.audiosBuffer.length < 16)
        }

        if (this.hasAudio) {
            return this.audiosBuffer.length < 512
        }

        return false;
    }

    private IsVideoBufferLow() {
        if (!this.hasVideo) return false;
        const activeStream = this.availableStreams.find(s => s.isUsed && s.type == "video");
        let queue = 0;
        if (activeStream) {
            queue = this.streamDecoderQueue[activeStream.index] ?? 0;
        }

        return this.framesBuffer.length + queue < 33 // Random chatgpt value
    }

    private IsAudioBufferLow() {
        if (!this.hasAudio) return false;
        const activeStream = this.availableStreams.find(s => s.isUsed && s.type == "audio");
        let queue = 0;
        if (activeStream) {
            queue = this.streamDecoderQueue[activeStream.index] ?? 0;
        }

        return this.audiosBuffer.length + queue < 33
    }

    private async audioLoop() {
        while (true) {
            if (this.isSeeking)
                await Wait(this.seekingResolves);

            if (!this.isPlaying)
                await Wait(this.videoStartResolves);

            if (this.audiosBuffer.length <= 0) {
                await Wait(this.bufferInsertedResolves);
                continue;
            }

            const now = performance.now();

            let data = this.audiosBuffer[0];
            const { timestamp, duration } = AudioTime(data);

            if (now - this.startTimestamp >= (timestamp - duration) / 1000) {
                const time = timestamp / 1000000;
                this.currentTime = Math.max(time, this.currentTime);
                this.lastTimestamp = timestamp / 1000;
                if (now - this.startTimestamp > (timestamp + duration + this.driftAllowed) / 1000) {
                    console.warn("Audio running slow !!!");
                    this.startTimestamp = now - this.lastTimestamp;
                }

                let streamTrack = this.availableStreams[data.streamIndex].mediaStream;
                if (!streamTrack || (!(streamTrack instanceof AudioStreamTrack) && !(streamTrack instanceof AudioStreamTrackNative))) {
                    streamTrack = this.createAudioStream(this.availableStreams[data.streamIndex]);
                }

                await this.audioFrameWriting;
                data = this.audiosBuffer.shift()!;
                this.audioFrameWriting = streamTrack.WriteData(data, this.currentTime);


                Resolve(this.bufferPopedResolves);
                //await new Promise(res => setTimeout(res, duration));
            } else {
                await WaitATick();
            }


            //await new Promise(res => setTimeout(res, 0));

        }
    }

    private async videoLoop() {
        while (true) {
            if (this.isSeeking) {
                console.log("Waiting for seek to finish");
                await Wait(this.seekingResolves);
            }


            if (!this.isPlaying) {
                console.log("Waiting for video to start");
                await Wait(this.videoStartResolves);
            }

            if (this.framesBuffer.length <= 0) {
                console.log("Waiting for video frame");
                await Wait(this.bufferInsertedResolves);
                continue;
            }

            const now = performance.now();

            let frame = this.framesBuffer[0];
            const { timestamp, duration } = FrameTime(frame);

            if (now - this.startTimestamp >= timestamp / 1000) {
                const time = timestamp / 1000000;
                this.currentTime = Math.max(time, this.currentTime);
                this.lastTimestamp = timestamp / 1000;
                if (now - this.startTimestamp > (timestamp + duration + this.driftAllowed) / 1000) {
                    console.warn("Video running slow !!!");
                    this.startTimestamp = now - this.lastTimestamp;
                }

                let streamTrack = this.availableStreams[frame.streamIndex].mediaStream;
                if (!streamTrack || !(streamTrack instanceof VideoStreamTrack)) {
                    streamTrack = await this.createVideoStream(this.availableStreams[frame.streamIndex]);
                }

                await this.videoFrameWriting;
                frame = this.framesBuffer.shift()!;
                this.videoFrameWriting = (streamTrack as VideoStreamTrack).WriteData(frame);

                if (this.nextFrame) {
                    this.nextFrame = false;
                    this.video.pause();
                }
                Resolve(this.bufferPopedResolves);
                //await new Promise(res => setTimeout(res, duration));
            } else {
                await WaitATick();
            }


        }
    }

    private async createVideoStream(streamInfo: FFmpegStreams) {
        const videoPlayer = new VideoStreamTrack();
        await videoPlayer.Initialize();


        for (const streaStr in this.availableStreams) {
            const index2 = parseInt(streaStr);
            const player = this.availableStreams[index2];
            if (player.type === "video" && player.mediaStream) {
                this.mediaStream.removeTrack(player.mediaStream.GetTrack());
            }
        }
        this.mediaDuration = Math.max(streamInfo.duration, this.mediaDuration);
        this.video.dispatchEvent(new Event('timeDurationUpdate'));
        this.availableStreams[streamInfo.index].mediaStream = videoPlayer;
        this.mediaStream.addTrack(videoPlayer.GetTrack());
        return videoPlayer;
    }

    private createAudioStream(streamInfo: FFmpegStreams) {
        let audioPlayer: AudioStreamTrack | AudioStreamTrackNative;
        if (AudioStreamTrackNative.IsSupported()) {
            audioPlayer = new AudioStreamTrackNative();
        } else {
            // @ts-ignore
            audioPlayer = new AudioStreamTrack(streamInfo.index, streamInfo.sampleRate, streamInfo.channels);
        }

        for (const streaStr in this.availableStreams) {
            const index2 = parseInt(streaStr);
            const player = this.availableStreams[index2];
            if (player.type === "audio" && player.mediaStream) {
                this.mediaStream.removeTrack(player.mediaStream.GetTrack());
            }
        }
        this.mediaDuration = Math.max(streamInfo.duration, this.mediaDuration);
        this.video.dispatchEvent(new Event('timeDurationUpdate'));
        this.availableStreams[streamInfo.index].mediaStream = audioPlayer;
        this.mediaStream.addTrack(audioPlayer.GetTrack());
        return audioPlayer;
    }

    private createBitmapSubtitleStream(streamInfo: FFmpegStreams) {
        const subtitlePlayer = new BitmapSubtitle(this.video, streamInfo.metadata);
        for (const streaStr in this.availableStreams) {
            const index = parseInt(streaStr);
            const player = this.availableStreams[index];
            if (player.type === "subtitle" && player.mediaStream) {
                player.mediaStream.Enable(false);
            }
        }
        this.mediaDuration = Math.max(streamInfo.duration, this.mediaDuration);
        this.video.dispatchEvent(new Event('timeDurationUpdate'));
        this.availableStreams[streamInfo.index].mediaStream = subtitlePlayer;
        return subtitlePlayer;
    }

    private SetupMedia() {
        const durationSeconds = 60;
        const sampleRate = 44100;
        const bitsPerSample = 16;
        const channels = 1;

        // get MediaSession working by generating a silent wav
        // It needs to be about a minute long for chrome to decide to use it for MediaSession
        const base64Audio = generateSilentWave(durationSeconds, sampleRate, bitsPerSample, channels);
        this.dummyAudio = new Audio(base64Audio);
        this.dummyAudio.loop = true;
        this.dummyAudio.controls = true;


        //dummyAudio.volume = 0;

        if ('mediaSession' in navigator) {

            // Set media action handlers
            navigator.mediaSession.setActionHandler('play', () => {
                this.dummyAudio?.play();
                this.video.play();
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                this.dummyAudio?.pause();
                this.video.pause();
            });

            let defaultSkipTime = 10;

            navigator.mediaSession.setActionHandler('seekbackward', (event) => {
                const skipTime = event.seekOffset || defaultSkipTime;
                this.seekTo(this.currentTime - skipTime);
                this.updateMediaSessionPos();
            });

            navigator.mediaSession.setActionHandler('seekforward', (event) => {
                const skipTime = event.seekOffset || defaultSkipTime;
                this.seekTo(this.currentTime + skipTime);
                this.updateMediaSessionPos();
            });

            navigator.mediaSession.setActionHandler('seekto', (event) => {
                const skipTime = event.seekTime || 0;
                this.seekTo(skipTime);
                this.updateMediaSessionPos();
            });

            //navigator.mediaSession.setActionHandler('previoustrack', () => {

            //});

            //navigator.mediaSession.setActionHandler('nexttrack', () => {

            //});


            this.video.addEventListener("playPause", () => {
                if (this.isPlaying) {
                    this.dummyAudio?.play();
                    navigator.mediaSession.playbackState = "playing";
                } else {
                    this.dummyAudio?.pause();
                    navigator.mediaSession.playbackState = "paused";
                }
            });
        }
    }

    public CreatePlayerControls(): HTMLDivElement {
        if (this.videoControls) return this.videoControls;

        const controls = CreateControls();
        this.video.addEventListener('timeDurationUpdate', () => {
            controls.progressBarRange.max = this.mediaDuration.toString();
            controls.progressBarHold.style.setProperty("--video-duration", this.mediaDuration.toString());
        });

        controls.progressBarRange.addEventListener('mousemove', (e) => {
            controls.progressHoverRange.classList.add('active');
            const rect = controls.progressBarRange.getBoundingClientRect();
            const rect2 = controls.progressHoverRange.getBoundingClientRect();
            const clickPosition = (e.clientX - rect.left) / rect.width;  // 0 to 1
            const potentialValue = clickPosition * (this.mediaDuration - 0) + 0;
            let chapterName = this.chapters.find(chapter => chapter.start <= potentialValue && chapter.end >= potentialValue)?.data["title"] ?? "";
            if (chapterName.length > 0) chapterName = chapterName + "\n";
            controls.progressHoverRange.textContent = chapterName + formatSeconds(potentialValue, hasHours).time;
            controls.progressHoverRange.style.left = `${e.offsetX - rect2.width / 2}px`;

        });

        controls.progressBarRange.addEventListener('mouseleave', () => {
            //progressHoverRange.style.display = 'none';
            controls.progressHoverRange.classList.remove('active');
        });

        this.videoTrackSelect = controls.videoSelect;
        this.videoTrackSelectLabel = controls.videoLabel;
        this.audioTrackSelect = controls.audioSelect;
        this.subtitleTrackSelect = controls.subtitleSelect;

        this.videoControls = controls.controls;

        // Play/Pause functionality
        controls.playButton.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;

            controls.playIcon.textContent = this.isPlaying ? 'pause' : 'play_arrow';
            this.video.dispatchEvent(new Event("playPause"));
        });

        this.video.addEventListener("pause", () => {
            if (!this.isPlaying) return;
            controls.playButton.click();
        });

        this.video.addEventListener("play", () => {
            if (this.isPlaying) return;
            controls.playButton.click();
        });

        let lastProgreess = "-1";
        let lastTime: number = -1;
        let hasHours: boolean = false;

        const updateBufferBar = () => {
            let leastTimeVideo = this.hasVideo ? 0 : this.mediaDuration;
            let leastTimeAudio = this.hasAudio ? 0 : this.mediaDuration;
            for (const frame of this.framesBuffer) {
                const { timestamp, duration } = FrameTime(frame);
                const time = timestamp / 1000000 + duration / 1000000;
                leastTimeVideo = Math.max(leastTimeVideo, time);
            }

            for (const audio of this.audiosBuffer) {
                const { timestamp, duration } = AudioTime(audio);
                const time = timestamp / 1000000 + duration / 1000000;
                leastTimeAudio = Math.max(leastTimeAudio, time);
            }

            const leastTime = Math.min(leastTimeVideo, leastTimeAudio);

            controls.transmutatedBar.style.setProperty(`--buffer-progress`, (leastTime / this.mediaDuration) * 100 + '%');
            Wait(this.bufferInsertedResolves).then(updateBufferBar.bind(this));
        };
        Wait(this.bufferInsertedResolves).then(updateBufferBar.bind(this));


        this.updateTimeCallback = (time) => {
            const progress = ((time / this.mediaDuration) * 100).toPrecision(4);
            if (lastProgreess != progress) {
                controls.progressBarRange.value = progress == "NaN" ? '0' : time.toString();
                lastProgreess = progress;
                controls.bufferBar.style.setProperty('--video-progress', `${progress}%`);
            }

            if (lastTime !== time) {
                const time2 = formatSeconds(time, hasHours);
                controls.numberProgress.textContent = time2.time;
                lastTime = time;
            }
        };

        // Update progress bar as the video plays
        this.video.addEventListener('timeDurationUpdate', () => {
            const time = formatSeconds(this.mediaDuration, false);
            controls.numberDuration.textContent = `/${time.time}`;
            hasHours = time.hours;
        });

        //bufferBar.style.width = `${clamp(lowestBuffered / this.videoElement.duration, 0, 1) * 100}%`;
        controls.progressBarRange.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.isPlaying = false;
        });

        controls.progressBarRange.addEventListener('input', (e) => {
            e.stopPropagation();
            this.updateTimeCallback(controls.progressBarRange.valueAsNumber);
        });

        controls.progressBarRange.addEventListener('mouseup', (e) => {
            e.stopPropagation();
            this.seekTo(controls.progressBarRange.valueAsNumber);
        });


        this.video.addEventListener("keydown", (event) => {
            event.stopPropagation();
            // Example:  Use arrow keys to control playback
            switch (event.key) {
                case "ArrowLeft":
                    this.seekTo(this.currentTime - 5);
                    break;
                case "ArrowRight":
                    this.seekTo(this.currentTime + 5);
                    break;
                case " ":
                    controls.playButton.click();
                    break;
                case "e": {
                    if (this.isPlaying) break;
                    this.nextFrame = true;
                    controls.playButton.click();
                }

            }
        });

        let lastVolume = this.video.volume;
        controls.bufferVolumeBar.style.setProperty('--video-progress', `${this.video.volume * 100}%`);

        // Volume control
        controls.volumeIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.video.volume > 0) {
                lastVolume = this.video.volume;
                this.video.volume = 0;
                controls.volumeControl.value = '0';
                controls.bufferVolumeBar.style.setProperty('--video-progress', `${0}%`);
            } else {
                this.video.volume = clamp(lastVolume, 0.01, 1);
                controls.volumeControl.value = (this.video.volume * 100).toString();
                controls.bufferVolumeBar.style.setProperty('--video-progress', `${controls.volumeControl.value}%`);
            }

        });

        controls.volumeControl.addEventListener('input', (e) => {
            e.stopPropagation();
            this.video.volume = parseFloat(controls.volumeControl.value) / 100;
            controls.bufferVolumeBar.style.setProperty('--video-progress', `${controls.volumeControl.value}%`);
        });

        this.video.addEventListener('volumechange', () => {
            if (this.video.volume > 0)
                lastVolume = this.video.volume;

            if (this.video.volume >= 0.5)
                controls.volumeIcon.textContent = 'volume_up';
            else if (this.video.volume > 0.25)
                controls.volumeIcon.textContent = 'volume_down';
            else if (this.video.volume > 0)
                controls.volumeIcon.textContent = 'volume_mute';
            else
                controls.volumeIcon.textContent = 'no_sound';
        });

        // Fullscreen button functionality
        controls.fullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                const setupVideo = () => {
                    this.video.style.maxWidth = 'unset';
                    this.video.style.maxHeight = 'unset';
                    this.video.style.width = '100%';
                    this.video.style.height = '100%';
                    this.video.style.top = '0';
                };
                const exitFullscreenSetup = () => {
                    this.video.style.maxWidth = '';
                    this.video.style.maxHeight = '';
                    this.video.style.width = '';
                    this.video.style.height = '';
                    this.video.style.top = '';
                };

                const parent = this.video.parentElement!;
                let fullscreenFunc: (options?: FullscreenOptions | undefined) => Promise<void> | void = parent.requestFullscreen;
                fullscreenFunc ??= this.video.requestFullscreen;
                fullscreenFunc ??= this.video.webkitEnterFullscreen;

                if (parent && parent.requestFullscreen) {
                    parent.requestFullscreen().then(() => {
                        setupVideo();
                        setTimeout(() => {
                            parent.addEventListener('fullscreenchange', exitFullscreenSetup, { once: true });
                        }, 100);

                    });

                } else if (this.video.requestFullscreen) {
                    this.video.requestFullscreen().then(() => {
                        setupVideo();
                        setTimeout(() => {
                            this.video.addEventListener('fullscreenchange', exitFullscreenSetup, { once: true });
                        }, 100);
                    });
                } else if (this.video.webkitEnterFullscreen && this.video.webkitSupportsFullscreen) {
                    this.video.webkitEnterFullscreen();
                    setupVideo();
                    this.video.addEventListener('fullscreenchange', exitFullscreenSetup, { once: true });
                }


            }
        });

        controls.captionIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            if (controls.trackSelector.dataset.isHidden == '1') {
                controls.trackSelector.style.height = controls.trackSelector.scrollHeight + "px";
                controls.trackSelector.classList.add('open');
                controls.controls.classList.add('tracklist-open');
                controls.trackSelector.dataset.isHidden = '0';
            } else {
                controls.trackSelector.classList.remove('open');
                controls.controls.classList.remove('tracklist-open');
                controls.trackSelector.style.height = "0px";
                controls.trackSelector.dataset.isHidden = '1';
            }
        });

        let timeoutId = 0;

        const showCursor = () => {
            this.video.style.cursor = 'auto';
            controls.controls.classList.remove("inactive");
            this.controlsAreVisible = true;
            this.updateTimeCallback(this.currentTime);
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };

        const hideCursor = () => {
            // @ts-ignore
            timeoutId = setTimeout(() => {
                this.video.style.cursor = 'none';
                controls.controls.classList.add("inactive");
                this.controlsAreVisible = false;
            }, 3000);
        };

        controls.controls.addEventListener('mouseenter', () => {
            showCursor();
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        });
        controls.controls.addEventListener('mouseleave', () => {
            hideCursor();
        });

        this.video.addEventListener('mousemove', () => {
            showCursor();
            hideCursor();
        });

        //initial cursor state
        hideCursor();
        this.video.addEventListener('dblclick', () => { controls.fullscreenBtn.click(); });

        makeDraggable(controls.controls);
        this.videoControls = controls.controls;
        this.videoControls.style.display = "none";

        return this.videoControls;
    }

    private async seekTo(time: number) {
        if (this.isSeeking) return;

        let canQuickSkipVideo = true;
        let canQuickSkipAudio = true;

        if (this.hasVideo) {
            canQuickSkipVideo = this.framesBuffer.some(frame => {
                const { timestamp, duration } = FrameTime(frame);
                return timestamp / 1000000 <= time && (timestamp + duration) / 1000000 >= time;
            });
        }

        if (this.hasAudio) {
            canQuickSkipAudio = this.audiosBuffer.some(audio => {
                const { timestamp, duration } = AudioTime(audio);
                return timestamp / 1000000 <= time && (timestamp + duration) / 1000000 >= time;
            });
        }


        if (!canQuickSkipVideo || !canQuickSkipAudio) {
            //const wasPlaying = this.isPlaying;
            //this.isPlaying = false;
            for (const frame of this.framesBuffer) {
                if (frame.kind === "videoFrame")
                    frame.videoFrame.close();
            }
            for (const audio of this.audiosBuffer) {
                if (audio.kind === "audioData")
                    audio.audioData.close();
            }
            this.framesBuffer.length = 0;
            this.audiosBuffer.length = 0;
            this.isSeeking = true;
            this.isPlaying = false;

            this.ffmpegWorker?.postMessage({ kind: "seekFfmpeg", seconds: time } as WorkerRequestFfmpegSeek);
        }

        this.currentTime = time;
        this.video.dispatchEvent(new Event("seek"));

        if (canQuickSkipAudio && canQuickSkipVideo) {
            this.SeekFinished(false);
        }
    }

    private updateMediaSessionPos() {
        navigator.mediaSession.setPositionState({
            duration: this.mediaDuration,
            playbackRate: 1,
            position: this.currentTime
        });
    }

    public PopulateTrackSelector(streams: FFmpegStreams[]) {
        for (const stream of streams) {
            if (stream.type === "video" && this.videoTrackSelect) {
                const option = document.createElement('option');
                option.value = stream.index.toString();
                option.text = stream.metadata["title"] ?? stream.metadata["TITLE"] ?? stream.metadata["language"] ?? stream.metadata["LANGUAGE"] ?? `Stream: ${stream.index}`;
                option.selected = stream.isUsed;
                this.videoTrackSelect.appendChild(option);
            }
            if (stream.type === "audio" && this.audioTrackSelect) {
                const option = document.createElement('option');
                option.value = stream.index.toString();
                option.text = stream.metadata["title"] ?? stream.metadata["TITLE"] ?? stream.metadata["language"] ?? stream.metadata["LANGUAGE"] ?? `Stream: ${stream.index}`;
                option.selected = stream.isUsed;
                this.audioTrackSelect.appendChild(option);
            }

            if (stream.type === "subtitle" && this.subtitleTrackSelect) {
                const option = document.createElement('option');
                option.value = stream.index.toString();
                option.text = stream.metadata["title"] ?? stream.metadata["TITLE"] ?? stream.metadata["language"] ?? stream.metadata["LANGUAGE"] ?? `Stream: ${stream.index}`;
                option.selected = stream.isUsed;
                this.subtitleTrackSelect!.appendChild(option);
            }
        }

        this.videoTrackSelect?.addEventListener('change', () => {
            if (!this.videoTrackSelect) return;
            const index = this.videoTrackSelect.selectedIndex;
            const option = this.videoTrackSelect.options[index];
            const intIndex = parseInt(option.value);
            for (const streaStr in this.availableStreams) {
                const index2 = parseInt(streaStr);
                const player = this.availableStreams[index2];
                if (player.type === "video" && player.mediaStream) {
                    if (intIndex === index2) {
                        this.mediaStream.addTrack(player.mediaStream.GetTrack());
                    } else
                        this.mediaStream.removeTrack(player.mediaStream.GetTrack());
                }
            }
            this.ffmpegWorker?.postMessage({ kind: "changeStream", type: "video", toIndex: intIndex } as WorkerChangeStream);
            this.seekTo(this.currentTime);
        });

        this.audioTrackSelect?.addEventListener('change', () => {
            if (!this.audioTrackSelect) return;
            const index = this.audioTrackSelect.selectedIndex;
            const option = this.audioTrackSelect.options[index];
            const intIndex = parseInt(option.value);
            for (const streaStr in this.availableStreams) {
                const index2 = parseInt(streaStr);
                const player = this.availableStreams[index2];
                if (player.type === "audio" && player.mediaStream) {
                    if (intIndex === index2) {
                        this.mediaStream.addTrack(player.mediaStream.GetTrack());
                    } else
                        this.mediaStream.removeTrack(player.mediaStream.GetTrack());
                }
            }
            this.ffmpegWorker?.postMessage({ kind: "changeStream", type: "audio", toIndex: intIndex } as WorkerChangeStream);
            this.seekTo(this.currentTime);
        });

        this.subtitleTrackSelect?.addEventListener('change', () => {
            if (!this.subtitleTrackSelect) return;
            const index = this.subtitleTrackSelect.selectedIndex;
            const option = this.subtitleTrackSelect.options[index];
            const intIndex = parseInt(option.value);
            for (const streaStr in this.availableStreams) {
                const index2 = parseInt(streaStr);
                const player = this.availableStreams[index2];
                if (player.type === "subtitle" && player.mediaStream) {
                    player.mediaStream?.Enable(intIndex === index2);
                }
            }
            this.ffmpegWorker?.postMessage({ kind: "changeStream", type: "subtitle", toIndex: intIndex } as WorkerChangeStream);
            this.seekTo(this.currentTime);
        });
    }

    public Destroy() {
        navigator.mediaSession.metadata = null;
        this.frontIcon?.remove();
        this.framesBuffer.forEach(frame => {
            if (frame.kind === "videoFrame")
                frame.videoFrame.close();
        });
        this.framesBuffer.length = 0;
        this.audiosBuffer.length = 0;
        this.availableStreams.forEach(stream => {
            stream.mediaStream?.Destroy();
        });
        this.availableStreams.length = 0;

        this.dummyAudio?.remove();
        if (this.ffmpegWorker) {
            this.ffmpegWorker.onmessage = (e: MessageEvent<AllWorkerMessages>) => {
                switch (e.data.kind) {
                    case "shutdown": {
                        // Good night
                        this.ffmpegWorker?.terminate();
                        this.ffmpegWorker = null;
                    }
                }
            }

            this.ffmpegWorker.postMessage({ kind: "shutdown" });
        }


        window.removeEventListener('unload', this.Destroy.bind(this));
    }
}

function clamp(i: number, min: number, max: number): number {
    return Math.min(Math.max(i, min), max);
}

function formatSeconds(seconds: number, hoursEnabled: boolean) {
    seconds = Math.max(seconds, 0);
    const hours = Math.floor(seconds / 3600); // Get the number of hours
    const minutes = Math.floor((seconds % 3600) / 60); // Get the number of minutes
    const remainingSeconds = Math.floor(seconds % 60); // Get the number of seconds
    //const milliseconds = Math.floor((seconds % 1) * 1000); // Get the milliseconds

    // Format the time without leading zeroes for hours or minutes
    let formattedTime = '';

    if (hours > 0 || hoursEnabled) {
        formattedTime += `${hours.toString().padStart(2, '0')}:`; // Add hours if greater than 0
    }
    formattedTime += `${minutes.toString().padStart(2, '0')}:`; // Add minutes if greater than 0 or hours exist


    formattedTime += `${remainingSeconds.toString().padStart(2, '0')}`; //.${milliseconds.toString().padStart(3, '0')}`; // Always add seconds and milliseconds

    return { time: formattedTime, hours: (hours > 0 || hoursEnabled) };
}

function generateSilentWave(durationSeconds: number, sampleRate: number, bitsPerSample: number, channels: number) {
    const numSamples = durationSeconds * sampleRate;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize); // WAV header size is 44 bytes

    // Helper function to write data to the buffer
    function writeString(buffer: Uint8Array, offset: number, string: string) {
        for (let i = 0; i < string.length; i++) {
            buffer[offset + i] = string.charCodeAt(i);
        }
    }

    function writeUint32(buffer: Uint8Array, offset: number, value: number) {
        buffer[offset] = value;
        buffer[offset + 1] = value >> 8;
        buffer[offset + 2] = value >> 16;
        buffer[offset + 3] = value >> 24;
    }

    function writeUint16(buffer: Uint8Array, offset: number, value: number) {
        buffer[offset] = value;
        buffer[offset + 1] = value >> 8;
    }

    // Write the WAV header
    const header = new Uint8Array(buffer);

    writeString(header, 0, 'RIFF');
    writeUint32(header, 4, 36 + dataSize); // File size - 8
    writeString(header, 8, 'WAVE');
    writeString(header, 12, 'fmt ');
    writeUint32(header, 16, 16); // Subchunk1Size - 16 for PCM
    writeUint16(header, 20, 1); // AudioFormat - 1 for PCM
    writeUint16(header, 22, channels);
    writeUint32(header, 24, sampleRate);
    writeUint32(header, 28, sampleRate * blockAlign); // ByteRate
    writeUint16(header, 32, blockAlign);
    writeUint16(header, 34, bitsPerSample);
    writeString(header, 36, 'data');
    writeUint32(header, 40, dataSize);

    // Write the silent audio data (all zeros)
    const data = new Uint8Array(buffer, 44);
    for (let i = 0; i < dataSize; i++) {
        data[i] = 0;
    }

    // Convert the ArrayBuffer to a Base64 string
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return 'data:audio/wav;base64,' + base64;
}

function parseFontFilename(filename: string) {
    // Remove extension
    const name = filename.replace(/\.[^.]+$/, '');

    // Try to split at the *last* hyphen to separate family and style
    const lastHyphenIndex = name.lastIndexOf('-');
    const rawFamily = lastHyphenIndex !== -1 ? name.substring(0, lastHyphenIndex) : name;
    const rawStyle = lastHyphenIndex !== -1 ? name.substring(lastHyphenIndex + 1) : 'Regular';

    // Insert spaces before capital letters and normalize
    const family = rawFamily
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([a-zA-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/[_\-]+/g, ' ')
        .trim();

    const styleLower = rawStyle.toLowerCase();

    const weightMap = [
        { keyword: 'thin', weight: '100' },
        { keyword: 'extralight', weight: '200' },
        { keyword: 'ultralight', weight: '200' },
        { keyword: 'light', weight: '300' },
        { keyword: 'regular', weight: '400' },
        { keyword: 'normal', weight: '400' },
        { keyword: 'medium', weight: '500' },
        { keyword: 'semibold', weight: '600' },
        { keyword: 'demibold', weight: '600' },
        { keyword: 'bold', weight: '700' },
        { keyword: 'extrabold', weight: '800' },
        { keyword: 'ultrabold', weight: '800' },
        { keyword: 'black', weight: '900' },
        { keyword: 'heavy', weight: '900' },
    ];

    let weight = '400'; // default
    for (const entry of weightMap) {
        if (styleLower.includes(entry.keyword)) {
            weight = entry.weight;
            break;
        }
    }

    let fontStyle = 'normal';
    if (styleLower.includes('italic')) fontStyle = 'italic';
    else if (styleLower.includes('oblique')) fontStyle = 'oblique';

    return {
        family,
        weight: weight,
        style: fontStyle,
    };
}

function Wait(resolveArray: ((value: any) => void)[]) {
    const stack = new Error().stack;
    return new Promise<void>(res => {
        // @ts-ignore
        res.stack = stack;
        resolveArray.push(res);
    });
}

function Resolve(resolveArray: ((value: any) => void)[], data?: any) {
    resolveArray.forEach(resolve => resolve(data));
    resolveArray.length = 0;
}





type HTML = string & { __brand: "html" };

function html(strings: TemplateStringsArray, ...values: unknown[]): HTML {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "") as HTML;
}

// Example usage
const page = (title: string, content: HTML): HTML => html`
  <html>
    <head><title>${title}</title></head>
    <body>${content}</body>
  </html>
`;

const body = html`<h1>Hello</h1><p>World</p>`;
const output = page("My Page", body);

console.log(output);
