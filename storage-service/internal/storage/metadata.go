package storage

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/navjot/storage-service/internal/models"
)

func readMeta(dir string) (*models.Media, error) {
	f, err := os.Open(filepath.Join(dir, "meta.json"))
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var m models.Media
	if err := json.NewDecoder(f).Decode(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

func writeMeta(dir string, m *models.Media) error {
	f, err := os.Create(filepath.Join(dir, "meta.json"))
	if err != nil {
		return err
	}
	defer f.Close()
	return json.NewEncoder(f).Encode(m)
}
