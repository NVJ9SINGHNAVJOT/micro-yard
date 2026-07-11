package api

import (
	"net/http"
	"path/filepath"
	"slices"
	"strconv"

	"github.com/navjot/storage-service/helper"
	"github.com/navjot/storage-service/internal/middleware"
	"github.com/navjot/storage-service/internal/models"
	"github.com/navjot/storage-service/internal/storage"
)

func List(fs *storage.FileSystem) http.HandlerFunc {
	validCategories := map[string]bool{
		"images": true, "videos": true, "audio": true,
		"documents": true, "others": true,
	}

	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		category := q.Get("category")
		if category != "" && !validCategories[category] {
			category = ""
		}

		sortBy := q.Get("sort_by")
		if sortBy != "size" && sortBy != "created_at" {
			sortBy = "created_at"
		}

		order := q.Get("order")
		if order != "asc" && order != "desc" {
			order = "desc"
		}

		// Pagination defaults
		limit := 50
		if v := q.Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				limit = n
			}
		}
		if limit < 1 {
			limit = 1
		}
		if limit > 100 {
			limit = 100
		}

		offset := 0
		if v := q.Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				offset = n
			}
		}

		media, err := fs.ListFiltered(category)
		if err != nil {
			middleware.LoggerFromContext(r.Context()).Error("failed to list media", "error", err)
			helper.WriteError(w, http.StatusInternalServerError, "failed to list media")
			return
		}
		if media == nil {
			media = []*models.Media{}
		}

		slices.SortFunc(media, func(a, b *models.Media) int {
			var cmp int
			switch sortBy {
			case "size":
				switch {
				case a.Size < b.Size:
					cmp = -1
				case a.Size > b.Size:
					cmp = 1
				}
			default:
				cmp = a.CreatedAt.Compare(b.CreatedAt)
			}
			if order == "desc" {
				cmp = -cmp
			}
			return cmp
		})

		total := len(media)

		// Apply offset/limit
		if offset > total {
			offset = total
		}
		end := offset + limit
		if end > total {
			end = total
		}
		page := media[offset:end]

		helper.WritePaginatedJSON(w, http.StatusOK, page, helper.Pagination{
			Total:   total,
			Limit:   limit,
			Offset:  offset,
			HasMore: end < total,
		})
	}
}

func Metadata(fs *storage.FileSystem) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		m, err := fs.Get(id)
		if err != nil {
			helper.WriteError(w, http.StatusNotFound, "media not found")
			return
		}
		helper.WriteJSON(w, http.StatusOK, m)
	}
}

func Download(fs *storage.FileSystem) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		dir, err := fs.DirForID(id)
		if err != nil {
			helper.WriteError(w, http.StatusNotFound, "media not found")
			return
		}
		m, err := fs.Get(id)
		if err != nil {
			middleware.LoggerFromContext(r.Context()).Error("failed to read metadata for download", "id", id, "error", err)
			helper.WriteError(w, http.StatusInternalServerError, "failed to read metadata")
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, m.Filename))
	}
}
