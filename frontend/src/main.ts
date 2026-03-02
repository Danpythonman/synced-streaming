import "./style.css";
import Hls from "hls.js";
import { connectSyncWS } from "./ws";

const video = document.getElementById("video") as HTMLVideoElement;
const input = document.getElementById("src") as HTMLInputElement;
const button = document.getElementById("load") as HTMLButtonElement;
const log = document.getElementById("log") as HTMLPreElement;

let cleanup: (() => void) | null = null;
let syncCleanup: (() => void) | null = null;
let applyingRemote = false;
let lastRev = -1;

function logMsg(msg: string) {
    log.textContent += msg + "\n";
}

const syncUrl = "ws://localhost:8002/ws";

const sync = connectSyncWS(
    syncUrl,
    (s) => {
        // ignore duplicates / out-of-order
        if (s.rev <= lastRev) return;
        lastRev = s.rev;

        applyingRemote = true;
        try {
            // seek only if meaningfully different (tune threshold)
            const diff = Math.abs(video.currentTime - s.t);
            if (diff > 0.25) video.currentTime = s.t;

            if (s.paused) {
                if (!video.paused) video.pause();
            } else {
                if (video.paused) {
                    void video.play().catch(() => {
                        // autoplay policies can block this until user interacts
                        logMsg("Remote play blocked by browser autoplay policy");
                    });
                }
            }
        } finally {
            // let any async media events fire before re-enabling local->server
            setTimeout(() => (applyingRemote = false), 0);
        }
    },
    logMsg,
);

syncCleanup = () => sync.close();

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

    if (cleanup) cleanup();

    applyingRemote = true;
    try {
        video.pause();
        video.removeAttribute("src");
        video.load();
    } finally {
        setTimeout(() => (applyingRemote = false), 0);
    }

    cleanup = attachHls(video, src);
});

video.addEventListener("pause", () => {
    if (applyingRemote) return;
    sync.proposePause(video.currentTime);
});

video.addEventListener("play", () => {
    if (applyingRemote) return;
    sync.proposePlay(video.currentTime);
});

video.addEventListener("seeked", () => {
    if (applyingRemote) return;
    sync.proposeSeek(video.currentTime);
});
