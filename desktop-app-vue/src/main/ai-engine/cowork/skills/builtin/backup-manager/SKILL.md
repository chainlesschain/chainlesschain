---
name: backup-manager
display-name: Backup Manager
description: Backup and restore application data (database, config, memory, skills) with ZIP archives
version: 1.0.0
category: system
user-invocable: true
tags: [backup, restore, archive, snapshot, recovery, data-protection]
capabilities:
  [backup_create, backup_list, backup_restore, backup_info, backup_clean]
tools:
  - backup_create
  - backup_list
  - backup_restore
  - backup_info
  - backup_clean
instructions: |
  Use this skill to create and manage backups of ChainlessChain application data.
  Supports backing up the database, configuration, permanent memory, and skills.
  Backups are stored as ZIP archives in .chainlesschain/backups/. Can create named
  snapshots, list existing backups, restore from a backup, inspect contents, and
  clean old backups. Uses archiver for ZIP creation and adm-zip for extraction.
examples:
  - input: "/backup-manager --create --name daily-backup --items db,config,memory"
    output: "Backup created: daily-backup-2026-02-17.zip (3 items, 12.5 MB)"
  - input: "/backup-manager --list"
    output: "Found 4 backups: daily-backup-2026-02-17.zip (12.5 MB), ..."
  - input: "/backup-manager --restore daily-backup-2026-02-17.zip"
    output: "Restored 3 items from daily-backup-2026-02-17.zip"
  - input: "/backup-manager --info daily-backup-2026-02-17.zip"
    output: "Backup details: 3 items (db, config, memory), 12.5 MB, created 2026-02-17"
  - input: "/backup-manager --clean --keep 3"
    output: "Cleaned 2 old backups, kept 3 most recent"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Backup Manager

Application data backup and restore skill, based on archiver + adm-zip.

## Features

| Action   | Command                                            | Description                          |
| -------- | -------------------------------------------------- | ------------------------------------ |
| Create   | `--create [--name <name>] [--items db,config,...]` | Create a backup ZIP archive          |
| List     | `--list`                                           | List existing backups with size/date |
| Restore  | `--restore <backup-file>`                          | Restore data from a backup ZIP       |
| Info     | `--info <backup-file>`                             | Show backup contents and metadata    |
| Clean    | `--clean [--keep <n>]`                             | Remove old backups, keep latest N    |
| Schedule | `--schedule --interval <hours>`                    | Show auto-backup config suggestion   |
