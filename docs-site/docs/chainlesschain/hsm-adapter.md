# Open Hardware Standard (Phase 71)

## Overview

Unified HSM interface supporting YubiKey, Ledger, and Trezor with FIPS 140-3 compliance.

## Features

- Multi-vendor HSM support
- FIPS 140-3 compliance tracking
- Auto-discovery of connected devices
- Unified cryptographic operations

## IPC Channels

| Channel                     | Description              |
| --------------------------- | ------------------------ |
| `hsm:list-adapters`         | List HSM adapters        |
| `hsm:connect-device`        | Connect HSM device       |
| `hsm:execute-operation`     | Execute crypto operation |
| `hsm:get-compliance-status` | Get FIPS compliance      |

## Database Tables

- `hsm_adapters` — Adapter registry

## Version

v3.2.0
