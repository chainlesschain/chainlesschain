---
name: k8s-deployer
display-name: Kubernetes Deployer
description: Kubernetes deployment management - generate manifests, Helm charts, manage rollouts, check cluster status, and apply security best practices
version: 1.0.0
category: development
user-invocable: true
tags: [kubernetes, k8s, deployment, helm, container, devops, cloud-native]
capabilities: [manifest-generation, helm-chart, rollout-management, security-scan, status-check]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [k8s-deploy, k8s-manifest, k8s-status, k8s-helm]
instructions: |
  Use this skill for Kubernetes deployment tasks: generating YAML
  manifests, creating Helm chart scaffolds, managing rollouts, and
  checking cluster status. Applies security best practices including
  non-root containers, resource limits, and network policies.
examples:
  - input: "generate deployment for node app with 3 replicas"
    action: manifest
  - input: "create helm chart for microservice"
    action: helm
  - input: "check deployment status for my-app"
    action: status
  - input: "rollout restart deployment/my-app"
    action: rollout
input-schema:
  type: string
  description: "Action (manifest|helm|status|rollout|security) followed by description"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    yaml: { type: string }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Kubernetes Deployer

Generate K8s manifests and manage deployments.

## Usage

```
/k8s-deployer manifest "<app description>" [--replicas 3] [--port 3000]
/k8s-deployer helm <chart-name>
/k8s-deployer status [deployment-name]
/k8s-deployer rollout restart|undo <deployment-name>
/k8s-deployer security <deployment-name>
```

## Best Practices Applied

- Non-root security context
- Resource requests and limits
- Liveness and readiness probes
- Pod disruption budgets
- Network policies
- Image pull policy and tag pinning
