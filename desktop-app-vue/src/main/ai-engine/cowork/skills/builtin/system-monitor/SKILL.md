---
name: system-monitor
display-name: System Monitor
description: 系统监控（CPU/内存/磁盘/网络/进程/运行时间/系统信息）
version: 1.0.0
category: system
user-invocable: true
tags: [system, monitor, cpu, memory, disk, network, process, health]
capabilities:
  [system_info, system_cpu, system_memory, system_disk, system_processes]
tools:
  - system_info
  - system_cpu
  - system_memory
  - system_disk
  - system_processes
instructions: |
  Use this skill to monitor system resources. Shows CPU usage, memory usage,
  disk space, network interfaces, top processes by CPU/memory, system uptime,
  and overall health assessment. Useful for diagnosing performance issues.
examples:
  - input: "/system-monitor --overview"
    output: "CPU: 45%, RAM: 8.2/16 GB (51%), Disk: 120/500 GB, Uptime: 3d 5h"
  - input: "/system-monitor --cpu"
    output: "CPU: 4 cores, 45% usage, model: Intel i7-12700"
  - input: "/system-monitor --memory"
    output: "RAM: 8.2 GB used / 16 GB total (51%), Swap: 2.1 GB"
  - input: "/system-monitor --disk"
    output: "C: 120/500 GB (24%), D: 850/1000 GB (85%) ⚠"
  - input: "/system-monitor --processes --top 10"
    output: "Top 10 by CPU: node (12%), chrome (8%), ..."
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# System Monitor

系统监控技能，基于 Node.js os 模块。

## 功能

| 操作 | 命令                  | 说明            |
| ---- | --------------------- | --------------- |
| 概览 | `--overview`          | 系统整体概览    |
| CPU  | `--cpu`               | CPU信息和使用率 |
| 内存 | `--memory`            | 内存使用情况    |
| 磁盘 | `--disk`              | 磁盘空间使用    |
| 进程 | `--processes --top N` | 运行进程列表    |
| 网络 | `--network`           | 网络接口信息    |
| 健康 | `--health`            | 系统健康评分    |
