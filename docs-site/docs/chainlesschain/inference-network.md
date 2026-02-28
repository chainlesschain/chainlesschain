# Inference Network (Phase 67)

## Overview

Decentralized inference network for distributed AI computation with privacy-preserving capabilities.

## Features

- GPU/CPU node registration with benchmarks
- Latency/cost/compute-aware scheduling
- TEE privacy mode
- Federated learning support

## IPC Channels

| Channel                           | Description              |
| --------------------------------- | ------------------------ |
| `inference:register-node`         | Register compute node    |
| `inference:list-nodes`            | List network nodes       |
| `inference:submit-task`           | Submit inference task    |
| `inference:get-task-status`       | Get task status          |
| `inference:start-federated-round` | Start federated learning |
| `inference:get-network-stats`     | Get network statistics   |

## Database Tables

- `inference_nodes` — Node registry
- `inference_tasks` — Task tracking

## Version

v3.1.0
