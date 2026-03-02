package httproutes

import (
	"net/http"

	"github.com/danpythonman/synced-streaming/internal/syncing"
)

// healthHandler responds with HTTP 200 and a small body for basic health checks.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// InitializeRoutes registers HTTP handlers for the service.
//
// - GET /ws      websocket endpoint
// - GET /health  liveness probe
func InitializeRoutes(mux *http.ServeMux, hub *syncing.Hub) {
	mux.HandleFunc("/ws", hub.HandleWS)
	mux.HandleFunc("/health", healthHandler)
}
