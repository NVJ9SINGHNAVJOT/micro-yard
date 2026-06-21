package api

import (
	"net/http"

	"github.com/navjot/storage-service/helper"
	"github.com/navjot/storage-service/internal/middleware"
	"github.com/navjot/storage-service/internal/storage"
)

func Upload(fs *storage.FileSystem) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			helper.WriteError(w, http.StatusBadRequest, "invalid multipart form")
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			helper.WriteError(w, http.StatusBadRequest, "missing file field")
			return
		}
		defer file.Close()

		m, err := fs.Save(file, header)
		if err != nil {
			middleware.LoggerFromContext(r.Context()).Error("failed to save uploaded file", "filename", header.Filename, "error", err)
			helper.WriteError(w, http.StatusInternalServerError, "failed to save file")
			return
		}

		helper.WriteJSON(w, http.StatusCreated, m)
	}
}
