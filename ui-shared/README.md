# ui-shared

Shared front-end assets used by **every** UI in the monorepo, so type and design
read the same across services. Language-agnostic on purpose — it's plain static
files (CSS + fonts), not a Go module, so a Swift, JS, or any future service can use
it too.

## What's here

```text
ui-shared/
├── typography.css   # the shared type scale (plain CSS classes + --font-family-* vars)
└── fonts/           # self-hosted variable woff2 (Inter, Space Grotesk)
```

`typography.css` exposes utility classes — `para-*`, `heading-*`, `body-*`,
`caption-*` — and the `--font-family-para/-heading/-body/-caption` custom
properties. Fonts are referenced with paths relative to the CSS file
(`./fonts/…`), so the whole folder is portable as a unit.

## How services use it

`ui-shared/` is the **single source of truth**. Because storage-service embeds its
web assets (`go:embed` can't reach outside its own folder), each service **syncs** a
copy into its own served web tree:

```bash
task storage:sync-shared   # → storage-service/web/shared/
task vitals:sync-shared    # → vitals-service/ui/shared/
```

Those copies are generated (gitignored) and are re-synced automatically by each
service's `build`/`run` tasks. Each UI links the synced file and serves it at
`/shared/typography.css`:

```html
<link rel="stylesheet" href="/shared/typography.css" />
```

## Editing

Edit files **here**, then run the `sync-shared` task(s) (or just `task <svc>:build`).
Never edit the generated `web/shared/` or `ui/shared/` copies — they get overwritten.

## Fonts

Self-hosted *variable* woff2 (latin subset), pinned to exact
[Fontsource](https://fontsource.org) package versions for reproducibility:

| File | Fontsource package | Upstream (Google) |
| --- | --- | --- |
| `fonts/InterVariable.woff2` | `@fontsource-variable/inter@5.2.8` | Inter v20 |
| `fonts/SpaceGrotesk-Variable.woff2` | `@fontsource-variable/space-grotesk@5.2.10` | Space Grotesk v22 |

To refresh (keep the same filenames so the `@font-face` `src` in `typography.css`
still resolves — bump the pinned version, don't use `@latest`):

```bash
curl -fsSL -o fonts/InterVariable.woff2 \
  "https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@5.2.8/latin-wght-normal.woff2"
curl -fsSL -o fonts/SpaceGrotesk-Variable.woff2 \
  "https://cdn.jsdelivr.net/fontsource/fonts/space-grotesk:vf@5.2.10/latin-wght-normal.woff2"
```
