package syncing

// Propose is a client-to-server message that proposes a state change.
//
// Clients send Propose messages to request "pause", "play", or "seek".
// T is the desired video time (seconds) at which the action should apply.
type Propose struct {
	Type   string  `json:"type"`   // must be "propose"
	Action string  `json:"action"` // "pause" | "play" | "seek"
	T      float64 `json:"t"`      // video time in seconds
}

// State is a server-to-client message representing the authoritative playback state.
//
// ServerTs is the server's wall-clock timestamp (seconds since epoch) when the state
// was last updated. Rev is a monotonically increasing revision number used by clients
// to ignore out-of-order updates.
type State struct {
	Type     string  `json:"type"`     // always "state"
	Paused   bool    `json:"paused"`   // true if playback should be paused
	T        float64 `json:"t"`        // authoritative video time in seconds
	ServerTs float64 `json:"serverTs"` // server timestamp (seconds since epoch)
	Rev      int64   `json:"rev"`      // state revision
}

// ChatSend is a client-to-server message containing a chat message.
type ChatSend struct {
	Type string `json:"type"` // must be "chat"
	Name string `json:"name"` // display name chosen by the client
	Text string `json:"text"` // message body (non-empty)
}

// ChatBroadcast is a server-to-client message broadcasting a chat message.
type ChatBroadcast struct {
	Type string  `json:"type"`      // always "chat"
	Name string  `json:"name"`      // sender display name
	Text string  `json:"text"`      // message body
	Ts   float64 `json:"ts"`        // server timestamp (seconds since epoch)
}