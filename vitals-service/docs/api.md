# API reference

Two JSON endpoints plus the UI, all sampled on the fixed 2-second cadence.

## `GET /stats` — current snapshot

Returns one object with three sections:

| Section    | Field                | Meaning                                          |
|------------|----------------------|--------------------------------------------------|
| `system`   | `cpu_total_percent`  | Total CPU utilization across all cores (0–100).  |
|            | `mem_used_mb`        | RAM in use, MB.                                   |
|            | `mem_total_mb`       | Total RAM, MB.                                    |
|            | `mem_percent`        | RAM used, percent.                               |
| `gpu`      | `gpu_util_percent`   | System GPU utilization, percent (macOS).         |
|            | `available`          | `false` if GPU sampling is off/unavailable.      |
| `services` | *(per watched name)* | `pid`, `cpu_percent`, `rss_mb`, `running`. When `running` is `false`, the other fields are omitted/zero. |
| top-level  | `ts`                 | Unix timestamp of the sample.                    |

```json
{
  "system": { "cpu_total_percent": 9.8, "mem_used_mb": 12236.1, "mem_total_mb": 16384, "mem_percent": 74.7 },
  "gpu": { "gpu_util_percent": 2.5, "available": true },
  "services": {
    "redis":  { "pid": 38447, "cpu_percent": 0.1, "rss_mb": 4.3, "running": true },
    "ollama": { "running": false }
  },
  "ts": 1783412993
}
```

## `GET /history` — samples over a time range

Powers the timeline charts. Query params (all optional):

| Param    | Default        | Meaning                                                        |
|----------|----------------|----------------------------------------------------------------|
| `from`   | now − 1h       | Unix seconds, start of range (inclusive).                      |
| `to`     | now            | Unix seconds, end of range (inclusive).                        |
| `points` | 0 (no cap)     | Downsample to at most N points, keeping the **max-CPU** sample per bucket so spikes survive. |

Returns `{ "from", "to", "count", "samples": [ <snapshot>, … ] }`, where each
snapshot has the same shape as `/stats`. Only the day-files the range spans are
read from disk.

```bash
curl -s "http://localhost:4500/history?from=$(($(date +%s)-3600))&to=$(date +%s)&points=600" | jq '.count'
```

## `GET /` — the dashboard UI

Serves the `ui/` app (live gauges + the timeline).
