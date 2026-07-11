package web

import "embed"

// Assets holds the embedded web dashboard files (index.html, style.css, app.js)
// plus the shared design-system assets synced from ui-shared/ into web/shared/
// (run `task storage:sync-shared`; the build task does this automatically).
//
//go:embed index.html style.css app.js shared/typography.css shared/fonts
var Assets embed.FS
