---
name: network-diagnostics
display-name: Network Diagnostics
description: Network troubleshooting tools - ping, DNS lookup, bounded port scan, traceroute, HTTPS check, local IP
version: 1.0.0
category: devops
user-invocable: true
tags: [network, dns, ping, port, connectivity, diagnostics, ip]
capabilities:
  [ping, dns-lookup, port-check, port-scan, traceroute, http-check, local-ip]
tools:
  - command_executor
  - network_diagnostics
instructions: |
  Use this skill when the user needs to diagnose network connectivity issues,
  check DNS resolution, scan ports, trace routes to hosts, or verify HTTP
  endpoints. Remote operations require host-created authorities for exact
  targets, operations, DNS types, TCP ports, private-network access, and HTTPS
  declassification. Ping and traceroute use fixed argv through
  ProcessExecutionBroker; raw handler network and shell access is disabled.
  Supports cross-platform operation on Windows, macOS, and Linux.
examples:
  - input: "/network-diagnostics --ping google.com --count 5"
    output: "Ping google.com: 5 packets sent, avg 12.3ms, min 10.1ms, max 15.8ms"
  - input: "/network-diagnostics --dns example.com --type MX"
    output: "MX records for example.com: 10 mail.example.com"
  - input: "/network-diagnostics --port localhost 5432"
    output: "Port 5432 on localhost: OPEN (PostgreSQL)"
  - input: "/network-diagnostics --ports localhost --range 5170-5180"
    output: "Scan 5170-5180 on localhost: 5173 OPEN, 5174 CLOSED, ..."
  - input: "/network-diagnostics --check https://api.example.com/health"
    output: "HTTP 200 OK (85ms) - https://api.example.com/health is reachable"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
execution-capabilities: [data:result, data:task, host:logger, host:network, network:http, network:socket, process:execute, system:inspect]
handler: ./handler.js
---

# Network Diagnostics

Network troubleshooting toolkit using bounded host broker authorities.

## Features

| Action     | Command                              | Description                          |
| ---------- | ------------------------------------ | ------------------------------------ |
| Ping       | `--ping <host> [--count <n>]`        | Ping host and measure response times |
| DNS        | `--dns <domain> [--type <type>]`     | DNS lookup (A, AAAA, MX, TXT, etc.)  |
| Port Check | `--port <host> <port>`               | Check if a single TCP port is open   |
| Port Scan  | `--ports <host> --range <start-end>` | Scan a range of TCP ports (max 100)  |
| Local IP   | `--ip`                               | Show local network interfaces and IP |
| Traceroute | `--trace <host>`                     | Trace route to a remote host         |
| HTTPS Check | `--check <url>`                     | HTTPS connectivity and response time |
| Help       | _(no arguments)_                     | Show usage information               |

## Examples

Ping a host:

```
/network-diagnostics --ping google.com --count 4
```

DNS lookup:

```
/network-diagnostics --dns example.com --type MX
```

Check if a port is open:

```
/network-diagnostics --port localhost 5432
```

Scan a port range:

```
/network-diagnostics --ports 192.168.1.1 --range 80-90
```

Show local IP addresses:

```
/network-diagnostics --ip
```

Traceroute:

```
/network-diagnostics --trace 8.8.8.8
```

HTTP endpoint check:

```
/network-diagnostics --check https://api.example.com/health
```
