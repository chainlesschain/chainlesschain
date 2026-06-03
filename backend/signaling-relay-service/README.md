# Signaling Relay Service

ChainlessChain v1.3+ — Public WebSocket signaling relay (#21 plan A+C).

Lets external/cellular phones reach desktop pcPeerIds without LAN access. Desktop opens an outbound long-lived WS to this relay and registers as its pcPeerId; phone scans QR, gets the relay URL, connects, sends `chainlesschain:command:request` or WebRTC `offer/answer/ice-candidate` messages addressed `to:pcPeerId`; relay forwards.

## Architecture

```
phone (5G)                                      desktop (home WiFi)
   │  wss://signaling.chainlesschain.com           │
   ├──────► nginx :443 → ws://127.0.0.1:9001 ◄─────┤
   │             ┌─────────────────────┐           │
   │             │   cc-signaling-relay │ register │
   │             │   (this service)     │◄─────────┤
   │             └──────────┬───────────┘           │
   │   forward "to": pcPeerId│                      │
   │◄────────────────────────┼──────────────────────┤
```

Protocol matches LAN `desktop-app-vue/src/main/p2p/signaling-server.js`:
- `register {peerId, deviceInfo}` → server stores ws ↔ peerId
- `message|offer|answer|ice-candidate {to, ...}` → forward to target peer (or queue if offline)
- `ping/pong` keepalive
- `unregister` clean removal

## Deploy

Single VPS, behind nginx reverse-proxy (TLS termination via Let's Encrypt).

```bash
ssh root@<vps>
cd /opt/cc-signaling-relay
docker compose up -d --build
# nginx vhost from nginx-signaling.conf
# certs from /www/server/panel/vhost/cert/signaling.<domain>/
```

See `deploy.sh` for the full sequence (cert issue via acme.sh → nginx vhost → container build).

## Endpoints

| URL | Purpose |
|---|---|
| `wss://signaling.chainlesschain.com/` | WebSocket signaling |
| `https://signaling.chainlesschain.com/health` | JSON `{ok, peers, uptime, stats}` |

## Client integration

- **Desktop main**: `desktop-app-vue/src/main/p2p/relay-client.js` — RelayClient outbound; pcPeerId comes from `mobileBridge.peerId` (matches LAN signaling)
- **Android**: `core-p2p/.../config/SignalingConfig.DEFAULT_RELAY_URL` = `wss://signaling.chainlesschain.com`; QR's `relayUrl` field overrides at pair time

## Operational notes

- Heartbeat sweeper kicks stale peers after 90s (3× ping interval)
- Offline queue: 50 messages × 5min TTL per peer
- Max concurrent connections: 1000
- Reverse-proxy `proxy_read_timeout=600s` (default 60s too aggressive for pairing-listener)

See `desktop-app-vue/src/main/p2p/relay-client.js` for client side reconnect logic (exponential backoff, capped at 60s).
