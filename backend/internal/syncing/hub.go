package syncing

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Hub manages websocket clients and broadcasts the authoritative playback State.
//
// The Hub is safe for concurrent use. All mutation of clients/state is protected
// by the internal mutex.
type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}

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
		clients: make(map[*websocket.Conn]struct{}),
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
	h.clients[c] = struct{}{}
	initMsg, _ := json.Marshal(h.state)
	_ = c.WriteMessage(websocket.TextMessage, initMsg)
}

// Unregister client.
func (h *Hub) unRegisterClient(c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
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

		var p Propose
		if err := json.Unmarshal(data, &p); err != nil {
			continue
		}
		if p.Type != "propose" {
			continue
		}

		h.applyProposalAndBroadcast(p)
	}

	h.unRegisterClient(c)
}
