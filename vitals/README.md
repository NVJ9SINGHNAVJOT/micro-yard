# Vitals

A lightweight, Docker-free local dashboard for CPU, RAM, and GPU usage of your
local backend services (redis, ollama, your own project servers) plus system-wide
load. A tiny Go agent reads OS stats from standard macOS tools (`ps`, `lsof`,
`vm_stat`, `sysctl`) with **no external Go modules**, and serves JSON + a plain
HTML/JS UI from a single binary.

```
watched processes ─▶  Go agent (:4500)  ─▶  /stats   (latest sample)      ─▶  vanilla JS UI
                          └─ system CPU/RAM  ├─ /history (per-date JSONL)  ─▶  timeline charts
                             + GPU via powermetrics
```

The UI has two parts: **live gauges + service cards** (polling `/stats`) and a
**Timeline** with a From→To picker and a **Live** toggle — a system spike chart
plus two per-service charts (CPU % and RAM MB) you can filter and hover for exact
values. It's backed by `/history`, so you can scrub back to "what was using the
machine at 3:47pm".

## Run

```bash
cd agent
go mod tidy          # first time only
go run .             # or: go build -o vitals-agent . && ./vitals-agent
```

Then open **http://localhost:4500/**. The agent serves the UI from `../ui`, so
there's one process and no CORS setup.

```bash
curl -s http://localhost:4500/stats | jq   # quick API check
```

## Choose what to monitor

Edit `agent/vitals.config.json` — no code changes, no restart-per-service needed.
PIDs are re-resolved every poll, so services can start/stop/restart freely.

```json
{
  "port": 4500,
  "gpu": true,
  "services": [
    { "name": "redis",  "match": "redis-server", "port": 6379 },
    { "name": "ollama", "match": "ollama",        "port": 11434 },
    { "name": "my-api", "match": "my-project-bin" }
  ]
}
```

Match by `port` (the PID bound to that listening port — preferred) or `match` (a
substring of the process name / command line). The collection interval is fixed at
**2 seconds**. See [docs/architecture.md](docs/architecture.md) for how matching,
sampling, and history work.

## Menubar app (macOS)

`vitalsbar/` is a small native macOS menubar app (Swift 6, macOS 26 Tahoe+) that reads the
same `/stats` endpoint and shows a live glance from the menu bar — no browser tab
needed. It's part of vitals, not a separate project; the agent must be running on
`:4500` for it to have data.

```bash
cd vitalsbar
swift run VitalsBar          # build + run (or: swift build -c release)
```

Or from the vitals folder via Task:

```bash
task bar-start               # build + run the menubar app
task bar-build               # just compile the release binary (.build/release/VitalsBar)
```

## Layout

```text
vitals/
├── agent/        # Go agent — samples OS + services, serves /stats, /history, UI
├── ui/           # vanilla HTML/CSS/JS dashboard (served by the agent)
├── vitalsbar/    # Swift macOS menubar app (reads the same /stats endpoint)
└── docs/
    ├── api.md          # /stats + /history reference
    ├── architecture.md # how sampling, matching, and history work
    └── gpu.md          # macOS GPU (powermetrics/sudoers) setup
```

## Docs

- [docs/api.md](docs/api.md) — the `/stats` and `/history` endpoints.
- [docs/architecture.md](docs/architecture.md) — sampling cadence, service matching, history storage.
- [docs/gpu.md](docs/gpu.md) — enabling the GPU gauge on macOS (needs a scoped sudoers entry). Without it everything else still works and the GPU gauge shows **n/a**.
