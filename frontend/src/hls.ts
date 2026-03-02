import
Hls,
{
    type ErrorData,
    type FragLoadingData,
    type FragLoadedData,
    type FragLoadEmergencyAbortedData,
    type ManifestParsedData,
    Events
}
    from "hls.js";

/**
 * Handles HLS.js error events by logging the error data to the console.
 *
 * @param _ - The event name (unused).
 * @param data - The error payload from HLS.js.
 */
function onHlsError(_: Events.ERROR, data: ErrorData): void {
    console.error("HLS.js ERROR", data);
}

/**
 * Handles HLS.js fragment loading events by logging the data URL to the console.
 *
 * @param _ - The event name (unused).
 * @param data - The fragment loading payload from HLS.js.
 */
function onHlsFragLoading(_: Events.FRAG_LOADING, data: FragLoadingData): void {
    console.trace("FRAG_LOADING", data.frag.url);
}

/**
 * Handles HLS.js fragment loaded events by logging the data URL to the console.
 *
 * @param _ - The event name (unused).
 * @param data - The fragment loaded payload from HLS.js.
 */
function onHlsFragLoaded(_: Events.FRAG_LOADED, data: FragLoadedData): void {
    console.trace("FRAG_LOADED", data.frag.url);
}

/**
 * Handles HLS.js fragment load emergency abort events by logging the data to the console.
 *
 * @param _ - The event name (unused).
 * @param data - The fragment load emergency abort payload from HLS.js.
 */
function onHlsFragLoadEmergencyAbort(_: Events.FRAG_LOAD_EMERGENCY_ABORTED, data: FragLoadEmergencyAbortedData): void {
    console.error("FRAG_LOAD_EMERGENCY_ABORTED", data);
}

/**
 * Creates an HLS.js manifest parsed event handler that starts playback on the given video element.
 *
 * @param video - The HTMLVideoElement to start playback on.
 * @returns An HLS.js event handler that starts playback when the manifest is parsed.
 */
function createOnManifestParsed(video: HTMLVideoElement): (_: string, _data: ManifestParsedData) => void {
    return function onManifestParsed(_: string, _data: ManifestParsedData): void {
        console.info("Manifest parsed, starting playback");
        video.play().catch(() => { });
    };
}

/**
 * Attaches an HLS stream to a video element, with a fallback for Safari's native HLS support.
 *
 * - If the browser supports HLS natively (e.g. Safari), sets `video.src` directly.
 * - Otherwise, uses HLS.js to load and stream the source.
 * - Logs fragment and error events for debugging.
 *
 * @param video - The HTMLVideoElement to attach the stream to.
 * @param src - The URL of the HLS stream (`.m3u8` manifest).
 * @returns A cleanup function that destroys the HLS.js instance, or a no-op for native playback.
 * @throws {Error} If HLS is not natively supported and HLS.js is also unsupported by the browser.
 *
 * @example
 * const cleanup = attachHls(videoEl, "https://example.com/stream.m3u8");
 * // Later, to tear down:
 * cleanup();
 */
export function attachHls(video: HTMLVideoElement, src: string) {
    // Safari native support
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.play().catch(() => { });
        return () => { };
    }

    // Make sure HLS is supported
    if (!Hls.isSupported()) {
        throw new Error("HLS not supported in this browser.");
    }

    // Create HLS object
    const hls = new Hls();

    // HLS event listeners
    hls.on(Hls.Events.ERROR, onHlsError);
    hls.on(Hls.Events.FRAG_LOADING, onHlsFragLoading);
    hls.on(Hls.Events.FRAG_LOADED, onHlsFragLoaded);
    hls.on(Hls.Events.FRAG_LOAD_EMERGENCY_ABORTED, onHlsFragLoadEmergencyAbort);
    hls.on(Hls.Events.MANIFEST_PARSED, createOnManifestParsed(video));

    // Load the source video
    hls.loadSource(src);
    hls.attachMedia(video);

    // Return cleanup function
    return () => hls.destroy();
}
