---
name: pdh-android-collector
display-name: PDH 安卓本地采集器构建
description: Build or debug a Personal-Data-Hub collector that pulls a Chinese Android app's data off a rooted phone over ADB. Encodes the real-device rule — prefer on-device plaintext SQLite over fragile web APIs (cookies/signing/endpoints drift; local DBs are stable + sign-free).
version: 1.0.0
category: integration
user-invocable: true
tags:
  [
    pdh,
    personal-data-hub,
    android,
    adb,
    root,
    sqlite,
    collector,
    douyin,
    toutiao,
    weibo,
    kuaishou,
    xiaohongshu,
    data-collection,
  ]
capabilities:
  [
    device-mapping,
    local-db-extraction,
    web-api-fallback,
    signbridge-verification,
    collector-scaffolding,
  ]
instructions: |
  Use this skill when adding or debugging on-device data collection for a Chinese
  Android app (抖音/头条/微博/快手/小红书/淘宝/拼多多/12306/高德/携程/games), or when a
  `cc hub <platform>-adb-sync` returns 0 rows. The durable strategy: read the app's
  on-device PLAINTEXT SQLite DBs over ADB+root rather than its web API. Pipeline:
  map device → try existing collector + read reason code → inspect local DBs (magic
  header + node:sqlite) → build a reader (su base64 pull + dual-load sqlite read) →
  normalize into the existing adapter's snapshot kinds → wire BOTH cli+desktop bridges
  → verify on the real device via an Electron harness. Reach for a web fetcher only
  when the data isn't on-device; signed endpoints need the desktop SignBridge.
  Usage: /pdh-android-collector "<app or package>" — or follow the body as a runbook.
examples:
  - input: '/pdh-android-collector "抖音 观看历史"'
    output: "video_record.db record_<uid> 明文 → history(BROWSE) 事件采集器，900 行真机验证"
  - input: '/pdh-android-collector "为什么 toutiao-adb-sync 返回 0 行"'
    output: "诊断: profile error_code 16 + cookie 无 uid → 改读本地 account_db 恢复 uid"
os: [win32, darwin, linux]
author: ChainlessChain
---

# PDH 安卓本地采集器构建 (pdh-android-collector)

The durable way to collect a Chinese app's data is **reading its on-device plaintext
SQLite DBs over ADB+root**, NOT calling its web API. Web APIs drift constantly (cookie
schemas, signing salts, endpoint paths, permission codes); the local DBs are stable and
need no signing. Reach for a web fetcher only when the data genuinely isn't on-device.

Real-device provenance (device 5lhyaqu8lbwstc6x / Xiaomi chopin, 2026-06-11): this
recipe cracked Toutiao (uid from `account_db.login_info` when the web profile returned
`error_code 16`) and Douyin (`video_record.db` `record_<uid>` = 900 plaintext watch
records, sidestepping the SQLCipher IM db). Reference memory `pdh_real_device_findings_2026_06_11`
and `pdh_local_db_over_web_api_strategy`.

## Phase 0 — Map the device (always first)

```bash
adb devices -l                  # device + transport
adb shell "su -c id"            # root (uid=0) — release APKs aren't debuggable
adb shell pm list packages -3   # which target apps are installed
```

Map installed packages → adapters in `packages/personal-data-hub/lib/adapters/`. Only
installed apps verify. The app must be **logged in AND have generated the data** — most
"0 rows" results are login/usage state, not collector bugs.

## Phase 1 — Try the existing collector, read the reason code

`cc hub <platform>-adb-sync --json` (weibo/douyin/kuaishou/toutiao/xhs/bilibili exist):

- `*_COOKIES_INCOMPLETE` / `*_NO_WEBVIEW_COOKIES` → not logged into the in-app WebView.
- `*_IM_DB_ENCRYPTED` → SQLCipher; needs frida key-hook (hard — separate infra).
- web `error_code` / HTTP 404 → endpoint/permission drift (Phase 4).

`cc hub stats --json` runs under the **global `cc`** (host-ABI native sqlite); the
workspace CLI under plain `node` usually can't load `bs3mc` (Phase 5).

## Phase 2 — Inspect the app's local DBs (highest ROI)

```bash
D=/data/data/<pkg>/databases
adb shell "su -c 'ls -S $D/'"                 # by size; ignore -wal/-shm/-journal
adb shell "su -c 'head -c 16 $D/<file>'" | od -A n -t x1
#   53514c697465... = "SQLite format 3" = PLAINTEXT;  else SQLCipher/other
```

Pull plaintext DBs (base64 stream — MIUI-safe) and inspect with Node's built-in
`node:sqlite` (no native dep, no device):

```bash
adb shell "su -c 'base64 $D/<file>'" | tr -d '\r\n' | base64 -d > "$TEMP/x.db"
node --experimental-sqlite -e '…'   # ⚠️ Node-on-Windows /tmp = C:\tmp; use process.env.TEMP
```

Dump `sqlite_master` tables + counts + `PRAGMA table_info`, then sample rows. **The uid is
usually in a filename or table name** (`<uid>_im.db`, `record_<uid>`) and/or a plaintext
`account_db.login_info` row — that's how you recover the uid the web API won't give.

## Phase 3 — Build the collector (mirror the established pattern)

References: `social-toutiao-adb/account-reader.js`, `social-douyin-adb/watch-history-reader.js`.
A reader module exports:

- `pull<Db>ViaSu(adb, serial, opts)` — `ls … || echo NOT_FOUND` (on NOT_FOUND run
  `pm list packages <pkg>` to distinguish "not installed" from "installed-but-no-data"),
  `id -u` root check, `base64 <path> | tr -d '\n\r'` stream, validate `SQLite format 3`
  magic, write tmp file.
- `read<Data>(dbPath, opts)` — open via
  `require("../social-bilibili-adb/chromium-cookies-reader")._internals.loadDatabaseClass()`
  (dual-load: bs3mc under Electron / better-sqlite3 under test), `{readonly:true}`.
- `create<X>Extension(factoryOpts)` — bridge handler `(params, ctx)=>{…}`, requiring
  `ctx.adb` + `ctx.pickDevice`.

Normalize into the **existing** adapter's snapshot kinds (no second adapter) — e.g. douyin
watch history reuses `social-douyin`'s `KIND_HISTORY`. Then wire the extension in **BOTH**
`packages/cli/src/lib/personal-data-hub-wiring.js` AND
`desktop-app-vue/src/main/personal-data-hub/wiring.js` (the `extensions:{…}` object), add a
`hub.<x>Sync` facade method, and a `cc hub <x>-sync` command in `packages/cli/src/commands/hub.js`.

## Phase 4 — Only if the data isn't local (web API)

Pull the real cookie/credential off the device first (local DBs give the uid). Capture the
**actual** response before coding — endpoints drift. ByteDance passport uses `{message,data}`
envelopes with `err_no`/`error_code` (NOT `code`/`status_code`) and returns HTTP 200 +
`data:[]` on error — surface `err_no != 0` or it masks as "empty". Signed endpoints
(X-Bogus / `_signature` / X-S / WBI / DS / weapi) only work via the desktop SignBridge — the
CLI short-circuits them.

## Phase 5 — Verify on the real device (Electron harness)

The native sqlite reader (`bs3mc`) and the SignBridge (`WebContentsView`) load only under
**Electron**, not plain `node`. Write a throwaway `_harness.cjs` and run
`desktop-app-vue/node_modules/.bin/electron _harness.cjs`:

```js
const { app } = require("electron");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");
app.whenReady().then(async () => {
  // require reader+collector by ABSOLUTE path; build a bridge whose invoke()
  // routes to createXExtension({})(params,{adb,pickDevice}); call collect…(bridge,{…});
  // console.log the result; app.exit(0);
});
```

Verifies the whole pipeline (pull → read → normalize, + signing) without driving the GUI.
**Delete the harness + any pulled DBs after; never commit a harness or device data.**

## Testing + landing

Inject `adb` (fake canned `su` output) and `_databaseClass` (fake Database with
`prepare().all()/.get()`) — no device, no native driver. Cover: pull diagnosis branches
(NOT_FOUND→installed/not, NO_ROOT, NOT_SQLITE, EMPTY), reader row parsing, and a
collect→normalize round-trip asserting a valid `partitionBatch`. Run the full pdh suite for
regressions.

**Release gate:** any `pdh/lib` change needs pdh version bump + `npm publish` + Android
`USR_VERSION` bump before it reaches the published CLI / Android (traps #27/#28). In the
desktop dev app (`npm run dev`, symlinks workspace pdh) it's live immediately.

## Git hygiene

Parallel Claude sessions share one `.git`. Commit with `git commit --only -- <paths>` (stage
new files with `git add -- <path>` first). The post-commit hook auto-pushes to github + gitee.
