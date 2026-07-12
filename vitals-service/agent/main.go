package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/navjot/go-shared/env"
)

// collectInterval is the fixed cadence at which system + service stats are
// sampled. Fixed for now (not configurable).
const collectInterval = 2 * time.Second

// shutdownTimeout bounds how long we wait for in-flight requests to finish
// during graceful shutdown.
const shutdownTimeout = 5 * time.Second

func main() {
	// Load the shared .env first so its values are visible to the flag defaults
	// and the VITALS_* overrides below. VITALS_ENV points at the file (default
	// ../.env, i.e. vitals/.env when run from agent/); a missing file is ignored.
	envPath := envOr("VITALS_ENV", "../.env")
	if err := env.LoadEnv(envPath); err != nil {
		log.Printf("env: %v — continuing without %s", err, envPath)
	}

	configPath := flag.String("config", envOr("VITALS_CONFIG", "vitals.config.json"), "path to config file")
	uiDir := flag.String("ui", "", "path to UI dir (default: auto-detect ../ui or ./ui)")
	flag.Parse()

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Printf("config: %v — using defaults", err)
	}

	// VITALS_PORT (typically set via the shared .env) wins over the JSON config,
	// keeping the port a single source of truth shared with the vitalsbar app.
	if p := os.Getenv("VITALS_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			cfg.Port = n
		} else {
			log.Printf("VITALS_PORT=%q is not a number — ignoring", p)
		}
	}

	collector := NewCollector(cfg)

	// hist persists every snapshot to per-date files so history survives
	// restarts. If it can't be opened, we degrade to live-only rather than exit.
	hist, err := newHistoryStore(cfg.HistoryDir)
	if err != nil {
		log.Printf("history: %v — persistence disabled", err)
		hist = nil
	} else {
		log.Printf("history dir: %s", cfg.HistoryDir)
	}

	// latest holds the most recent snapshot, refreshed by the background poller
	// so HTTP handlers never block on collection.
	//
	// This first Collect() primes the collector's per-PID baseline but is NOT
	// persisted: CPU% is a delta between two samples, so the very first snapshot
	// always reports 0% (system and per-service). Recording it would leave a
	// bogus "dip to zero" in the timeline after every (re)start — visible as a
	// fake spike-down that also masks the real data gap. We serve it as the live
	// value (it self-corrects within one interval) and let the poller below
	// record the first sample that has a valid delta.
	var mu sync.RWMutex
	latest := collector.Collect()

	// ctx is cancelled on SIGINT/SIGTERM, driving graceful shutdown of both the
	// poller and the HTTP server.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		ticker := time.NewTicker(collectInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				snap := collector.Collect()
				mu.Lock()
				latest = snap
				mu.Unlock()
				if hist != nil {
					if err := hist.Append(snap); err != nil {
						log.Printf("history append: %v", err)
					}
				}
			}
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		mu.RLock()
		snap := latest
		mu.RUnlock()
		writeJSON(w, snap)
	})

	if hist != nil {
		mux.HandleFunc("/history", func(w http.ResponseWriter, r *http.Request) {
			now := time.Now().Unix()
			from := queryInt(r, "from", now-3600) // default: last hour
			to := queryInt(r, "to", now)
			points := int(queryInt(r, "points", 0)) // 0 = no downsampling
			snaps, err := hist.Query(from, to, points)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if snaps == nil {
				snaps = []Snapshot{}
			}
			writeJSON(w, map[string]any{
				"from":    from,
				"to":      to,
				"count":   len(snaps),
				"samples": snaps,
			})
		})
	}

	dir := resolveUIDir(*uiDir)
	if dir != "" {
		mux.Handle("/", http.FileServer(http.Dir(dir)))
		log.Printf("serving UI from %s", dir)
	} else {
		log.Printf("no UI dir found — API only")
	}

	addr := ":" + strconv.Itoa(cfg.Port)
	srv := &http.Server{Addr: addr, Handler: mux}

	go func() {
		log.Printf("vitals agent listening on http://localhost%s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down…")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	if hist != nil {
		if err := hist.Close(); err != nil {
			log.Printf("history close: %v", err)
		}
	}
	log.Printf("stopped")
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	// Same-origin UI, but keep CORS open for local dev flexibility.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	_ = json.NewEncoder(w).Encode(v)
}

// envOr returns the value of environment variable key, or def when unset/empty.
func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// queryInt reads an int64 query param, falling back to def when absent/invalid.
func queryInt(r *http.Request, key string, def int64) int64 {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

// resolveUIDir returns the first existing candidate UI directory.
func resolveUIDir(override string) string {
	candidates := []string{override, "../ui", "ui", "./ui"}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if fi, err := os.Stat(filepath.Join(c, "index.html")); err == nil && !fi.IsDir() {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return ""
}
