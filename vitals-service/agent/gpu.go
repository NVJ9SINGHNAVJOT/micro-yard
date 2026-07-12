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
// sampling is disabled or powermetrics couldn't be run (e.g. no sudoers entry).
type GPUStats struct {
	GPUUtilPercent float64 `json:"gpu_util_percent"`
	Available      bool    `json:"available"`
}

// gpuSampler runs powermetrics on a slow cadence in the background and caches
// the last value, since powermetrics is heavy relative to the /stats poll rate.
type gpuSampler struct {
	mu   sync.RWMutex
	last GPUStats
}

// "GPU HW active residency:  15.20% (...)" or "GPU active residency:  15.20%"
var gpuResidencyRE = regexp.MustCompile(`(?i)GPU (?:HW )?active residency:\s+([0-9.]+)%`)

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
		g, err := samplePowermetricsGPU()
		if err != nil {
			s.set(GPUStats{Available: false})
		} else {
			s.set(g)
		}
		time.Sleep(collectInterval)
	}
}

// samplePowermetricsGPU shells out to powermetrics for a single GPU sample.
// Requires a passwordless sudoers entry for powermetrics (see README).
func samplePowermetricsGPU() (GPUStats, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sudo", "-n",
		"powermetrics", "--samplers", "gpu_power", "-n", "1", "-i", "200")
	out, err := cmd.Output()
	if err != nil {
		return GPUStats{Available: false}, err
	}
	m := gpuResidencyRE.FindSubmatch(out)
	if m == nil {
		return GPUStats{Available: false}, nil
	}
	v, err := strconv.ParseFloat(string(m[1]), 64)
	if err != nil {
		return GPUStats{Available: false}, err
	}
	return GPUStats{GPUUtilPercent: round1(v), Available: true}, nil
}
