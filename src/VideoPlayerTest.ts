import { VideoPlayer2 } from "./player/VideoPlayer";
import video from "@Resources/Arcane.mkv"


const container = document.getElementById("containerAgain")!;
const videoPlayer = new VideoPlayer2(video);

container.appendChild(videoPlayer.getVideo())

