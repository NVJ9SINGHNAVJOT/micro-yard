# Architecture

```
watched processes ─▶  Go agent (:4500)  ─▶  /stats   (latest sample)      ─▶  vanilla JS UI
                          └─ system CPU/RAM  ├─ /history (per-date JSONL)  ─▶  timeline charts
                             + GPU via IOKit
```

One process. The agent (`agent/`, pure-stdlib Go — it shells out to `ps`, `lsof`,
`vm_stat`, `sysctl`, and `ioreg`, so there are **no external modules**) samples the OS on a
**fixed 2-second cadence** in the background, serves the latest
sample from `/stats`, and serves the `ui/` app from `/` — so there's a single
binary and no CORS setup. A separate Swift menubar app (`vitalsbar/`) can read the
same `/stats` endpoint.

## Service matching

Each configured service is resolved to a PID **every poll**, so services can
start/stop/restart freely and the dashboard follows them. Matching is by:

- **`port`** — the PID bound to that listening TCP port (most precise; preferred).
- **`match`** — a substring of the process name or full command line (fallback).

If both are set, `port` wins. A service that isn't running shows as **not running**
rather than erroring.

> For a multi-process service like ollama (which spawns model-runner children),
> the current reading is the matched process only, not the whole tree.
> Child-aggregation is a planned refinement.

## History storage

Every 2-second sample is appended to a JSONL file, one file **per date**
(`history/2026-07-07.jsonl` by default; set `"history_dir"` in the config to move
it). Append mode means **restarts keep old records**, and older dates stay on disk
for later analysis — only the current file handle lives in RAM. There's no
automatic pruning yet; delete old day-files by hand if disk matters
(~8–9 MB/day at the fixed cadence).

The agent shuts down gracefully on `Ctrl-C`/`SIGTERM`: it stops the poller, lets
in-flight HTTP requests finish, and flushes + closes the history file.

## Notes

- CPU% is instantaneous and top-style (fraction of a single core; a busy
  process spread across several cores can exceed 100%).
- The live snapshot is in-memory; history is persisted to per-date JSONL files.
- Stats collection needs no privileges at all, GPU included — see [gpu.md](gpu.md).
