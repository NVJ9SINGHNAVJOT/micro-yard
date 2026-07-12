package main

import (
	"bufio"
	"bytes"
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"time"
)

// footprintTimeout bounds the exec; footprint walks the target's VM map, which
// takes longer for processes with large address spaces (~70ms for a 3-process,
// 770MB tree in practice).
const footprintTimeout = 3 * time.Second

// "Google Chrome Helper [751]: 64-bit    Footprint: 450921936 B (16384 bytes per page)"
var footprintRE = regexp.MustCompile(`\[(\d+)\]:.*?Footprint: (\d+) B`)

// footprints returns each pid's phys_footprint in bytes — the number Activity
// Monitor shows in its Memory column.
//
// This is deliberately not ps's RSS. RSS counts only resident pages mapped into
// the process, so it misses memory backed by IOKit/GPU allocations: a service
// holding a model in unified memory can report under 1 GB of RSS while its real
// footprint is tens of GB, because those pages live in IOAccelerator regions.
//
// Pids that exited before footprint reached them are simply absent from the
// result (that isn't an error — worker processes come and go between polls), as
// are pids owned by another user, which footprint can't inspect without root.
// A failure to run at all yields an empty map; callers fall back to RSS.
func footprints(pids []int32) map[int32]uint64 {
	out := map[int32]uint64{}
	if len(pids) == 0 {
		return out
	}

	args := make([]string, 0, 3+2*len(pids))
	args = append(args, "-f", "bytes", "--noCategories")
	for _, pid := range pids {
		args = append(args, "-p", strconv.Itoa(int(pid)))
	}

	ctx, cancel := context.WithTimeout(context.Background(), footprintTimeout)
	defer cancel()
	// footprint reports a non-zero exit when it can't inspect some of the pids,
	// having already printed the ones it could; parse whatever it produced.
	b, _ := exec.CommandContext(ctx, "footprint", args...).Output()

	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		m := footprintRE.FindSubmatch(sc.Bytes())
		if m == nil {
			continue
		}
		pid, err := strconv.Atoi(string(m[1]))
		if err != nil {
			continue
		}
		v, err := strconv.ParseUint(string(m[2]), 10, 64)
		if err != nil {
			continue
		}
		out[int32(pid)] = v
	}
	return out
}
