/**
 * A proposal message sent from the client to the server to request a playback action.
 */
export type Propose = {
    /** Discriminant tag identifying this as a propose message. */
    type: "propose";
    /** The playback action being proposed. */
    action: "pause" | "play" | "seek";
    /** The playback position in seconds at which the action should apply. */
    t: number;
};

/**
 * A state message received from the server describing the current playback state.
 */
export type State = {
    /** Discriminant tag identifying this as a state message. */
    type: "state";
    /** Whether playback is currently paused. */
    paused: boolean;
    /** The current playback position in seconds. */
    t: number;
    /** The server timestamp at the time this state was emitted, in milliseconds. */
    serverTs: number;
    /** Monotonically increasing revision number for ordering state updates. */
    rev: number;
};

/**
 * A chat message sent from the client to the server.
 */
export type ChatSend = {
    type: "chat";
    name: string;
    text: string;
};

/**
 * A chat message broadcast from the server to all clients.
 */
export type ChatBroadcast = {
    type: "chat";
    name: string;
    text: string;
    /** Server timestamp in seconds since epoch. */
    ts: number;
};

/**
 * The object returned by {@link connectSyncWS}, providing controls for the sync WebSocket connection.
 */
export type SyncWSControls = {
    /** The underlying WebSocket instance. */
    ws: WebSocket;
    /** Closes the WebSocket connection. */
    close: () => void;
    /** Proposes pausing playback at the given position in seconds. */
    proposePause: (t: number) => void;
    /** Proposes resuming playback at the given position in seconds. */
    proposePlay: (t: number) => void;
    /** Proposes seeking to the given position in seconds. */
    proposeSeek: (t: number) => void;

    sendChat: (name: string, text: string) => void;

};

export type SyncWSCallbacks = {
    onState: (s: State) => void;
    onChat: (m: ChatBroadcast) => void;
};

/**
 * Creates a handler that logs when the WebSocket connection is opened.
 *
 * @param url - The WebSocket URL that was opened.
 * @returns A handler that logs the open event.
 */
function createOnOpen(url: string): () => void {
    return function onOpen(): void {
        console.info(`WS open: ${url}`);
    };
}

/**
 * Creates a handler that logs when the WebSocket connection is closed.
 *
 * @param url - The WebSocket URL that was closed.
 * @returns A handler that logs the close event.
 */
function createOnClose(url: string): () => void {
    return function onClose(): void {
        console.info(`WS closed: ${url}`);
    };
}

/**
 * Handles WebSocket error events by logging the error.
 *
 * @param ev - The error event received from the WebSocket.
 */
function onError(ev: Event): void {
    console.error("WS error", ev);
}

/**
 * Creates a WebSocket message handler that parses incoming messages and forwards valid {@link State} objects.
 * Silently ignores messages that are not valid JSON or do not match the {@link State} shape.
 *
 * @param onState - Callback invoked whenever a valid {@link State} message is received.
 * @returns A WebSocket message handler.
 */
function createOnMessage(callbacks: SyncWSCallbacks): (ev: MessageEvent) => void {
    return function onMessage(ev: MessageEvent): void {
        let msg: unknown;
        try {
            msg = JSON.parse(String(ev.data));
        } catch {
            return;
        }
        if (!msg || typeof msg !== "object") return;
        const m = msg as { type?: string };

        if (m.type === "state") {
            callbacks.onState(msg as State);
        } else if (m.type === "chat") {
            callbacks.onChat(msg as ChatBroadcast);
        }
    };
}

/**
 * Creates a function that sends a {@link Propose} message to the server if the WebSocket is open.
 *
 * @param ws - The WebSocket instance to send messages on.
 * @returns A function that sends a {@link Propose} message.
 */
function createSend(ws: WebSocket): (p: Propose| ChatSend) => void {
    return function send(p: Propose| ChatSend): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(p));
    };
}

/**
 * Creates a function that closes the WebSocket connection.
 *
 * @param ws - The WebSocket instance to close.
 * @returns A function that closes the WebSocket connection.
 */
function createClose(ws: WebSocket): () => void {
    return function close(): void {
        ws.close();
    };
}

/**
 * Creates a function that proposes pausing playback at the given position.
 *
 * @param send - The send function to use.
 * @returns A function that proposes pausing playback at the given position in seconds.
 */
function createProposePause(send: (p: Propose) => void): (t: number) => void {
    return function proposePause(t: number): void {
        send({ type: "propose", action: "pause", t });
    };
}

/**
 * Creates a function that proposes resuming playback at the given position.
 *
 * @param send - The send function to use.
 * @returns A function that proposes resuming playback at the given position in seconds.
 */
function createProposePlay(send: (p: Propose) => void): (t: number) => void {
    return function proposePlay(t: number): void {
        send({ type: "propose", action: "play", t });
    };
}

/**
 * Creates a function that proposes seeking to the given position.
 *
 * @param send - The send function to use.
 * @returns A function that proposes seeking to the given position in seconds.
 */
function createProposeSeek(send: (p: Propose) => void): (t: number) => void {
    return function proposeSeek(t: number): void {
        send({ type: "propose", action: "seek", t });
    };
}

function createChat(send: (p: ChatSend) => void): (name: string, text: string) => void {
    return function sendChat(name: string, text: string): void {
        send({ type: "chat", name, text });
    };
}

/**
 * Connects to a sync WebSocket server and returns controls for proposing playback actions.
 *
 * Listens for {@link State} messages from the server and forwards them to `onState`.
 * Incoming messages that are not valid state objects are silently ignored.
 *
 * @param url - The WebSocket server URL to connect to.
 * @param onState - Callback invoked whenever a valid {@link State} message is received.
 * @param logMsg - Optional logging callback for connection lifecycle and error events.
 * @returns An object containing the raw WebSocket, a close function, and propose helpers.
 *
 * @example
 * const sync = connectSyncWS("wss://example.com/sync", (state) => {
 *   console.log("New state:", state);
 * });
 * sync.proposePlay(42.5);
 * sync.close();
 */
export function connectSyncWS(url: string, 
    callbacks: SyncWSCallbacks): SyncWSControls {
    // Create new WebSocket connection
    const ws = new WebSocket(url);

    // Add WebSocket event listeners
    ws.addEventListener("open", createOnOpen(url));
    ws.addEventListener("close", createOnClose(url));
    ws.addEventListener("error", onError);
    ws.addEventListener("message", createOnMessage(callbacks));

    // Create the function to send playback data through the WebSocket
    const send = createSend(ws);

    // Return the API for the client to interact with the WebSocket
    return {
        ws,
        close: createClose(ws),
        proposePause: createProposePause(send),
        proposePlay: createProposePlay(send),
        proposeSeek: createProposeSeek(send),
        sendChat: createChat(send)
    } satisfies SyncWSControls;
}
