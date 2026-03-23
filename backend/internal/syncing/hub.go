package syncing

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
)

const (
	defaultNickname = "anonymous"
	maxNicknameLen  = 32
)

// Hub manages websocket clients and broadcasts the authoritative playback State.
//
// The Hub is safe for concurrent use. All mutation of clients/state is protected
// by the internal mutex.
type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]string

	state State
	rev   int64

	upgrader websocket.Upgrader
}

// NewHub constructs a Hub with an initial paused state at t=0.
//
// The returned Hub uses a permissive websocket upgrader (CheckOrigin = true),
// which is convenient for local development but should be restricted for
// production deployments.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[*websocket.Conn]string),
		state: State{
			Type:     "state",
			Paused:   true,
			T:        0,
			ServerTs: nowSeconds(),
			Rev:      0,
		},
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true }, // dev only; restrict for prod
		},
	}
}

// Register client and send initial state.
func (h *Hub) registerClient(c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = ""
	initMsg, _ := json.Marshal(h.state)
	_ = c.WriteMessage(websocket.TextMessage, initMsg)

	presence := h.buildPresenceLocked()
	h.broadcastPresence(presence)
}

// Unregister client.
func (h *Hub) unRegisterClient(c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)

	presence := h.buildPresenceLocked()
	h.broadcastPresence(presence)
}

// broadcastLocked sends the current State to all clients.
//
// h.mu must be held by the caller.
func (h *Hub) broadcastLocked() {
	msg, _ := json.Marshal(h.state)
	for c := range h.clients {
		_ = c.WriteMessage(websocket.TextMessage, msg)
	}
}

// setNickname sets the nickname for a connection if it still has the default
// nickname (i.e. join has not been called before). Returns false if ignored.
func (h *Hub) setNickname(c *websocket.Conn, name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		name = defaultNickname
	}
	// Truncate to maxNicknameLen runes.
	if utf8.RuneCountInString(name) > maxNicknameLen {
		runes := []rune(name)
		name = string(runes[:maxNicknameLen])
	}
 
	h.mu.Lock()
	defer h.mu.Unlock()

	current, ok := h.clients[c]
	if !ok || current != "" {
		return false
	}
	// Only honour the first join (while still at default).
	if current != defaultNickname {
		return false
	}
	h.clients[c] = name
	presence := h.buildPresenceLocked()
 
	h.broadcastPresence(presence)
	return true
}
 
// buildPresenceLocked constructs a Presence value from the current client map.
// h.mu must be held by the caller.
func (h *Hub) buildPresenceLocked() Presence {
	viewers := make([]string, 0, len(h.clients))
	for _, name := range h.clients {
		if name != "" {
            viewers = append(viewers, name)
        }
	}
	return Presence{
		Type:    "presence",
		Count:   len(viewers),
		Viewers: viewers,
	}
}
 
// broadcastPresence sends a Presence message to all connected clients.
func (h *Hub) broadcastPresence(p Presence) {
	msg, _ := json.Marshal(p)
	for c := range h.clients {
		_ = c.WriteMessage(websocket.TextMessage, msg)
	}
}
 
// broadcastChat sends a ChatBroadcast to all connected clients.
// The sender name is resolved from the server-side nickname, not the client payload.
func (h *Hub) broadcastChat(c *websocket.Conn, text string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	name, ok := h.clients[c]
	if (!ok || name == ""){
		return
	}
	out := ChatBroadcast{
		Type: "chat",
		Name: name,
		Text: text,
		Ts:   nowSeconds(),
	}
	msg, _ := json.Marshal(out)
	for conn := range h.clients {
		_ = conn.WriteMessage(websocket.TextMessage, msg)
	}
}

// Current time in seconds since epoch.
func nowSeconds() float64 {
	return float64(time.Now().UnixNano()) / 1e9
}

// applyProposalAndBroadcast validates and applies a proposal, updates State metadata,
// and broadcasts the updated State to all connected clients.
func (h *Hub) applyProposalAndBroadcast(p Propose) {
	now := nowSeconds()

	h.mu.Lock()
	defer h.mu.Unlock()

	// Validate and apply.
	switch p.Action {
	case "pause":
		h.state.Paused = true
		h.state.T = p.T
	case "play":
		h.state.Paused = false
		h.state.T = p.T
	case "seek":
		h.state.T = p.T
		// Paused remains unchanged.
	default:
		return
	}

	// Bump revision + timestamps only on accepted actions.
	h.rev++
	h.state.Rev = h.rev
	h.state.ServerTs = now

	h.broadcastLocked()
}

// HandleWS upgrades the HTTP request to a websocket, registers the client,
// immediately sends the current State, and then processes incoming Propose
// messages until the client disconnects.
func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	// Upgrade HTTP to websocket
	c, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()
 
	h.registerClient(c)
 
	// Read loop.
	for {
		// Blocking call to read message when available
		_, data, err := c.ReadMessage()
		if err != nil {
			break
		}
 
		// Peek at the type field to route the message.
		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil {
			continue
		}
 
		switch envelope.Type {
		case "propose":
			var p Propose
			if err := json.Unmarshal(data, &p); err != nil {
				continue
			}
			h.applyProposalAndBroadcast(p)
 
		case "chat":
			var chat ChatSend
			if err := json.Unmarshal(data, &chat); err != nil {
				continue
			}
			// Basic validation: require non-empty text.
			if strings.TrimSpace(chat.Text) == "" {
				continue
			}
			// Name comes from server-side map; ignore client-supplied name.
			h.broadcastChat(c, strings.TrimSpace(chat.Text))
 
		case "join":
			var j Join
			if err := json.Unmarshal(data, &j); err != nil {
				continue
			}
			h.setNickname(c, j.Name)
		}
	}
 
	h.unRegisterClient(c)
}