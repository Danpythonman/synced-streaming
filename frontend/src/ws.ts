export type Propose = {
    type: "propose";
    action: "pause" | "play" | "seek";
    t: number;
};

export type State = {
    type: "state";
    paused: boolean;
    t: number;
    serverTs: number;
    rev: number;
};

export function connectSyncWS(
    url: string,
    onState: (s: State) => void,
    logMsg?: (m: string) => void,
) {
    const ws = new WebSocket(url);

    ws.addEventListener("open", () => logMsg?.(`WS open: ${url}`));
    ws.addEventListener("close", () => logMsg?.("WS closed"));
    ws.addEventListener("error", () => logMsg?.("WS error"));

    ws.addEventListener("message", (ev) => {
        let msg: unknown;
        try {
            msg = JSON.parse(String(ev.data));
        } catch {
            return;
        }
        if (!msg || typeof msg !== "object") return;

        const m = msg as Partial<State>;
        if (m.type === "state" && typeof m.rev === "number") {
            onState(m as State);
        }
    });

    function send(p: Propose) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(p));
    }

    return {
        ws,
        close: () => ws.close(),
        proposePause: (t: number) => send({ type: "propose", action: "pause", t }),
        proposePlay: (t: number) => send({ type: "propose", action: "play", t }),
        proposeSeek: (t: number) => send({ type: "propose", action: "seek", t }),
    };
}
