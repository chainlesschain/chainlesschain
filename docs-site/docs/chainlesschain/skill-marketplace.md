# Skill Marketplace (Phase 65)

## Overview

Skill-as-a-Service protocol enabling standardized skill publishing, discovery, and remote invocation.

## Features

- Standardized skill description format (input/output/deps/SLA)
- EvoMap Gene format integration
- Skill discovery registry
- Version management
- Pipeline DAG composition

## IPC Channels

| Channel                          | Description            |
| -------------------------------- | ---------------------- |
| `skill-service:list-skills`      | List registered skills |
| `skill-service:publish-skill`    | Publish a new skill    |
| `skill-service:invoke-remote`    | Invoke a remote skill  |
| `skill-service:get-versions`     | Get skill versions     |
| `skill-service:compose-pipeline` | Compose skill pipeline |

## Database Tables

- `skill_service_registry` — Skill metadata and SLA
- `skill_invocations` — Invocation history and metrics

## Configuration

```json
{
  "skillService": {
    "enabled": false,
    "maxConcurrentInvocations": 10,
    "defaultTimeout": 30000,
    "publishRequiresApproval": true
  }
}
```

## Version

v3.1.0
