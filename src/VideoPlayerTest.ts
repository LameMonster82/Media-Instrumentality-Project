import { VideoPlayer2 } from "./player/VideoPlayer";
import video from "@Resources/IMG_9223.MP4"


const container = document.getElementById("containerAgain")!;
const videoPlayer = new VideoPlayer2(video);

container.appendChild(videoPlayer.getVideo())

