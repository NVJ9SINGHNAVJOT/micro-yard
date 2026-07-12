package main

import (
	"encoding/json"
	"os"
)

// ServiceSpec describes one watched service. A running process is matched by
// substring against its name/cmdline (Match) and/or by a listening TCP port
// (Port). If both are set, Port is preferred and Match is used as a fallback.
type ServiceSpec struct {
	Name  string `json:"name"`
	Match string `json:"match"`
	Port  int    `json:"port"`
}

// Config is the editable watchlist loaded from vitals.config.json.
// The collection interval is fixed (see collectInterval in main.go) and is
// intentionally not configurable for now.
type Config struct {
	Port       int           `json:"port"`
	GPU        bool          `json:"gpu"`
	HistoryDir string        `json:"history_dir"`
	Services   []ServiceSpec `json:"services"`
}

func defaultConfig() Config {
	return Config{Port: 4500, GPU: true, HistoryDir: "history"}
}

// loadConfig reads path, falling back to sane defaults for any missing field.
func loadConfig(path string) (Config, error) {
	cfg := defaultConfig()
	b, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, err
	}
	if cfg.Port == 0 {
		cfg.Port = 4500
	}
	if cfg.HistoryDir == "" {
		cfg.HistoryDir = "history"
	}
	return cfg, nil
}
