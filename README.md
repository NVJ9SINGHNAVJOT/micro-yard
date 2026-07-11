# micro-yard

A small monorepo — a "yard" of self-contained services and tools that run
locally, no Docker required.

## Services

| Service                                | What it is                                                                 | Stack                    | Port(s)      |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------ | ------------ |
| [storage-service](storage-service/)    | Personal HTTP file storage — upload, retrieve, and serve files, with a web dashboard. | Go (stdlib only)         | 9000 / 9001  |
| [vitals](vitals/)                       | Local dashboard for CPU/RAM/GPU of your machine and watched services, with a macOS menubar app. | Go + gopsutil, JS UI, Swift | 4500         |

Each service is self-contained: its own `go.mod`, its own `Taskfile.yml`, and its
own `README.md` + `docs/`. Start with a service's README.

## Layout

```text
micro-yard/
├── README.md              # you are here — the service catalog
├── Taskfile.yml           # root tasks that delegate into each service
├── docs/                  # cross-service docs only
│   ├── architecture.md    # how the services relate
│   └── conventions.md     # the layout + docs rules every service follows
├── ui-shared/             # shared front-end assets (typography, fonts) for every UI
├── storage-service/       # ── service
└── vitals/                # ── service
```

## Getting started

Each service runs independently. From the repo root:

```bash
task storage:run     # storage API on :9000
task storage:web     # storage dashboard on :9001
task vitals:run      # vitals agent + UI on :4500
```

Or `cd` into a service and use its own `Taskfile.yml` directly. Run `task` with no
arguments to list everything.

## Conventions

New services follow the layout and docs rules in
[docs/conventions.md](docs/conventions.md) — a `README.md` front door plus a
`docs/` folder (`api.md`, `setup.md`, `architecture.md`) so every service reads the
same way.

## License

[MIT](LICENSE).
