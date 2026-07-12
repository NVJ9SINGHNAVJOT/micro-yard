# Architecture

micro-yard is a monorepo, not a distributed system. The services are independent —
they don't call each other and share no runtime state. What they share is a repo,
a set of [conventions](conventions.md), and your local machine.

```text
micro-yard/
├── storage-service/   HTTP file storage             :9000 (API) + :9001 (dashboard)
└── vitals-service/    local system/service monitor  :4500
```

Each service has its own process model and its own docs — see:

- [storage-service/docs/architecture.md](../storage-service/docs/architecture.md)
- [vitals-service/docs/architecture.md](../vitals-service/docs/architecture.md)

## Why a monorepo

- **One place, many tools.** These are small, personal, Docker-free services; a
  single repo keeps them discoverable and versioned together without the overhead
  of separate repos each.
- **Independent still.** Each service owns its build (its own `go.mod`/manifest) and
  its own `Taskfile.yml`, so it builds, runs, and is deployed on its own. Nothing
  ties the languages together at the root — there's no Go workspace file, because not
  every service is Go. Moving or dropping a service touches only its own folder.
- **A little shared, on purpose.** Cross-cutting front-end assets live in
  [`ui-shared/`](../ui-shared/) (typography, fonts) so every UI reads the same. It's
  plain static files, not a module — each service syncs a copy into its own web tree.

## Adding a service

1. Create `<service>/` at the repo root with its own `go.mod`/manifest.
2. Add a `README.md` + `docs/` following [conventions.md](conventions.md).
3. Add a `Taskfile.yml` exposing `run`/`build`/`check`/`clean`.
4. Register it in the root `Taskfile.yml` and the catalog in the root
   [README](../README.md). If it has a UI, sync [`ui-shared/`](../ui-shared/) into it
   (see conventions.md).
