# Anti-Censorship Communication (Phase 75)

## Overview

Censorship-resistant communication via Tor, domain fronting, and mesh networking.

## Features

- Tor hidden service
- Traffic obfuscation
- CDN domain fronting
- BLE/WiFi Direct mesh networking

## IPC Channels

| Channel                                   | Description             |
| ----------------------------------------- | ----------------------- |
| `anti-censorship:start-tor`               | Start Tor service       |
| `anti-censorship:get-tor-status`          | Get Tor status          |
| `anti-censorship:enable-domain-fronting`  | Enable domain fronting  |
| `anti-censorship:start-mesh`              | Start mesh network      |
| `anti-censorship:get-connectivity-report` | Get connectivity report |

## Database Tables

- `anti_censorship_routes` — Route records

## Version

v3.3.0
