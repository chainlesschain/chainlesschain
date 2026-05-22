# Phase 12.9 WeChat 真机 E2E — Prep Kit

> **配套** [`Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`](./Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md)。
>
> 这份不重复 runbook 的场景定义。它是你 **拿到 Xiaomi 24115RA8EC + root + 真账号那一刻** 需要的工具包：(1) 启动前 checklist  (2) 一键采证脚本  (3) 11 个场景失败时的 SOP 卡片速查。
>
> **拿在哪里跑**：Mac / Linux 桌面机（连测试 Android 真机）。Win dev box 跑不了 — 项目 better-sqlite3-multiple-ciphers 在 Node 22+ 上有 ABI 限制 + frida 也是 Mac/Linux 调试体验更顺。

---

## A. 启动前 30 分钟检查单

按顺序跑，**每一项都打钩才能进 §3 场景**。任意一项 ❌ → 修了再回来。

### A1 — 桌面机准备

```bash
# 必须 Node 22 LTS (ABI 127)；Node 23/24 上 bs3mc 没 prebuild
node -v   # 期望 v22.x.x

# cc 装好
cc --version   # 期望 ≥ 0.162.10

# 桌面 app 装好 + productVersion ≥ v5.0.3.75
cd /path/to/chainlesschain/desktop-app-vue && cat package.json | jq -r .productVersion

# 本地 LLM (Ollama) 起来
curl -s http://localhost:11434/api/tags | jq -r '.models[].name' | head -5
```

### A2 — Android 真机准备

```bash
# adb 连得上设备
adb devices   # 期望看到 device serial + "device" (不是 "unauthorized")

# 设备已 root + Magisk
adb shell su -c "id"   # 期望 uid=0(root)

# Zygisk 已开
adb shell su -c "cat /data/adb/magisk/zygisk_loader/loader.conf 2>/dev/null || echo NOT_FOUND"

# DenyList 含 com.tencent.mm
adb shell su -c "magisk --denylist ls" 2>&1 | grep tencent.mm
```

### A3 — frida-server 准备

```bash
# 检查 frida-server 在跑 + 端口监听
adb shell su -c "ps -A | grep frida-server"
adb shell su -c "netstat -lnp 2>/dev/null | grep :27042"   # 或自定义端口

# 桌面端验证连接
frida-ls-devices   # 期望看到 device 行 + type=usb

# 记下 frida-server PID — 长稳测试要全程对比这个 PID 是否变
adb shell su -c "pgrep -f frida-server" > /tmp/wechat-e2e-frida-baseline-pid.txt
cat /tmp/wechat-e2e-frida-baseline-pid.txt
```

### A4 — WeChat 账号准备

```bash
# WeChat 版本
adb shell dumpsys package com.tencent.mm | grep versionName

# 至少 6 个月聊天记录 + ≥ 100 联系人（人工确认）
# 至少 5 万条 message （否则 §12.9.5 大库基准跳过，标 dataset:small）
# Login 状态 OK（手机上能正常收发消息）
```

### A5 — adb pull 数据集

```bash
# 用 cc hub wechat env-probe 决定走 md5 还是 frida 路径
cc hub wechat env-probe --json | tee /tmp/wechat-e2e-probe.json | jq .suggestedKeyProvider

# MD5 路径需要拉整个 /data/data/com.tencent.mm/
if [ "$(jq -r .suggestedKeyProvider /tmp/wechat-e2e-probe.json)" = "md5" ]; then
  adb shell su -c "tar -czf /sdcard/wechat-data.tar.gz /data/data/com.tencent.mm/"
  adb pull /sdcard/wechat-data.tar.gz /tmp/
  mkdir -p /tmp/wechat-data && tar -xzf /tmp/wechat-data.tar.gz -C /tmp/wechat-data
fi
```

### A6 — Vault 基线快照

```bash
# 跑场景前一定先备份 hub 目录 — 失败时可还原
BACKUP_DIR="$HOME/.chainlesschain.hub.backup-$(date +%Y%m%d-%H%M)"
cp -r "$HOME/.chainlesschain/hub" "$BACKUP_DIR" 2>/dev/null
echo "hub backed up to: $BACKUP_DIR"

# 初始 stats（baseline）
cc hub stats --json > /tmp/wechat-e2e-stats-baseline.json
```

### A7 — 结果目录

```bash
RESULTS_DIR="$HOME/wechat-e2e-results-$(date +%Y%m%d-%H%M)"
mkdir -p "$RESULTS_DIR"/{logs,artifacts,reports}
echo "Results going to: $RESULTS_DIR"
export WECHAT_E2E_DIR="$RESULTS_DIR"
```

**全 7 项 ✅ → 进 §B 采证**。任一 ❌ → 修，**不要硬上**（场景失败时根本无法甄别是 setup 错还是 adapter bug）。

---

## B. 每个场景跑完后的一键采证脚本

把下面这块**整段**存为 `scripts/wechat-e2e-record.sh`（chmod +x），每跑完一个 §3 场景就调一次：

```bash
#!/usr/bin/env bash
# wechat-e2e-record.sh — Phase 12.9 per-scenario evidence collector
# Usage: ./wechat-e2e-record.sh <scenario-id> <pass|fail> [note]
# Example: ./wechat-e2e-record.sh 12.9.1 pass "5w msg, 4m12s wall"
#
# Reads: $WECHAT_E2E_DIR (from A7), $HOME/.chainlesschain/hub/hub.log
# Writes: $WECHAT_E2E_DIR/reports/<scenario-id>.md + artifacts/*.json

set -euo pipefail

if [ -z "${WECHAT_E2E_DIR:-}" ]; then
  echo "ERROR: WECHAT_E2E_DIR not set. Re-run A7." >&2
  exit 2
fi

SCENARIO="${1:-}"
RESULT="${2:-}"
NOTE="${3:-}"

if [ -z "$SCENARIO" ] || [ -z "$RESULT" ]; then
  echo "Usage: $0 <scenario-id> <pass|fail> [note]" >&2
  exit 2
fi

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REPORT="$WECHAT_E2E_DIR/reports/${SCENARIO}.md"
ART="$WECHAT_E2E_DIR/artifacts/${SCENARIO}"
mkdir -p "$ART"

# ─── Collect artifacts ─────────────────────────────────────────────
cc hub stats --json > "$ART/hub-stats.json" 2>/dev/null || true
cc hub recent-audit --limit 100 --json > "$ART/audit-recent.json" 2>/dev/null || true
cc hub wechat env-probe --json > "$ART/env-probe.json" 2>/dev/null || true
cc hub wechat list --json > "$ART/wechat-accounts.json" 2>/dev/null || true

# Frida server PID — compared against baseline (any change = hook crashed)
FRIDA_PID_NOW="$(adb shell su -c 'pgrep -f frida-server' 2>/dev/null | head -1 | tr -d '\r' || echo unknown)"
FRIDA_PID_BASELINE="$(cat /tmp/wechat-e2e-frida-baseline-pid.txt 2>/dev/null || echo unknown)"

# Hub log tail
HUBLOG="$HOME/.chainlesschain/hub/hub.log"
if [ -f "$HUBLOG" ]; then
  tail -200 "$HUBLOG" > "$ART/hub-log-tail.txt"
  ERROR_COUNT="$(grep -c '\[ERROR\]' "$ART/hub-log-tail.txt" || echo 0)"
else
  ERROR_COUNT="?"
fi

# Vault integrity (only valuable if cc hub stats has integrity field)
INTEGRITY="$(jq -r '.vault.integrity // "not-reported"' "$ART/hub-stats.json" 2>/dev/null || echo "?")"

# ─── Write report ──────────────────────────────────────────────────
cat > "$REPORT" <<EOF
# Phase 12.9 — Scenario $SCENARIO

- **Result**: $RESULT
- **Time**: $TS
- **Note**: $NOTE
- **Frida PID**: $FRIDA_PID_NOW (baseline=$FRIDA_PID_BASELINE) $( [ "$FRIDA_PID_NOW" = "$FRIDA_PID_BASELINE" ] && echo "✅ stable" || echo "❌ CHANGED — hook crashed/restarted!" )
- **Hub log ERROR count (last 200 lines)**: $ERROR_COUNT
- **Vault integrity**: $INTEGRITY

## Artifacts
$(ls "$ART/")

EOF

if [ "$RESULT" = "fail" ]; then
  cat >> "$REPORT" <<EOF

## ⚠️ Failure — use §6 template:

\`\`\`
Title: [PDH Phase 12.9 E2E] $SCENARIO <一句话症状>
- 产品版本: $(cd $(dirname $(which cc))/.. && jq -r .version package.json 2>/dev/null)
- 测试机: <填>
- frida-server PID: now=$FRIDA_PID_NOW / baseline=$FRIDA_PID_BASELINE
- env-probe: see env-probe.json
- 重现步骤: <填详细到 deterministic>
- hub.log 最后 200 行: see hub-log-tail.txt
- Adapter 状态: see wechat-accounts.json
- audit 最近 100: see audit-recent.json
\`\`\`

See §C SOP for $SCENARIO.
EOF
fi

echo "Recorded: $REPORT"
echo "Artifacts: $ART"
```

跑用：

```bash
./scripts/wechat-e2e-record.sh 12.9.1 pass "5w msg, 4m12s wall, RSS 850MB"
./scripts/wechat-e2e-record.sh 12.9.7 fail "frida PID 12345 → 18234 after WeChat kill"
```

---

## C. 11 个场景失败时 SOP 卡片速查

每个卡片 ≤ 4 行，从 runbook §3 的 "失败 SOP" 表格里**抽出最常见的 first 排查动作**。卡片不给详细分析路径 —— **拿场景号去 runbook §3 看完整 SOP 表**。

### 12.9.1 — 首次 ingest 全 dump

| 现象 | 第一步 |
|---|---|
| ingested=0 | `tail -100 hub.log` 找 "opened encrypted DB"。无 → 解密失败，回 §A3/§A5 |
| ingested ≪ 期望 | `cc hub query-events --adapter wechat --limit 5 --json` 看 normalize 丢字段 |
| sync 中途 error | `cc hub recent-audit --action ingest --limit 10` |
| frida PID 变 | **STOP**。直接进 12.9.7 流程，先稳定 hook |

### 12.9.2 — 解密正确性

| 现象 | 第一步 |
|---|---|
| emoji → `?` 或 `�` | encoding 链路；查 `adapters/wechat/db-reader.js` text_proto utf-8 |
| 换行变空格 | sqlcipher BLOB 没解 protobuf；查 `content-parser.js` |
| 时间戳差 ≥ 1 min | `lastChangeTime` vs `createTime` 误用；查 schema map |
| 长内容前对后缺 | type=49 长内容多行没拼接；查 WChatMM table |

### 12.9.3 — Ask 本地 LLM

| 现象 | 第一步 |
|---|---|
| answer 空 | Ollama 没起或模型没拉。`curl localhost:11434/api/tags` |
| citation eventId 反查失败 | LLM 幻觉。检查 prompt template `untrusted-data:` 包裹 |
| llmName 含 claude / gpt | 隐私 gate 没生效。这是 12.9.10 的 bug，立刻交叉 |

### 12.9.4 — Citation 反查

| 现象 | 第一步 |
|---|---|
| 5/5 都返回 null | event id 形态不对 / vault 数据被清；先 `cc hub stats` |
| UI sheet 超 200ms | renderer 卡顿。F12 看 Performance；不是 adapter 问题 |

### 12.9.5 — 大库性能

| 现象 | 第一步 |
|---|---|
| > 25 min wall | 看 RSS 涨幅。线性涨 → memory leak；阶梯 → GC OK |
| RSS > 1.2GB | normalize 批处理 chunk 太大。查 `wechat-adapter.js` ingest loop |
| 中途 OOM | Electron 主进程内存上限；考虑分批 sync |

### 12.9.6 — 增量同步

| 现象 | 第一步 |
|---|---|
| 重复 event | watermark 没更新。`cc hub stats --adapter wechat --json` 看 lastSyncAt |
| 漏新 message | 增量截断条件错。看 `wechat-adapter.js` `since=watermark` |

### 12.9.7 — Hook resilience

| 现象 | 第一步 |
|---|---|
| frida-server PID 变 | 已知坏 — 优先恢复 server，再决定怎么处理 |
| WeChat 重开后 hook 没接 | FridaKeyProvider 没轮询。看 `frida-key-provider.js` retry 逻辑 |
| 返回 `ATTACH_FAILED` 但 UI 正常 | 错误路径 — adapter 应弹引导，不应静默 |

### 12.9.8 — Anti-detection

| 现象 | 第一步 |
|---|---|
| WeChat 启动 crash | hook 注入时机错 / Zygisk DenyList 没生效。查 `frida-agent/loader.js` |
| 弹"环境异常" | TC 反检测命中。把 frida-server 改非标准端口 + rename binary |

### 12.9.9 — 失败恢复

| 现象 | 第一步 |
|---|---|
| frida 崩 vault 半写入 | **vault 应保持原子性**。`cc hub recent-audit` 看是否有 partial-ingest |
| SELinux enforcing | adb shell `getenforce`。Permissive vs Enforcing 影响 hook 注入 |

### 12.9.10 — 隐私 gate

| 现象 | 第一步 |
|---|---|
| ask 走云端 LLM | **STOP 严重**。`cc llm provider` 看 active；adapter sensitivity=high 必须拒云端 |
| 加 acceptNonLocal 不放行 | gate 永远拒 — bug。查 `personal-data-hub/lib/ask.js` |

### 12.9.11 — 长稳定 24h

| 现象 | 第一步 |
|---|---|
| Frida PID 中途变 | hook 不稳。看 frida 端 console / `frida-message.log` 找 crash 帧 |
| Audit 累积条数对不上 | sync interval 不准。看 `cc hub scheduler ls` |
| 桌面 OOM 中途 | 内存 leak。pgrep electron + `top -p <pid>` 长稳监控 |

---

## D. 通过 / 不通过判据汇总（runbook §0 强化）

**整体 PASS = 全部满足**：

1. 11 个场景全 PASS（任一 fail = 整体 FAIL）
2. 验收期间 `cat /tmp/wechat-e2e-frida-baseline-pid.txt` 跟实时 `pgrep -f frida-server` 全程一致
3. `$WECHAT_E2E_DIR/artifacts/*/hub-log-tail.txt` 全部 0 ERROR
4. §12.9.5 性能基准 PASS（< 25 min wall + RSS < 1.2GB on 5w msg）
5. `cc hub stats --json | jq .vault.integrity` 全程 `ok`

任一不满足 → FAIL → 用 §B 脚本生成 fail report → 提 issue。

---

## E. 看完整 Runbook 之前可以跳过的章节

如果你**只是想体验功能**而不是做正式 E2E 验收，可以跳：

- **§12.9.5 大库性能** — 需要 5w+ 真 message，小号跳过
- **§12.9.11 24h 长稳定** — 真要做就后台跑，正经 user 早期不必
- **§4 性能基准** 整章 — 跟 §12.9.5 配套
- **§12.9.8 anti-detection** — 跑过一次确认不 crash 就够了，深挖留给安全 review

但 §12.9.1–4 + §12.9.7 是**必跑**的基线 — ingest / 解密 / ask / hook resilience，这四个验下来才知道 adapter 真能用。

---

## F. 已收的隐性坑（不在 runbook 里 —— 跑过才知道）

> 这些是 design doc 写时没想到、需要真机时才会暴露的边界。

| Trap | 症状 | 修法 |
|---|---|---|
| `adb shell su -c` 在某些 MIUI 版本回 `permission denied` 但 `su -c` 给 root | 走标准 root 命令失败 | 用 `adb root && adb shell` 或 `adb shell` 进去再 `su` |
| frida-server 用默认 27042 被 MIUI Doze 间歇断 USB tunnel | 跑到第 N 分钟 frida-ls-devices 突然空 | 改 frida-server 端口 + adb forward (`adb forward tcp:27042 tcp:27042`) |
| Zygisk DenyList 加 `com.tencent.mm` 但没重启 → 仍被 detect | WeChat 启动弹"环境异常" | DenyList 改完**必须** Force Stop WeChat + 重开 |
| `cc hub sync-adapter wechat` 在大库时桌面端 Electron 主进程吃满内存 | RSS > 4GB OOM | 加 `--limit 5000` 分批 sync |
| `dumpsys package com.tencent.mm` 显示 versionName 是 grayscale 实验 | env-probe suggestedKeyProvider 判断错 | 手动 `--key-provider-override frida` |
| `cc hub stats --json` 在 sync 进行中 query 卡 5+s | 你以为 sync 挂了实际没 | 等 sync 报 done 再查 stats |
| WeChat 退出登录后 frida hook 仍引用 stale key | sync 后续 0 ingest | 重 login + `cc hub wechat unregister + register` |

跑到新 trap → **追加到这表**，给后人省时间。

---

## G. 相关

- **场景定义** → [`Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`](./Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md)
- **用户文档（功能在哪用 / 怎么启动）** → [`../WeChat_数据采集_快速开始.md`](../WeChat_数据采集_快速开始.md)
- **frida-server setup 完整指南** → [`Adapter_WeChat_SQLCipher_Frida_Setup.md`](./Adapter_WeChat_SQLCipher_Frida_Setup.md)
- **adapter 架构** → [`Adapter_WeChat_SQLCipher.md`](./Adapter_WeChat_SQLCipher.md)
