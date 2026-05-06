import homepage from "./index.html";
import videoTest from "./VideoControls.html";

const stuff = Bun.serve({
    // development can also be an object.
    development: {
        hmr: false,
        console: true,
        chromeDevToolsAutomaticWorkspaceFolders: true
    },

    tls: {
        cert: Bun.file("./Resources/local.cert"),
        key: Bun.file("./Resources/local.key")
    },

    routes: {
        "/": homepage,
        "/testControls": videoTest,
        "/testVideo.mp4": new Response(Bun.file("./Resources/IMG_9223.MP4")) 
    },
});

console.log(`We serve at ${stuff.url}`)
