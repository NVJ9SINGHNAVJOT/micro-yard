package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// historyStore persists snapshots to one JSONL file per calendar date
// (history/2006-01-02.jsonl). Files are opened in append mode so a restart
// keeps old records instead of discarding them, and older dates remain on disk
// for later analysis. Only the currently-open file handle lives in memory —
// nothing is buffered in RAM beyond that.
type historyStore struct {
	dir string

	mu  sync.Mutex
	day string // date key of the currently open file, e.g. "2026-07-07"
	f   *os.File
	w   *bufio.Writer
}

func newHistoryStore(dir string) (*historyStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &historyStore{dir: dir}, nil
}

// dateKey is the local-date bucket a timestamp belongs to.
func dateKey(t time.Time) string { return t.Format("2006-01-02") }

func (h *historyStore) fileFor(day string) string {
	return filepath.Join(h.dir, day+".jsonl")
}

// Append writes one snapshot as a JSON line, rolling to a new day-file when the
// date changes. Each line is flushed so concurrent /history reads see whole
// lines and data survives an unclean exit.
func (h *historyStore) Append(s Snapshot) error {
	day := dateKey(time.Unix(s.TS, 0))
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.f == nil || h.day != day {
		if h.w != nil {
			_ = h.w.Flush()
		}
		if h.f != nil {
			_ = h.f.Close()
		}
		f, err := os.OpenFile(h.fileFor(day), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
		if err != nil {
			return err
		}
		h.f, h.w, h.day = f, bufio.NewWriter(f), day
	}

	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if _, err := h.w.Write(b); err != nil {
		return err
	}
	if err := h.w.WriteByte('\n'); err != nil {
		return err
	}
	return h.w.Flush()
}

// Close flushes and closes the open day-file. Safe to call once at shutdown.
func (h *historyStore) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.w != nil {
		_ = h.w.Flush()
	}
	if h.f != nil {
		err := h.f.Close()
		h.f, h.w = nil, nil
		return err
	}
	return nil
}

// Query returns all snapshots with from <= ts <= to, reading only the day-files
// the range spans. Results are sorted ascending by timestamp. If points > 0 and
// there are more samples than that, they are downsampled (spike-preserving).
func (h *historyStore) Query(from, to int64, points int) ([]Snapshot, error) {
	if to < from {
		from, to = to, from
	}
	start := time.Unix(from, 0)
	end := time.Unix(to, 0)
	cur := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
	endDay := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, end.Location())

	var out []Snapshot
	for !cur.After(endDay) {
		snaps, err := h.readDay(dateKey(cur), from, to)
		if err == nil {
			out = append(out, snaps...)
		}
		cur = cur.AddDate(0, 0, 1)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].TS < out[j].TS })
	return downsample(out, points), nil
}

// readDay parses one day-file, keeping lines whose ts is within [from,to].
// A missing file (no data for that date) returns an error the caller ignores.
func (h *historyStore) readDay(day string, from, to int64) ([]Snapshot, error) {
	f, err := os.Open(h.fileFor(day))
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var out []Snapshot
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var s Snapshot
		if err := json.Unmarshal(line, &s); err != nil {
			continue // skip a torn/partial line rather than failing the query
		}
		if s.TS < from || s.TS > to {
			continue
		}
		out = append(out, s)
	}
	return out, sc.Err()
}

// downsample reduces snaps to at most `points` samples by bucketing the time
// range evenly and keeping, per bucket, the snapshot with the highest system
// CPU — so usage spikes survive instead of being averaged away. snaps must be
// sorted ascending by TS. points <= 0 disables downsampling.
func downsample(snaps []Snapshot, points int) []Snapshot {
	if points <= 0 || len(snaps) <= points {
		return snaps
	}
	first := snaps[0].TS
	span := snaps[len(snaps)-1].TS - first
	if span <= 0 {
		return snaps[:points]
	}

	buckets := make([]*Snapshot, points)
	for i := range snaps {
		s := snaps[i]
		idx := int(float64(s.TS-first) / float64(span) * float64(points-1))
		if idx < 0 {
			idx = 0
		} else if idx >= points {
			idx = points - 1
		}
		if buckets[idx] == nil || s.System.CPUTotalPercent > buckets[idx].System.CPUTotalPercent {
			cp := s
			buckets[idx] = &cp
		}
	}

	out := make([]Snapshot, 0, points)
	for _, b := range buckets {
		if b != nil {
			out = append(out, *b)
		}
	}
	return out
}
