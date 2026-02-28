# PQC Full Migration (Phase 69)

## Overview

Complete post-quantum cryptography migration across all subsystems.

## Features

- Full ML-KEM/ML-DSA replacement
- SIMKey firmware PQC update
- Hybrid-to-pure migration path
- Per-subsystem migration tracking

## IPC Channels

| Channel                             | Description            |
| ----------------------------------- | ---------------------- |
| `pqc-ecosystem:get-coverage`        | Get migration coverage |
| `pqc-ecosystem:migrate-subsystem`   | Migrate a subsystem    |
| `pqc-ecosystem:update-firmware-pqc` | Update firmware PQC    |
| `pqc-ecosystem:verify-migration`    | Verify full migration  |

## Database Tables

- `pqc_subsystem_migrations` — Migration tracking

## Version

v3.2.0
