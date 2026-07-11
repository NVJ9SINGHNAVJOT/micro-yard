# Architecture

Two binaries, one shared package tree, zero external dependencies.

```
browser ──▶ dashboard (:9001) ──proxy /api,/health──▶ server (:9000) ──▶ filesystem
              └─ serves embedded UI (web/)                └─ storage/<category>/<uuid>/
```

## Processes

| Binary       | Entry point       | Port (default) | Role                                                        |
| ------------ | ----------------- | -------------- | ----------------------------------------------------------- |
| `server`     | `cmd/server/`     | `9000`         | The API. Owns all filesystem reads/writes and metadata.     |
| `dashboard`  | `cmd/web/`        | `9001`         | Serves the embedded UI and reverse-proxies `/api` + `/health` to the server. |

The dashboard is a thin front: it embeds `web/` at build time (`web/embed.go`
via `//go:embed`) and forwards every API/health call to `API_URL`. All real work
happens in `server`.

## Packages

- `internal/api/` — HTTP handlers: upload, paginated list, metadata, download, delete.
- `internal/storage/` — filesystem layout + metadata read/write. The only code that touches disk.
- `internal/models/` — the `Media` struct shared across handlers.
- `internal/middleware/` — structured request logging with a correlation ID.
- `pkg/` — reusable helpers: UUID generation (`crypto/rand`) and the `.env` loader.
- `helper/` — response writers (JSON, paginated JSON, errors).

## Storage layout

Each upload gets its own UUID directory under a category folder, holding the file
plus a `meta.json` sidecar:

```
storage/images/a1b2c3d4-…/
├── photo.jpg
└── meta.json
```

Category is derived from the detected MIME type (`http.DetectContentType`, first
512 bytes). A failed upload cleans up its partial directory. The `storage/` tree
is created at startup and is gitignored.

## Configuration

Both binaries load `.env` from the working directory at startup (`env.LoadEnv`
from the shared `github.com/navjot/go-shared/env` package).
See the [README](../README.md#configuration) for the variable table.
