export enum Intent {
  Play,
  Pause,
  Seek
}

export enum HasData {
  False,
  OldBuffers,
  TrueWithingBuffer,
  TrueButFirstFrameInFuture,
}