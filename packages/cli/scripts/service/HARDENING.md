# Service template hardening review

For the systemd unit files in this directory (`cc-bridge-mtc.service`,
`cc-fed-governance-sync.service`), this is a quick checklist of what the
defaults give you and what you should verify before production deploy.

## What the templates already do

- `User=` / `Group=` — runs as an unprivileged dedicated account
  (`chainlesschain` by convention). NOT root. Verify the account exists
  and owns `~/.chainlesschain/`.
- `NoNewPrivileges=true` — process can't gain capabilities via setuid
- `PrivateTmp=true` — isolates `/tmp` namespace
- `ProtectSystem=strict` — read-only mount of `/usr`, `/boot`, `/etc`
- `ProtectHome=read-only` — other users' homes invisible
- `ReadWritePaths=...` — explicitly lists the dirs the daemon writes to
  (`~/.chainlesschain/...` and the drop-zone for the governance sync one)
- `Restart=on-failure` + `RestartSec=5` — auto-restart with backoff
- Logs land in journald — query via `journalctl -u <unit> -f`

## What you should verify per-deploy

1. **`User=` exists**: `id chainlesschain` should return uid/gid.
   If not, `useradd --system --create-home chainlesschain` first.
2. **`WorkingDirectory=` is the User's `$HOME`**: matches `getent passwd chainlesschain | cut -d: -f6`.
3. **`ReadWritePaths=` covers all the dirs the daemon writes to**:
   - bridge MTC: `~/.chainlesschain/cross-chain-mtc/{batches,staging}/`
   - governance sync: `~/.chainlesschain/federation/governance/` AND the drop-zone
   - For the libp2p variant: also wherever `<fed>.libp2p-pos.json` lives (same dir as governance.log)
4. **Drop-zone is mounted before the daemon starts**: if `/srv/shared/cc-governance` is an NFS / SMB mount, add `RequiresMountsFor=/srv/shared/cc-governance` under `[Unit]`.
5. **Network is online**: templates use `After=network-online.target Wants=network-online.target`. Confirm `systemctl enable systemd-networkd-wait-online` (or NetworkManager equivalent) on boot.
6. **CapabilityBoundingSet=** (optional further hardening): the daemons
   need none of the default Linux capabilities. Adding
   `CapabilityBoundingSet=` (empty value) drops all capabilities.
7. **`MemoryMax=` / `CPUQuota=` (optional)**: these daemons should use
   < 200 MB RAM steady-state. `MemoryMax=512M` is a reasonable cap.

## What the templates intentionally don't do

- **No automatic SELinux / AppArmor profile**: distros vary too much.
  Run `audit2allow` against journal output if SELinux blocks any access,
  and ship the resulting profile alongside the unit file.
- **No `DynamicUser=true`**: incompatible with `~/.chainlesschain/` being
  a real persistent path owned by a real account. If you want
  per-instance ephemeral users, change `WorkingDirectory` and
  `ReadWritePaths` to `/var/lib/cc-*` and let systemd manage state dirs
  via `StateDirectory=`.
- **No `RestrictNetworkInterfaces=`**: the libp2p daemon listens on all
  interfaces by default. If you want to bind to a specific interface,
  pass `--listen /ip4/<addr>/tcp/<port>` in the `ExecStart=`.
- **No `ProtectKernelTunables=true` / `ProtectKernelModules=true`**:
  these would be safe additions but aren't in the template to keep
  them minimal. Add if your security baseline requires them.

## Audit + log retention

journald defaults to 10% of disk. The daemons emit ~ one JSON line per
tick (60s default), so footprint is tiny. If you want long-term
retention, configure `Storage=persistent` + `MaxRetentionSec=` in
`/etc/systemd/journald.conf`, OR pipe the output to a log aggregator via
the standard journald → rsyslog / fluentd / vector path.

## Smoke test before enabling

```bash
# 1. Dry-run the binary with --once to confirm config is valid
sudo -u chainlesschain /usr/local/bin/cc crosschain mtc-serve --once --json
sudo -u chainlesschain /usr/local/bin/cc mtc federation governance-sync-serve fed-prod \
    --drop-zone /srv/shared/cc-governance --once --json

# 2. Start the unit and watch the journal
sudo systemctl start cc-bridge-mtc
journalctl -u cc-bridge-mtc -f

# 3. Confirm graceful shutdown
sudo systemctl stop cc-bridge-mtc   # should reach inactive within ~10s
```

## Known limitations

- `ProtectHome=read-only` blocks the daemon from reading `/home/<other-user>`.
  If you've stashed the cc binary under another user's home (e.g. via a
  user-local nvm install), point `ExecStart=` at the shared system path.
- The bridge MTC daemon's `--mtc-config-dir` (when invoked from the
  service file) defaults to `$HOME/.chainlesschain` — which means the
  same data is read whether you run the unit OR `cc crosschain mtc-status`
  manually as the same user. Don't mix multiple accounts on one host
  unless you mean to operate them as separate MTCAs.
