
import { type AllWorkerMessages, type AudioMediaStream, AudioTime, type ChapterInfo, type Dictionary, type FFmpegStreams, ffmpegUrl, FrameTime, type SubtitleMediaStream, type ThumnbnailDesc, type VideoMediaStream, WaitATick, type WorkerAssSubtitle, type WorkerAudioData, type WorkerAudioDataInit, type WorkerBitmapSubtitle, type WorkerChangeStream, type WorkerChapterInfo, type WorkerEmbedFont, type WorkerInitFFmpeg, type WorkerMediaInfo, type WorkerRequestAnswered, type WorkerRequestFfmpegSeek, type WorkerRequestFrames, type WorkerSubmitStreams, type WorkerVideoFrame, type WorkerVideoFrameBufferInit, type WorkerVideoFrameImageBitmap } from "../SomeTypes.ts";
import { AssSubtitles } from "./Tracks/AssSubtitleStreamTrack.js";
import { AudioStreamTrack } from "./Tracks/AudioStreamTrack.js";
import { AudioStreamTrackNative } from "./Tracks/AudioStreamTrackNative.js";
import { BitmapSubtitle, type BitmapSubtitleInfo } from "./Tracks/BitmapSubtitle.js";
import { MediaControls } from "./Controls.tsx";
import { VideoStreamTrack } from "./Tracks/VideoStreamTrack.js";

export class VideoPlayer {
    private video: HTMLVideoElement;
    public get videoElement(): HTMLVideoElement {
        return this.video;
    }

    private controls: MediaControls;
    public get mediaControl(): HTMLElement {
        return this.controls.controlsContainer
    }

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
    private get currentTime(): number {
        return this.currentTimeProp;
    }

    private set currentTime(v: number) {
        this.currentTimeProp = v;
        if (this.controlsAreVisible)
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
        this.controls = new MediaControls(this.video, {
            onPlayToggle: (intentPlay) => {
                this.isPlaying = intentPlay;
                this.video.dispatchEvent(new Event("playPause"));
                // if this handles real video element: this.isPlaying ? this.video.play() : this.video.pause();
            },
            onPauseForSeek: () => {
                this.isPlaying = false;
            },
            onSeekTo: (time) => {
                this.seekTo(time);
            },
            onStepFrame: () => {
                this.nextFrame = true;
                this.controls.syncPlaybackState(true); // Manually trigger play visuals
                this.video.dispatchEvent(new Event("playPause"));
            },
            onVolumeChange: (volume) => {
                this.video.volume = volume;
            },
            getMediaDuration: () => {
                return this.mediaDuration;
            },
            onVideoTrackSelect: (index) => {
                this.UpdateTrack("video", index);
            },
            onAudioTrackSelect: (index) => {
                this.UpdateTrack("audio", index);
            },
            onSubtitleTrackSelect: (index) => {
                this.UpdateTrack("subtitle", index);
            },
        });

        // ------------------------------------------
        // Parent pushing updates TO the controls
        // ------------------------------------------

        this.video.addEventListener("pause", () => {
            if (!this.isPlaying) return;
            this.controls.syncPlaybackState(false);
        });

        this.video.addEventListener("play", () => {
            if (this.isPlaying) return;
            this.controls.syncPlaybackState(true);
        });

        this.video.addEventListener('volumechange', () => {
            this.controls.syncVolumeState(this.video.volume);
        });

        this.video.addEventListener('timeDurationUpdate', () => {
            this.controls.setDuration(this.mediaDuration);
        });

        // Re-assign the updateTimeCallback to feed the controls
        this.updateTimeCallback = (time: number) => {
            this.currentTime = time;
            this.controls.updateCurrentTime(time, this.mediaDuration);
        };

        // Simplified Buffer Loop (Parent handles the math, Controls handle the DOM)
        const updateBufferBar = () => {
            let leastTimeVideo = this.hasVideo ? 0 : this.mediaDuration;
            let leastTimeAudio = this.hasAudio ? 0 : this.mediaDuration;

            for (const frame of this.framesBuffer) {
                const { timestamp, duration } = FrameTime(frame);
                leastTimeVideo = Math.max(leastTimeVideo, (timestamp + duration) / 1000000);
            }

            for (const audio of this.audiosBuffer) {
                const { timestamp, duration } = AudioTime(audio);
                leastTimeAudio = Math.max(leastTimeAudio, (timestamp + duration) / 1000000);
            }

            const leastTime = Math.min(leastTimeVideo, leastTimeAudio);

            // Push calculation result to controls
            this.controls.setBufferProgress((leastTime / this.mediaDuration) * 100);

            Wait(this.bufferInsertedResolves).then(updateBufferBar.bind(this));
        };
        Wait(this.bufferInsertedResolves).then(updateBufferBar.bind(this));

        window.addEventListener('unload', this.Destroy.bind(this));
    }

    async GetFileReady(file: string, fileName?: string, thumbnailUrl?: string, inCaseWeAddAContainer?: (element: HTMLElement) => void, bufferSize: number = 32768) {
        if (!this.controls) throw new Error("No Controls");
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
                        // reroute messages to itself
                        this.ffmpegWorker!.onmessage!(j);
                    };
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
            this.controls.controlsContainer.style.display = "";
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
        });
    }

    private AddVideoFrame(data: WorkerVideoFrame | WorkerVideoFrameImageBitmap) {
        if (!this.isSeeking) {
            this.framesBuffer.push(data);
            //this.framesBuffer.sort((a, b) => a.videoFrame.timestamp - b.videoFrame.timestamp)
            console.log(`Audio: ${this.audiosBuffer.length} and Video ${this.framesBuffer.length}`);
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
            });
            console.log(`Audio: ${this.audiosBuffer.length} and Video ${this.framesBuffer.length}`);
        } else {
            if (data.kind === "audioData")
                data.audioData.close();
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
        this.controls.UpdateChapters(this.chapters);
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
                (this.hasAudio && this.audiosBuffer.length < 16);
        }

        if (this.hasAudio) {
            return this.audiosBuffer.length < 512;
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

        return this.framesBuffer.length + queue < 33; // Random chatgpt value
    }

    private IsAudioBufferLow() {
        if (!this.hasAudio) return false;
        const activeStream = this.availableStreams.find(s => s.isUsed && s.type == "audio");
        let queue = 0;
        if (activeStream) {
            queue = this.streamDecoderQueue[activeStream.index] ?? 0;
        }

        return this.audiosBuffer.length + queue < 33;
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

    private PopulateTrackSelector(streams: FFmpegStreams[]) {
        this.controls.UpdateVideoTracks(streams.filter(s => s.type === "video") as VideoMediaStream[]);
        this.controls.UpdateAudioTracks(streams.filter(s => s.type === "audio") as AudioMediaStream[]);
        this.controls.UpdateSubtitleTracks(streams.filter(s => s.type === "subtitle") as SubtitleMediaStream[]);
    }

    private UpdateTrack(type: "video" | "audio" | "subtitle", value: number) {
        for (const streaStr in this.availableStreams) {
            const index2 = parseInt(streaStr);
            const player = this.availableStreams[index2];
            if (player.type === "subtitle" && player.mediaStream) {
                player.mediaStream?.Enable(value === index2);
            } else if ((player.type === 'video' || player.type === 'audio') && player.mediaStream) {
                if (value === index2) {
                    this.mediaStream.addTrack(player.mediaStream.GetTrack()!);
                } else
                    this.mediaStream.removeTrack(player.mediaStream.GetTrack()!);
            }
        }
        this.ffmpegWorker?.postMessage({ kind: "changeStream", type: type, toIndex: value } as WorkerChangeStream);
        this.seekTo(this.currentTime);
    }

    private Destroy() {
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
            };

            this.ffmpegWorker.postMessage({ kind: "shutdown" });
        }


        window.removeEventListener('unload', this.Destroy.bind(this));
    }
}

function clamp(i: number, min: number, max: number): number {
    return Math.min(Math.max(i, min), max);
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





type HTML = string & { __brand: "html"; };

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
