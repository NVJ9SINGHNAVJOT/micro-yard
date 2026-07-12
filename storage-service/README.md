# Storage Service

A lightweight personal file storage service written in Go using only the standard library. Upload files via HTTP, retrieve them by ID, and serve them back — all stored on the local filesystem with metadata tracked in JSON files alongside each upload.

## Tech Stack

| Layer       | Technology                                                  |
| ----------- | ----------------------------------------------------------- |
| Language    | [Go 1.25](https://go.dev)                                   |
| HTTP server | `net/http` — stdlib router with Go 1.22+ pattern matching   |
| Storage     | Local filesystem via `os`, `io`, `path/filepath`            |
| Metadata    | JSON files via `encoding/json`                              |
| MIME detect | `http.DetectContentType` (reads first 512 bytes)            |
| UUID        | `crypto/rand` — no external package                         |
| Logging     | `log/slog` — structured JSON logs                           |
| Config      | `.env` file parsed with `bufio` — no external package       |

> Zero external dependencies. Everything is Go standard library.

## Requirements

- Go 1.25+
- [Task](https://taskfile.dev) (optional, for `task` commands)

## Quick Start

```bash
cp .env.example .env   # edit PORT if needed
task run               # or: go run ./cmd/server/
```

The server starts on the port set in `.env` (default `9000`).

## Configuration

Copy `.env.example` to `.env` and set the values:

| Variable   | Default                 | Description                            |
| ---------- | ----------------------- | -------------------------------------- |
| `PORT`     | `9000`                  | Port the API server listens on         |
| `WEB_PORT` | `9001`                  | Port the web dashboard listens on      |
| `API_URL`  | `http://localhost:9000` | API base URL the dashboard proxies to  |

## Available Tasks

| Command          | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `task run`       | Run the API server                                        |
| `task web`       | Run the web dashboard (requires the API server running)   |
| `task start`     | Build and run the compiled API server binary              |
| `task start-web` | Build and run the compiled web dashboard binary           |
| `task build`     | Build server and dashboard binaries to `bin/`             |
| `task build-web` | Build only the dashboard binary to `bin/`                 |
| `task check`     | Format, vet, and build (run before committing)            |
| `task fmt`       | Format all Go source files                                |
| `task vet`       | Run `go vet` across all packages                          |
| `task tidy`      | Tidy `go.mod`                                             |
| `task clean`     | Remove build artifacts                                    |

## Project Structure

```text
storage-service/
├── cmd/
│   ├── server/          # API server entry point
│   └── web/             # Web dashboard entry point (reverse proxy + embedded UI)
├── internal/
│   ├── api/             # HTTP handlers (paginated list, metadata, download, delete)
│   ├── models/          # Media struct
│   └── storage/         # Filesystem and metadata logic
├── pkg/                 # Shared utilities (UUID generation, .env loader)
├── helper/              # Response helpers (JSON, paginated JSON, error writers)
├── web/                 # Dashboard frontend (HTML, CSS, JS — embedded at build time)
├── storage/             # Uploaded files (gitignored, created at startup)
│   ├── images/
│   ├── videos/
│   ├── audio/
│   ├── documents/
│   └── others/
├── docs/
│   ├── api.md           # Full API reference
│   └── architecture.md  # How the pieces fit together
├── .env.example
└── Taskfile.yml
```

## Storage Layout

Each uploaded file gets its own directory named by UUID:

```text
storage/
└── images/
    └── a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789/
        ├── photo.jpg
        └── meta.json
```

If an upload fails midway, the partial directory is automatically cleaned up.

## Web Dashboard

The built-in web dashboard runs on port `9001` and proxies API calls to the server on port `9000`.

**Features:**

- **Infinite scroll** — loads 50 files at a time; scrolling near the bottom automatically fetches the next batch.
- **3 view modes** — switch between compact, default, and large card layouts via the view toggle in the toolbar. Preference is saved in `localStorage`.
- **Category filtering** — browse by All Files, Images, Videos, Audio, Documents, or Others.
- **Sort controls** — sort by date or file size, ascending or descending.
- **Lightbox** — click the view button on image/video cards to preview in a full-screen modal.
- **Bulk delete** — delete all files in a category with a single action.

## API

See [docs/api.md](docs/api.md) for the full endpoint reference.

### Quick reference

| Method   | Path                    | Description                                      |
| -------- | ----------------------- | ------------------------------------------------ |
| `GET`    | `/health`               | Health check                                     |
| `POST`   | `/api/media/upload`     | Upload a file                                    |
| `GET`    | `/api/media`            | List files (paginated — `limit`, `offset`)       |
| `GET`    | `/api/media/{id}`       | Get file metadata                                |
| `GET`    | `/api/media/{id}/file`  | Download the file                                |
| `DELETE` | `/api/media/{id}`       | Delete a file                                    |
