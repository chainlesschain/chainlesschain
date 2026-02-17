---
name: pc-git-status
display-name: PC Git Status
description: Check git repository status on the connected PC
version: 1.0.0
category: remote
user-invocable: true
tags: [remote, git, status, pc]
os: [android]
execution-mode: remote
remote-skill-name: remote-control
input-schema:
  - name: path
    type: string
    description: Repository path on PC (optional, uses current directory)
    required: false
---

# PC Git Status Skill

Check the git repository status on your connected desktop PC, including branch, staged/unstaged changes, and untracked files.

## Usage

```
/pc-git-status
/pc-git-status [path to repo]
```

## Examples

```
/pc-git-status
```

```
/pc-git-status /home/user/projects/my-app
```

## Requirements

- Active P2P connection to a desktop running ChainlessChain
