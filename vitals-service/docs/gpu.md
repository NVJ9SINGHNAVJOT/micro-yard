# Vitals — GPU

The GPU gauge works out of the box: no setup step, no password prompt, no
privileges. The agent shells out to `ioreg` and reads the accelerator's
utilization counter straight out of the IOKit registry:

```bash
ioreg -r -d 1 -w 0 -c IOAccelerator | grep -o '"Device Utilization %"=[0-9]*'
```

`Device Utilization %` is the fraction of the GPU's capacity in use, reported as
a whole number. It is the same figure Activity Monitor plots in
**Window → GPU History**, so the dashboard, the menu bar and Activity Monitor
all agree.

A Mac can expose more than one accelerator (integrated + discrete, on Intel).
The agent reports the busiest of them rather than summing, which would let the
gauge run past 100%. If no accelerator is found the gauge shows **n/a** instead
of a misleading zero.

Sampling runs on the same fixed interval as the rest of the collector, in the
background, so a `/stats` request never waits on it.

## Disabling

Set `"gpu": false` in `agent/vitals.config.json` to skip GPU sampling entirely.
The gauge then shows **n/a** and everything else works as normal.
