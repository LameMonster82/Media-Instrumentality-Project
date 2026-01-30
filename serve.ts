import homepage from "./index.html";

Bun.serve({
    // development can also be an object.
    development: {
        // Enable Hot Module Reloading
        hmr: false,

        // Echo console logs from the browser to the terminal
        console: true,
    },

    routes: {
        "/": homepage,
    },
});
