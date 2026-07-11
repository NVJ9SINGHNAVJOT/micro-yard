package main

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"

	"github.com/navjot/go-shared/env"
	"github.com/navjot/storage-service/web"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	if err := env.LoadEnv(".env"); err != nil {
		slog.Error("failed to load .env", "error", err)
		os.Exit(1)
	}

	webPort := os.Getenv("WEB_PORT")
	if webPort == "" {
		webPort = "9001"
	}

	apiAddr := os.Getenv("API_URL")
	if apiAddr == "" {
		slog.Error("API_URL is required")
		os.Exit(1)
	}

	apiURL, err := url.Parse(apiAddr)
	if err != nil {
		slog.Error("invalid API_URL", "value", apiAddr, "error", err)
		os.Exit(1)
	}

	proxy := httputil.NewSingleHostReverseProxy(apiURL)

	mux := http.NewServeMux()

	// Proxy all API and health requests to the main server
	mux.Handle("/api/", proxy)
	mux.Handle("/health", proxy)

	// Serve the embedded web dashboard
	mux.Handle("/", http.FileServerFS(web.Assets))

	slog.Info("web dashboard starting", "port", webPort, "api", apiAddr)
	if err := http.ListenAndServe(":"+webPort, mux); err != nil {
		slog.Error("web server stopped", "error", err)
		os.Exit(1)
	}
}
