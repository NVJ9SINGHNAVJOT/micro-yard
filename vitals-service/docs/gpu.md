# Vitals — GPU Setup

Vitals reads GPU utilization via macOS `powermetrics`, which requires root.
To let the agent sample it **without a password prompt on every read**, add a
sudoers entry scoped to *only* that one binary. No password is stored anywhere.

> Scope: this grants passwordless run of `/usr/bin/powermetrics` and nothing
> else — it is not a general root grant. Local dev machines only.

## Setup

Run these two commands once (you'll be asked for your login password by `sudo`):

```bash
echo "$(whoami) ALL=(root) NOPASSWD: /usr/bin/powermetrics" | sudo tee /etc/sudoers.d/vitals
sudo chmod 440 /etc/sudoers.d/vitals
```

Verify it works (should print power stats with no password prompt):

```bash
sudo -n powermetrics --samplers gpu_power -n 1 -i 200 | grep -i "GPU.*residency"
```

Then start the agent and the GPU gauge goes live within ~2s:

```bash
cd agent && go run .
# open http://localhost:4500/  — run an ollama model and watch the GPU gauge move
```

## Remove

Delete the sudoers file to revoke it completely:

```bash
sudo rm /etc/sudoers.d/vitals
```

After removal the dashboard still works — the GPU gauge just shows **n/a**.
(You can also set `"gpu": false` in `agent/vitals.config.json` to skip GPU
sampling entirely without touching sudoers.)

## Notes

- The path must be `/usr/bin/powermetrics` (confirm with `which powermetrics`).
- `chmod 440` is required — sudo ignores sudoers files with looser permissions.
