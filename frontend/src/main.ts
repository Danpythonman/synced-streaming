import "./style.css";

import { type State, type ChatBroadcast, type Presence, connectSyncWS } from "./ws";
import { attachHls } from "./hls"

// Get URL of sync server, make sure it exists
const syncUrl = import.meta.env.VITE_SYNC_URL as string;
if (!syncUrl) {
    throw new Error("VITE_SYNC_URL is not defined");
}

// Get important DOM elements, make sure they exist
const video = document.getElementById("video") as HTMLVideoElement;
const input = document.getElementById("src") as HTMLInputElement;
const button = document.getElementById("load") as HTMLButtonElement;
const nameInput  = document.getElementById("name-input") as HTMLInputElement;
const nameBtn    = document.getElementById("name-btn")   as HTMLButtonElement;
const nameStatus = document.getElementById("name-status") as HTMLSpanElement;
const chatInput  = document.getElementById("chat-input") as HTMLInputElement;
const chatSend   = document.getElementById("chat-send")  as HTMLButtonElement;
const chatLog    = document.getElementById("chat-log")   as HTMLDivElement;
const viewersBadge = document.getElementById("viewers-badge") as HTMLSpanElement;
const viewersList    = document.getElementById("viewers-list")   as HTMLSpanElement;

if (!video || !input || !button || !nameInput || !chatInput || !chatSend || !chatLog || !viewersBadge) {
    throw new Error("Required DOM elements not found");
}

/** Destroys the current HLS.js instance. Null if no stream is loaded. */
let cleanup: (() => void) | null = null;

/** When true, local media events are ignored and not forwarded to the sync server.
 * Set during programmatic playback changes to prevent echoing server state back. */
let suppressingLocalEvents: boolean = false;

/** The revision number of the last applied server state. Used to discard duplicate or out-of-order messages. */
let lastRev: number = -1;

/** Whether the nickname has been committed (join sent). */
let nameLocked: boolean = false;

/**
 * Handles an incoming {@link State} message from the sync server by applying
 * the remote playback state to the local video element.
 *
 * Ignores duplicate or out-of-order messages by comparing {@link State.rev}.
 * Sets {@link suppressingLocalEvents} during the update to prevent local media events
 * from being echoed back to the server.
 *
 * @param s - The incoming state from the sync server.
 */
function onState(s: State): void {
    // Ignore duplicates and out-of-order messages.
    if (s.rev <= lastRev) return;
    lastRev = s.rev;

    suppressingLocalEvents = true;
    try {
        // Only seek if the difference is meaningful. Tune threshold as needed.
        const diff = Math.abs(video.currentTime - s.t);
        if (diff > 0.25) video.currentTime = s.t;

        if (s.paused) {
            if (!video.paused) {
                video.pause();
            }
        } else {
            if (video.paused) {
                // void is intentional — the promise is deliberately unhandled here.
                void video.play().catch(() => {
                    // Autoplay policies can block playback until the user interacts.
                    console.error("Remote play blocked by browser autoplay policy");
                });
            }
        }
    } finally {
        // Defer re-enabling local->server propagation to allow async media events to fire first.
        setTimeout(() => (suppressingLocalEvents = false), 0);
    }
}

const sync = connectSyncWS(syncUrl, { onState, onChat, onPresence });

/**
 * Handles the button click event for loading a new HLS video source.
 *
 * Clears any existing HLS instance, resets the video element, and attaches
 * a new HLS stream from the provided input URL.
 */
function handleClick(): void {
    // Get the video source, make sure it exists
    const src = input.value.trim();
    if (!src) {
        alert('No source video was provided!')
        return;
    }

    // If a cleanup function already exists, call it to clean up the previous video
    if (cleanup) {
        cleanup();
    }

    suppressingLocalEvents = true;
    try {
        video.pause();
        video.removeAttribute("src");
        video.load();
    } finally {
        setTimeout(() => (suppressingLocalEvents = false), 0);
    }

    cleanup = attachHls(video, src);

    // Send join on first load — this is when the user becomes a "viewer".
    if (!nameLocked) {
        const name = nameInput.value.trim() || "anonymous";
        lockNickname(name);  // sends sendJoin internally
    }
};

button.addEventListener("click", handleClick);

/**
 * Handles the video pause event by proposing a pause to the sync server.
 * No-ops if the pause was triggered by a remote state update.
 */
function onVideoPause(): void {
    if (suppressingLocalEvents) return;
    sync.proposePause(video.currentTime);
}

/**
 * Handles the video play event by proposing a play to the sync server.
 * No-ops if the play was triggered by a remote state update.
 */
function onVideoPlay(): void {
    if (suppressingLocalEvents) return;
    sync.proposePlay(video.currentTime);
}

/**
 * Handles the video seeked event by proposing a seek to the sync server.
 * No-ops if the seek was triggered by a remote state update.
 */
function onVideoSeeked(): void {
    if (suppressingLocalEvents) return;
    sync.proposeSeek(video.currentTime);
}

video.addEventListener("pause", onVideoPause);
video.addEventListener("play", onVideoPlay);
video.addEventListener("seeked", onVideoSeeked);


// chat recieve
function onChat(m: ChatBroadcast): void {
    const row = document.createElement("div");
    const meta = document.createElement("span");
    row.appendChild(meta);
    chatLog.appendChild(row);

    meta.textContent = `${m.name}: ${m.text}`;
}

// chat send
function onChatSend(): void {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";

    //send to web socket
    sync.sendChat(text);
}

chatSend.addEventListener("click", onChatSend);
chatInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") onChatSend();
});

// set name
function lockNickname(name: string): void {
    nameLocked = true;
    nameInput.disabled = true;
    nameBtn.disabled = true;
    const display = name.trim() || "anonymous";
    nameStatus.textContent = display;
    nameStatus.classList.add("locked");
    sync.sendJoin(display);
}
 
nameBtn.addEventListener("click", () => {
    if (nameLocked) return;
    lockNickname(nameInput.value);
});
 
nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !nameLocked) lockNickname(nameInput.value);
});

// presence update (viewer count)
function onPresence(p: Presence): void {
    viewersBadge.textContent = `${p.count} viewer${p.count !== 1 ? "s" : ""}`;
    viewersList.textContent = p.viewers.join(", ");
}
 