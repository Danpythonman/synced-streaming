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

const maxNicknameLen = 32

// Hub manages websocket clients and broadcasts the authoritative playback State.
//
// The Hub is safe for concurrent use. All mutation of clients/state is protected
// by the internal mutex.
type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]string // "" = connected, not yet joined

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
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// sendAll sends msg to every client. Caller must hold h.mu.
func (h *Hub) sendAll(msg []byte) {
	for c := range h.clients {
		_ = c.WriteMessage(websocket.TextMessage, msg)
	}
}

// presenceMsg builds and marshals a Presence message. Caller must hold h.mu.
func (h *Hub) presenceMsg() []byte {
	viewers := make([]string, 0, len(h.clients))
	for _, name := range h.clients {
		if name != "" {
			viewers = append(viewers, name)
		}
	}
	msg, _ := json.Marshal(Presence{
		Type:    "presence",
		Count:   len(viewers),
		Viewers: viewers,
	})
	return msg
}

func (h *Hub) registerClient(c *websocket.Conn) {
	h.mu.Lock()
	h.clients[c] = ""
	init, _ := json.Marshal(h.state)
	_ = c.WriteMessage(websocket.TextMessage, init)
	// Don't broadcast presence — client hasn't joined yet.
	h.mu.Unlock()
}

func (h *Hub) unRegisterClient(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.sendAll(h.presenceMsg())
	h.mu.Unlock()
}

func (h *Hub) setNickname(c *websocket.Conn, name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "anonymous"
	}
	if utf8.RuneCountInString(name) > maxNicknameLen {
		name = string([]rune(name)[:maxNicknameLen])
	}
	h.mu.Lock()
	if current, ok := h.clients[c]; ok && current == "" {
		h.clients[c] = name
		h.sendAll(h.presenceMsg())
	}
	h.mu.Unlock()
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
	name, ok := h.clients[c]
	if !ok || name == "" {
		h.mu.Unlock()
		return
	}
	msg, _ := json.Marshal(ChatBroadcast{
		Type: "chat",
		Name: name,
		Text: text,
		Ts:   nowSeconds(),
	})
	h.sendAll(msg)
	h.mu.Unlock()
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
	msg, _ := json.Marshal(h.state)
	h.sendAll(msg)
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

	// Read loop.
	for {
		// Blocking call to read message when available
		_, data, err := c.ReadMessage()
		if err != nil {
			break
		}
		var env struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		switch env.Type {
		case "propose":
			var p Propose
			if json.Unmarshal(data, &p) == nil {
				h.applyProposalAndBroadcast(p)
			}
		case "chat":
			var chat ChatSend
			if json.Unmarshal(data, &chat) == nil && strings.TrimSpace(chat.Text) != "" {
				h.broadcastChat(c, strings.TrimSpace(chat.Text))
			}
		case "join":
			var j Join
			if json.Unmarshal(data, &j) == nil {
				h.setNickname(c, j.Name)
			}
		}
	}

	h.unRegisterClient(c)
}