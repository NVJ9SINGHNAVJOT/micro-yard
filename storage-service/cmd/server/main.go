package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/navjot/storage-service/internal/api"
	"github.com/navjot/storage-service/internal/middleware"
	"github.com/navjot/storage-service/internal/storage"

	"github.com/navjot/go-shared/env"
)

const shutdownTimeout = 30 * time.Second

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	if err := env.LoadEnv(".env"); err != nil {
		slog.Error("failed to load .env", "error", err)
		os.Exit(1)
	}

	fs := storage.New()
	if err := fs.Init(); err != nil {
		slog.Error("failed to initialize storage directories", "error", err)
		os.Exit(1)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "9000"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", api.Health)

	mux.HandleFunc("POST /api/media/upload", api.Upload(fs))
	mux.HandleFunc("GET /api/media", api.List(fs))
	mux.HandleFunc("GET /api/media/{id}", api.Metadata(fs))
	mux.HandleFunc("GET /api/media/{id}/file", api.Download(fs))
	mux.HandleFunc("DELETE /api/media/{id}", api.Delete(fs))

	server := &http.Server{
		Addr:    ":" + port,
		Handler: middleware.Logging(mux),
	}

	// Listen for SIGINT / SIGTERM in a separate goroutine.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-quit
		slog.Info("shutdown signal received, draining connections…", "signal", sig.String())

		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		// Shutdown stops accepting new connections and waits for in-flight
		// requests to finish (up to shutdownTimeout).
		if err := server.Shutdown(ctx); err != nil {
			slog.Error("graceful shutdown failed, forcing exit", "error", err)
			os.Exit(1)
		}

		slog.Info("all connections drained, server stopped gracefully")
	}()

	slog.Info("storage service starting", "port", port)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped unexpectedly", "error", err)
		os.Exit(1)
	}

	slog.Info("server exited")
}
