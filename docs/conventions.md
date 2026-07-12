# Conventions

Rules every service in this monorepo follows, so they all read and run the same way.

## One folder per service

Each service is a self-contained peer directory at the repo root
(`storage-service/`, `vitals-service/`, …). A service owns everything it needs:

- its own `go.mod` (or `Package.swift`, `package.json`, …) — modules are **not**
  shared or hoisted to the root;
- its own `Taskfile.yml`;
- its own `README.md` and `docs/`.

Nothing service-specific lives at the repo root. The root holds only the catalog
(`README.md`), the delegating `Taskfile.yml`, cross-service `docs/`, and shared
front-end assets (`ui-shared/` — see [Shared front-end assets](#shared-front-end-assets)).

## Docs structure

The rule: **`README.md` = "use it in 5 minutes"; `docs/` = "everything deeper",
one concern per file.**

```text
<service>/
├── README.md          # the only doc a newcomer must read
└── docs/
    ├── api.md         # endpoint / interface reference (if it exposes one)
    ├── setup.md       # prerequisites, config, environment, first run
    ├── architecture.md# how it works inside — data flow, design decisions
    └── *.md           # any other deep dive (e.g. vitals-service/docs/gpu.md)
```

### README.md

Keep it short and push depth into `docs/`. Sections, in order:

1. One-line description of what it is.
2. Tech stack (a small table is fine).
3. Quick start — the shortest path to a running service.
4. A folder map.
5. Links into `docs/`.

### docs/

One concern per file. Not every service needs every file — create `api.md` only if
there's an API, `setup.md` only if setup is more than "run it". Link between docs
with relative paths.

## Tasks

Every service exposes the same core task verbs so muscle memory carries across
services: `run`, `build`, `check` (`fmt` + `vet` + `build`), `clean`. The root
`Taskfile.yml` re-exposes them namespaced, e.g. `task storage:run`, `task vitals:run`.

## Go modules

Multi-module: each Go service has its own `go.mod` and builds from its own folder
(`cd <service> && go build ./...`, or via its `Taskfile.yml`). The root `go.work`
lists only the Go modules — the shared `go-shared/` library plus each Go service —
so they resolve `go-shared` from the working tree instead of a published version.
Non-Go services stay out of it (e.g. `vitals-service/vitalsbar` is Swift). Add a new
Go module's folder to `go.work` when you create it, or its build breaks at the root.

Keep module paths stable (`github.com/navjot/<name>`) — they're independent of the
folder, so a service can move without a rename. The folder still has to be renamed in
`go.work`, the root `Taskfile.yml`, and the docs.

## Shared front-end assets

Cross-cutting UI assets live in `ui-shared/` at the repo root — the one exception to
"nothing shared," alongside cross-service `docs/`. It holds the shared typography
(`typography.css`) and self-hosted fonts every UI uses, kept as **plain static files,
not a module**, so any service (Go, Swift, JS, …) can use them.

`ui-shared/` is the single source of truth. Because storage-service embeds its web
assets (`go:embed` can't reach outside its own folder), each UI service **syncs** a
copy into its own served tree with a `sync-shared` task (wired into `build`/`run`);
the copies are generated and gitignored. Edit in `ui-shared/`, never in the copies.
See [ui-shared/README.md](../ui-shared/README.md).
