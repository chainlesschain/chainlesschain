---
name: docker-compose-generator
display-name: Docker Compose Generator
description: Generate Docker Compose configurations for development environments - auto-detect project stack, configure services with dependencies, volumes, networking, and health checks
version: 1.0.0
category: development
user-invocable: true
tags: [docker, compose, container, devops, environment, microservices]
capabilities: [compose-generation, service-detection, network-config, volume-management]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [docker-generate, docker-validate, docker-template]
instructions: |
  Use this skill when the user needs to create or modify Docker Compose
  configurations. Auto-detects project tech stack and generates appropriate
  service definitions with databases, caches, message queues, and other
  infrastructure. Includes health checks, proper networking, and volumes.
examples:
  - input: "generate docker-compose for Node.js + PostgreSQL + Redis"
    action: generate
  - input: "add nginx reverse proxy to my compose file"
    action: add-service
  - input: "validate my docker-compose.yml"
    action: validate
author: ChainlessChain
license: MIT
---

# Docker Compose Generator

Generate production-ready Docker Compose configurations.

## Usage

```
/docker-compose-generator generate "<stack description>"
/docker-compose-generator add-service <service-name>
/docker-compose-generator validate [file]
/docker-compose-generator template <template-name>
```

## Supported Services

| Service | Image | Default Port |
| --- | --- | --- |
| PostgreSQL | postgres:16-alpine | 5432 |
| MySQL | mysql:8 | 3306 |
| Redis | redis:7-alpine | 6379 |
| MongoDB | mongo:7 | 27017 |
| Elasticsearch | elasticsearch:8 | 9200 |
| RabbitMQ | rabbitmq:3-management | 5672/15672 |
| Nginx | nginx:alpine | 80/443 |
| Qdrant | qdrant/qdrant | 6333 |
| Ollama | ollama/ollama | 11434 |
| MinIO | minio/minio | 9000/9001 |

## Templates

`fullstack` `microservice` `data-pipeline` `ml-stack` `monitoring`
