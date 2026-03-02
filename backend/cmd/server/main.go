package main

import (
	"log"
	"net/http"
	"os"

	"github.com/danpythonman/synced-streaming/internal/httproutes"
	"github.com/danpythonman/synced-streaming/internal/syncing"
)

// main starts the HTTP server and registers websocket + health endpoints.
func main() {
	port := os.Getenv("PORT")
	if port == "" {
		log.Println("No port provided in environment, defaulting to port 8080")
		port = "8080"
	}

	hub := syncing.NewHub()
	mux := http.NewServeMux()
	httproutes.InitializeRoutes(mux, hub)

	addr := ":" + port
	log.Printf("ws://localhost%s/ws", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
