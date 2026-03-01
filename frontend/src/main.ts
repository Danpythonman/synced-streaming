import "./style.css";
import Hls from "hls.js";

const video = document.getElementById("video") as HTMLVideoElement;
const input = document.getElementById("src") as HTMLInputElement;
const button = document.getElementById("load") as HTMLButtonElement;
const log = document.getElementById("log") as HTMLPreElement;

let cleanup: (() => void) | null = null;

function logMsg(msg: string) {
    log.textContent += msg + "\n";
}

function attachHls(video: HTMLVideoElement, src: string) {
    // Safari native support
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.play().catch(() => { });
        return () => { };
    }

    if (!Hls.isSupported()) {
        throw new Error("HLS not supported in this browser.");
    }

    const hls = new Hls();

    hls.on(Hls.Events.ERROR, (_, data) => {
        console.log("HLS.js ERROR", data);
    });
    hls.on(Hls.Events.FRAG_LOADING, (_, data) => console.log("FRAG_LOADING", data.frag.url));
    hls.on(Hls.Events.FRAG_LOADED, (_, data) => console.log("FRAG_LOADED", data.frag.url));
    hls.on(Hls.Events.FRAG_LOAD_EMERGENCY_ABORTED, (_, data) =>
        console.log("FRAG_LOAD_EMERGENCY_ABORTED", data)
    );

    hls.on(Hls.Events.ERROR, (_, data) => {
        logMsg(`HLS error: ${data.type} / ${data.details}`);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
        logMsg("Manifest parsed, starting playback");
        video.play().catch(() => { });
    });

    hls.loadSource(src);
    hls.attachMedia(video);

    return () => hls.destroy();
}

button.addEventListener("click", () => {
    const src = input.value.trim();
    if (!src) return;

    // Cleanup previous instance
    if (cleanup) cleanup();

    video.pause();
    video.removeAttribute("src");
    video.load();

    cleanup = attachHls(video, src);
});
