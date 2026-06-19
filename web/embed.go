package web

import "embed"

// Assets holds the embedded web dashboard files (index.html, style.css, app.js).
//
//go:embed index.html style.css app.js
var Assets embed.FS
