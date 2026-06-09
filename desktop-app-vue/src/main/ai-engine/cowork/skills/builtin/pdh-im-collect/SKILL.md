---
name: pdh-im-collect
display-name: 微信/QQ 聊天采集 (PDH)
description: 引导用户把自己的微信(WeChat)和 QQ 聊天记录采集进 ChainlessChain 个人数据中心(Personal Data Hub) —— 自动发现、密钥提取、解密、一键入库到本地金库。当用户想采集/导入/同步 微信 或 QQ 聊天记录/消息/数据，或问为什么微信/QQ "采不到"，或希望聊天记录可被 AI 检索时触发。PC 桌面端(Windows)，纯本地、个人使用。
version: 1.0.0
category: data
user-invocable: true
tags:
  [
    pdh,
    personal-data-hub,
    wechat,
    qq,
    im,
    chat,
    collection,
    vault,
    微信,
    qq采集,
    聊天记录,
  ]
capabilities:
  [readiness-check, key-extraction-guide, decryption, vault-ingestion]
tools:
  - shell_executor
  - file_reader
supported-file-types: [db, sqlite]
instructions: |
  Use this skill when the user wants to collect their OWN WeChat / QQ chat
  history from their OWN PC into the local PDH vault (so the AI can search it
  via RAG + knowledge graph). Always run readiness first to see the exact
  state per source, then walk the matching path: WeChat 4.0 is fully automatic
  (key read from the running Weixin.exe memory); QQ NT needs the user to
  extract a 16-char SQLCipher passphrase once via qq-win-db-key. Everything is
  local; the vault is SQLCipher-encrypted. The first sync surfaces a
  legal-confirmation gate — that is expected. Only ever the user's own device
  and data; confirm before destructive steps (closing QQ); never paste
  extracted keys or message contents into anything external.
examples:
  - input: "/pdh-im-collect readiness"
    output: "Per-source readiness for wechat-pc / qq-pc (ready / DB_FOUND_NEEDS_KEY / APP_NOT_INSTALLED) plus the matching next step"
  - input: "/pdh-im-collect wechat"
    output: "WeChat one-click path: ensure logged in, then `cc hub sync-adapter wechat-pc`"
  - input: "/pdh-im-collect qq"
    output: "QQ NT path: extract key with qq-win-db-key, then `cc hub sync-adapter qq-pc --passphrase <key>`"
  - input: "/pdh-im-collect verify"
    output: "Vault entity/event counts via `cc hub stats` after a sync"
os: [win32]
author: ChainlessChain
handler: ./handler.js
---

# Personal Data Hub — 微信 / QQ 聊天采集 (AI-assisted)

Help the user get their **own** WeChat / QQ chat history off their **own** PC into
the local PDH vault (searchable by the AI, fed to RAG + knowledge graph). This is
personal data recovery — same class as the project's existing Android frida path.
Everything is local; the vault is SQLCipher-encrypted. Chat history is sensitive,
so the first sync surfaces a legal-confirmation gate — that's expected.

**Where data lands:** the PDH vault at
`%APPDATA%\chainlesschain-desktop-vue\.chainlesschain\hub\vault.db`
(messages become searchable EVENT entities; CLI `cc` and the desktop app share it).

## Step 0 — see what's collectable

Run readiness first; it auto-discovers installed apps and tells you the exact state:

```
cc hub readiness --json
```

Look for `wechat-pc` and `qq-pc`. `DB_FOUND_NEEDS_KEY` / `APP_NOT_INSTALLED` /
`ready` tell you which path applies. Each report also carries a `guide` with the
step-by-step method. (If `cc` isn't global, use `node packages/cli/bin/chainlesschain.js hub readiness`.)

## WeChat (微信) — fully automatic, one-click

WeChat **4.0** (data under `Documents\xwechat_files\`) needs **no manual tool**: the
hub auto-discovers the DBs and extracts the SQLCipher key from the running
`Weixin.exe` process memory, then decrypts + ingests.

1. Tell the user to **open WeChat and stay logged in** (the key lives in memory only
   while it runs).
2. Run:
   ```
   cc hub sync-adapter wechat-pc
   ```
3. This ingests **chat + 公众号 + 朋友圈 + 收藏 + 联系人** (rich media — images / files /
   links / quotes — are labelled readably; compressed messages are zstd-decoded).

WeChat **3.x** (older, `Documents\WeChat Files\`): decrypt MSG\*.db/MicroMsg.db with
a tool like PyWxDump, then `cc hub sync-adapter wechat-pc --input <plaintext .db>`.

Needs the bundled Python (with `cryptography`); if missing, set `CC_PDH_PYTHON` to a
Python 3.11+ that has it.

## QQ (NT 新版) — extract key once, then one-click

QQ NT encrypts `nt_msg.db` with SQLCipher; the key (a 16-char ASCII passphrase like
`5{sww#,6aq=)8=A@`) lives in `QQ.exe` and is grabbed with the maintained
**qq-win-db-key** tool. The hub then decrypts + parses the protobuf message bodies.

1. **Get the key** — guide the user through qq-win-db-key:
   - Download: `git clone https://github.com/QQBackup/qq-win-db-key` (or download the repo zip).
   - **Fully close QQ first** (its watchdog respawns — `taskkill /F /T /IM QQ.exe`, repeat
     until 0 left; otherwise the tool's debugged QQ hands off to the running one).
   - Run the one-click PowerShell:
     ```
     powershell -NoProfile -ExecutionPolicy Bypass -File .\windows_ntqq_get_key.ps1
     ```
     It launches QQ under a debugger; **tell the user to log in to that QQ window**.
     It prints `找到密钥: <16-char passphrase>`.
2. **Collect** with the passphrase:
   ```
   cc hub sync-adapter qq-pc --passphrase "<the 16-char key>"
   ```
   This decrypts + ingests **私聊 + 群聊** messages with sender nicknames (group display
   names are best-effort; non-text messages are labelled `[非文本/媒体消息]`).
3. The QQ key **changes every time QQ restarts** — to re-collect later, re-run
   qq-win-db-key for a fresh key.

## Verify

```
cc hub stats            # entity/event counts in the vault
cc hub readiness        # per-source last sync status
cc ask "上周群里聊了什么"   # the messages are now AI-queryable
```

## Troubleshooting

- **WeChat sync returns nothing / KEY_NOT_FOUND**: WeChat isn't running or isn't logged
  in — the key is only in memory while it's open. Open it, then retry.
- **`SIDECAR_UNAVAILABLE` / cryptography missing**: point `CC_PDH_PYTHON` at a Python
  3.11+ with `cryptography` (`pip install cryptography zstandard`).
- **QQ `KEY_VERIFY_FAILED`**: the passphrase is stale (QQ restarted) or mistyped — re-run
  qq-win-db-key and pass the exact `找到密钥` string (quote it; it has shell-special chars).
- **qq-win-db-key "hands off" / no key**: a QQ process survived — close ALL of them
  (including the watchdog) before running the script.

## Not yet supported

- **抖音 (Douyin)**: its `im.db` uses a custom ByteDance encryption statically linked in
  `libwcdb2.so` (no exported key function) — captured AES keys don't match the DB. This
  needs native-module disassembly; tell the user it's not supported yet rather than
  attempting frida key scans (already explored, dead end).

## Rules

- Only the user's **own** device + data. Confirm before destructive steps (closing QQ).
- Run `--dry-run` first if a command supports it. Prefer `--json` for parsing results
  back to the user. Always show the exact command you ran.
- Don't paste the user's extracted keys or message contents into anything external.
