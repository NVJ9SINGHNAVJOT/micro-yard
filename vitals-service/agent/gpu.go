package main

import (
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// GPUStats is the GPU portion of a snapshot. Available is false when GPU
// sampling is disabled or the accelerator statistics couldn't be read.
type GPUStats struct {
	GPUUtilPercent float64 `json:"gpu_util_percent"`
	Available      bool    `json:"available"`
}

// gpuSampler polls the GPU in the background and caches the last value, so a
// slow /stats request never blocks on the ioreg call.
type gpuSampler struct {
	mu   sync.RWMutex
	last GPUStats
}

// Device Utilization % is the whole-GPU busy figure Activity Monitor's GPU
// History plots. IOKit reports it as a whole number.
var gpuUtilRE = regexp.MustCompile(`"Device Utilization %"=(\d+)`)

func newGPUSampler() *gpuSampler {
	s := &gpuSampler{last: GPUStats{Available: false}}
	go s.loop()
	return s
}

func (s *gpuSampler) Read() GPUStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.last
}

func (s *gpuSampler) set(g GPUStats) {
	s.mu.Lock()
	s.last = g
	s.mu.Unlock()
}

// loop samples GPU utilization on the fixed collection interval.
func (s *gpuSampler) loop() {
	for {
		g, err := sampleIOAccelGPU()
		if err != nil {
			s.set(GPUStats{Available: false})
		} else {
			s.set(g)
		}
		time.Sleep(collectInterval)
	}
}

// sampleIOAccelGPU reads the accelerator's utilization counter out of the IOKit
// registry, which is readable without root.
func sampleIOAccelGPU() (GPUStats, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ioreg", "-r", "-d", "1", "-w", "0", "-c", "IOAccelerator")
	out, err := cmd.Output()
	if err != nil {
		return GPUStats{Available: false}, err
	}
	ms := gpuUtilRE.FindAllSubmatch(out, -1)
	if ms == nil {
		return GPUStats{Available: false}, nil
	}
	// A machine can expose more than one accelerator (integrated + discrete on
	// Intel Macs); report the busiest rather than summing past 100%.
	busiest := 0
	for _, m := range ms {
		v, err := strconv.Atoi(string(m[1]))
		if err != nil {
			return GPUStats{Available: false}, err
		}
		if v > busiest {
			busiest = v
		}
	}
	return GPUStats{GPUUtilPercent: float64(busiest), Available: true}, nil
}
