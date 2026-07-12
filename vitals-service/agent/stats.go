package main

import (
	"bufio"
	"bytes"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SystemStats is the machine-wide snapshot: total CPU, RAM, (GPU is separate).
type SystemStats struct {
	CPUTotalPercent float64 `json:"cpu_total_percent"`
	MemUsedMB       float64 `json:"mem_used_mb"`
	MemTotalMB      float64 `json:"mem_total_mb"`
	MemPercent      float64 `json:"mem_percent"`
}

// ServiceStats is one watched service's snapshot. When the process isn't
// running, only Running is meaningful.
type ServiceStats struct {
	PID        int32   `json:"pid,omitempty"`
	CPUPercent float64 `json:"cpu_percent"`
	RSSMB      float64 `json:"rss_mb"`
	Running    bool    `json:"running"`
}

// Snapshot is the full /stats payload.
type Snapshot struct {
	System   SystemStats             `json:"system"`
	GPU      GPUStats                `json:"gpu"`
	Services map[string]ServiceStats `json:"services"`
	TS       int64                   `json:"ts"`
}

// procInfo is one row from `ps -A`: everything we can learn about a process in
// a single, cheap exec.
type procInfo struct {
	pid        int32
	rssKB      int64
	cpuSeconds float64 // cumulative CPU time consumed since the process started
	command    string  // full command line (executable path + args)
}

// Collector holds state needed to compute instantaneous deltas between polls.
// Stats are read by shelling out to standard macOS tools (ps, lsof, vm_stat,
// sysctl) so the agent depends on no external Go modules.
type Collector struct {
	cfg        Config
	mu         sync.Mutex
	prev       map[int32]float64 // pid -> cumulative CPU seconds, as of prevAt
	prevAt     time.Time
	memTotalMB float64 // machine RAM, read once (it doesn't change)
	gpu        *gpuSampler
}

func NewCollector(cfg Config) *Collector {
	c := &Collector{
		cfg:        cfg,
		prev:       map[int32]float64{},
		memTotalMB: round1(readMemTotalBytes() / 1024 / 1024),
	}
	if cfg.GPU {
		c.gpu = newGPUSampler()
	}
	return c
}

// Collect gathers one full snapshot. Every process is read once via `ps -A`;
// that single dataset feeds both the machine-wide CPU total and per-service
// stats, so a poll costs ~2 short-lived subprocesses (ps + lsof) plus vm_stat.
func (c *Collector) Collect() Snapshot {
	now := time.Now()
	procs := readProcs()
	ports := listeningPortMap()

	// Snapshot cumulative CPU-seconds per pid and swap it in as the new baseline;
	// the previous baseline (captured here) is what deltas are measured against.
	cur := make(map[int32]float64, len(procs))
	for _, p := range procs {
		cur[p.pid] = p.cpuSeconds
	}
	c.mu.Lock()
	prev := c.prev
	wall := now.Sub(c.prevAt).Seconds()
	c.prev = cur
	c.prevAt = now
	c.mu.Unlock()

	snap := Snapshot{
		Services: map[string]ServiceStats{},
		TS:       now.Unix(),
	}
	snap.System = c.system(cur, prev, wall)
	snap.Services = c.services(procs, ports, prev, wall)
	if c.gpu != nil {
		snap.GPU = c.gpu.Read()
	} else {
		snap.GPU = GPUStats{Available: false}
	}
	return snap
}

func (c *Collector) system(cur, prev map[int32]float64, wall float64) SystemStats {
	s := SystemStats{MemTotalMB: c.memTotalMB}

	// Total CPU%: sum each process's CPU-second delta over processes present in
	// both samples, then normalize by wall time and core count (100 = all cores
	// busy). Processes that appeared or exited entirely within the interval are
	// ignored — a minor undercount at a 2s cadence, but it keeps the value
	// stable (no negative spikes from vanished PIDs).
	if wall > 0 && len(prev) > 0 {
		var delta float64
		for pid, cs := range cur {
			if pcs, ok := prev[pid]; ok && cs >= pcs {
				delta += cs - pcs
			}
		}
		s.CPUTotalPercent = round1(delta / wall / float64(runtime.NumCPU()) * 100)
	}

	// Memory: "available" is free + inactive (matching the previous behavior);
	// used is everything else.
	if avail, ok := readMemAvailableBytes(); ok && c.memTotalMB > 0 {
		usedMB := c.memTotalMB - avail/1024/1024
		if usedMB < 0 {
			usedMB = 0
		}
		s.MemUsedMB = round1(usedMB)
		s.MemPercent = round1(usedMB / c.memTotalMB * 100)
	}
	return s
}

// services resolves each watched spec to a live PID and reads its stats from
// the already-collected process list.
func (c *Collector) services(procs []procInfo, ports map[int]int32, prev map[int32]float64, wall float64) map[string]ServiceStats {
	byPID := make(map[int32]procInfo, len(procs))
	for _, p := range procs {
		byPID[p.pid] = p
	}

	out := map[string]ServiceStats{}
	for _, spec := range c.cfg.Services {
		pid := resolvePID(spec, procs, ports)
		p, ok := byPID[pid]
		if pid == 0 || !ok {
			out[spec.Name] = ServiceStats{Running: false}
			continue
		}
		st := ServiceStats{PID: pid, Running: true}
		st.RSSMB = round1(float64(p.rssKB) / 1024)
		// Instantaneous CPU% as a fraction of a single core (top-style; may
		// exceed 100 when a process runs on several cores at once), from the
		// delta since the previous poll.
		if wall > 0 {
			if pcs, ok := prev[pid]; ok && p.cpuSeconds >= pcs {
				st.CPUPercent = round1((p.cpuSeconds - pcs) / wall * 100)
			}
		}
		out[spec.Name] = st
	}
	return out
}

// resolvePID picks a PID for spec: listening-port match first, then a substring
// of the full command line.
func resolvePID(spec ServiceSpec, procs []procInfo, ports map[int]int32) int32 {
	if spec.Port != 0 {
		if pid, ok := ports[spec.Port]; ok {
			return pid
		}
	}
	if spec.Match == "" {
		return 0
	}
	needle := strings.ToLower(spec.Match)
	for _, p := range procs {
		if strings.Contains(strings.ToLower(p.command), needle) {
			return p.pid
		}
	}
	return 0
}

// readProcs lists every process once via `ps -A`. Output columns are
// pid, rss (KB), cumulative CPU time, and the full command line.
func readProcs() []procInfo {
	out, err := exec.Command("ps", "-A", "-o", "pid=,rss=,time=,command=").Output()
	if err != nil {
		return nil
	}
	var procs []procInfo
	sc := bufio.NewScanner(bytes.NewReader(out))
	// Command lines can be long; give the scanner room beyond the 64K default.
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 3 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		rss, _ := strconv.ParseInt(fields[1], 10, 64)
		command := ""
		if len(fields) > 3 {
			command = strings.Join(fields[3:], " ")
		}
		procs = append(procs, procInfo{
			pid:        int32(pid),
			rssKB:      rss,
			cpuSeconds: parsePsTime(fields[2]),
			command:    command,
		})
	}
	return procs
}

// parsePsTime parses ps's cumulative CPU time, formatted as
// [[DD-]HH:]MM:SS[.cc], into seconds.
func parsePsTime(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	var days float64
	if i := strings.IndexByte(s, '-'); i >= 0 {
		days, _ = strconv.ParseFloat(s[:i], 64)
		s = s[i+1:]
	}
	parts := strings.Split(s, ":")
	var h, m, sec float64
	switch len(parts) {
	case 3:
		h, _ = strconv.ParseFloat(parts[0], 64)
		m, _ = strconv.ParseFloat(parts[1], 64)
		sec, _ = strconv.ParseFloat(parts[2], 64)
	case 2:
		m, _ = strconv.ParseFloat(parts[0], 64)
		sec, _ = strconv.ParseFloat(parts[1], 64)
	case 1:
		sec, _ = strconv.ParseFloat(parts[0], 64)
	default:
		return 0
	}
	return days*86400 + h*3600 + m*60 + sec
}

// listeningPortMap maps each LISTENing TCP port to the PID bound to it, via
// lsof. lsof exits non-zero when it can't stat some descriptors; we parse
// whatever it managed to print regardless.
func listeningPortMap() map[int]int32 {
	out := map[int]int32{}
	b, _ := exec.Command("lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn").Output()
	var pid int32
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		line := sc.Text()
		if len(line) < 2 {
			continue
		}
		switch line[0] {
		case 'p': // p<pid> begins a new process block
			if n, err := strconv.Atoi(line[1:]); err == nil {
				pid = int32(n)
			}
		case 'n': // n<addr>, e.g. n*:4500, n127.0.0.1:8080, n[::1]:8080
			addr := line[1:]
			i := strings.LastIndex(addr, ":")
			if i < 0 {
				continue
			}
			port, err := strconv.Atoi(addr[i+1:])
			if err != nil || pid == 0 {
				continue
			}
			if _, exists := out[port]; !exists {
				out[port] = pid
			}
		}
	}
	return out
}

// readMemTotalBytes returns total physical RAM in bytes (sysctl hw.memsize).
func readMemTotalBytes() float64 {
	out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	return v
}

// readMemAvailableBytes returns available memory (free + inactive pages) in
// bytes, parsed from vm_stat.
func readMemAvailableBytes() (float64, bool) {
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return 0, false
	}
	pageSize := 4096.0 // sane default; overridden by the header below
	var free, inactive float64
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "Mach Virtual Memory Statistics") {
			// "...Statistics: (page size of 16384 bytes)"
			if i := strings.Index(line, "page size of "); i >= 0 {
				f := strings.Fields(line[i+len("page size of "):])
				if len(f) > 0 {
					if ps, err := strconv.ParseFloat(f[0], 64); err == nil && ps > 0 {
						pageSize = ps
					}
				}
			}
			continue
		}
		key, val, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		pages, err := strconv.ParseFloat(strings.TrimRight(strings.TrimSpace(val), "."), 64)
		if err != nil {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Pages free":
			free = pages
		case "Pages inactive":
			inactive = pages
		}
	}
	return (free + inactive) * pageSize, true
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
