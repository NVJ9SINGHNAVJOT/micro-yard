package storage

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/navjot/storage-service/internal/models"

	"github.com/navjot/go-shared/uuid"
)

const StorageRoot = "./storage"

var categories = []string{"images", "videos", "audio", "documents", "others"}

type FileSystem struct {
	root string
}

func New() *FileSystem {
	return &FileSystem{root: StorageRoot}
}

func (fs *FileSystem) Init() error {
	for _, cat := range categories {
		if err := os.MkdirAll(filepath.Join(fs.root, cat), 0755); err != nil {
			return err
		}
	}
	return nil
}

func categoryFromMIME(mime string) string {
	switch {
	case strings.HasPrefix(mime, "image/"):
		return "images"
	case strings.HasPrefix(mime, "video/"):
		return "videos"
	case strings.HasPrefix(mime, "audio/"):
		return "audio"
	case mime == "application/pdf",
		strings.HasPrefix(mime, "text/"),
		mime == "application/msword",
		mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return "documents"
	default:
		return "others"
	}
}

func (fs *FileSystem) DirForID(id string) (string, error) {
	for _, cat := range categories {
		dir := filepath.Join(fs.root, cat, id)
		if _, err := os.Stat(dir); err == nil {
			return dir, nil
		}
	}
	return "", errors.New("media not found")
}

func (fs *FileSystem) Save(file multipart.File, header *multipart.FileHeader) (*models.Media, error) {
	// Read first 512 bytes for MIME detection, then reassemble full reader
	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	buf = buf[:n]

	mimeType := http.DetectContentType(buf)
	if mimeType == "application/octet-stream" && header.Header.Get("Content-Type") != "" {
		mimeType = header.Header.Get("Content-Type")
	}

	id, err := uuid.NewUUID()
	if err != nil {
		return nil, err
	}

	category := categoryFromMIME(mimeType)
	dir := filepath.Join(fs.root, category, id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	dest, err := os.Create(filepath.Join(dir, header.Filename))
	if err != nil {
		if rmErr := os.RemoveAll(dir); rmErr != nil {
			slog.Error("failed to clean up directory after create error", "dir", dir, "error", rmErr)
		}
		return nil, err
	}
	defer dest.Close()

	written, err := io.Copy(dest, io.MultiReader(bytes.NewReader(buf), file))
	if err != nil {
		if rmErr := os.RemoveAll(dir); rmErr != nil {
			slog.Error("failed to clean up directory after write error", "dir", dir, "error", rmErr)
		}
		return nil, err
	}

	m := &models.Media{
		ID:               id,
		Filename:         header.Filename,
		OriginalFilename: header.Filename,
		MimeType:         mimeType,
		Size:             written,
		Category:         category,
		CreatedAt:        time.Now().UTC(),
	}

	if err := writeMeta(dir, m); err != nil {
		if rmErr := os.RemoveAll(dir); rmErr != nil {
			slog.Error("failed to clean up directory after metadata write error", "dir", dir, "error", rmErr)
		}
		return nil, err
	}
	return m, nil
}

func (fs *FileSystem) Get(id string) (*models.Media, error) {
	dir, err := fs.DirForID(id)
	if err != nil {
		return nil, err
	}
	return readMeta(dir)
}

func (fs *FileSystem) Delete(id string) error {
	dir, err := fs.DirForID(id)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

func (fs *FileSystem) List() ([]*models.Media, error) {
	return fs.ListFiltered("")
}

func (fs *FileSystem) ListFiltered(category string) ([]*models.Media, error) {
	var results []*models.Media

	root := fs.root
	if category != "" {
		root = filepath.Join(fs.root, category)
		if _, err := os.Stat(root); err != nil {
			return results, nil
		}
	}

	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && d.Name() == "meta.json" {
			m, err := readMeta(filepath.Dir(path))
			if err != nil {
				return err
			}
			results = append(results, m)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return results, nil
}
