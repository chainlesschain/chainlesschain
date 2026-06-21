# Phase 12.9 — WeChat 真机 E2E Runbook (frida-dep path)

> **范围**：Phase 12.9 真机端到端验收。`Adapter_WeChat_SQLCipher_Frida_Setup.md` 讲怎么把 frida-server 跑起来（setup），`Personal_Data_Hub_E2E_Runbook.md §11` 讲怎么 env-probe + register（注册流程），**本文档讲注册完之后 — ingest / 解密 / 查询 / 长期稳定性 — 怎么验**。
>
> **状态**：v0.1（2026-05-21，与 Phase 12.6.7–10 代码同周期落地）。
>
> **谁该读**：手上已经按 Frida Setup runbook 把 frida-server 跑起来、Phase 12.6.10 Vue UI / `cc hub wechat register` 也已注册成功，**接下来要验证数据真的能拉、能解密、能查、且不会塌**的工程师 / 早期 user。
>
> **前置依赖**：
> - ✅ [`Adapter_WeChat_SQLCipher_Frida_Setup.md`](./Adapter_WeChat_SQLCipher_Frida_Setup.md) §2 全部跑完（frida-server 监听 27042 或自定义端口）
> - ✅ [`Personal_Data_Hub_E2E_Runbook.md §11.2`](./Personal_Data_Hub_E2E_Runbook.md#112-步骤--frida-路径80-rooted) 注册成功（`cc hub wechat list` 看见 row 且 `chosenKeyProvider=frida`）
> - ✅ 桌面 ChainlessChain `productVersion ≥ v5.0.3.75` 且 `cc CLI 0.162.10+`
>
> **不在范围**：Quick Path B（WeChat 7.x md5 路径）— 那条路用 [`Personal_Data_Hub_E2E_Runbook.md §11.1`](./Personal_Data_Hub_E2E_Runbook.md) 已经够了。

---

## 0. 验收门禁

通过条件（**全部**满足才算 Phase 12.9 PASS）：

1. 11 个场景 (12.9.1 – 12.9.11) 全部 PASS（任意 1 fail = Phase 12.9 FAIL）
2. 验收期间 frida-server 进程**未崩**（`pgrep -f frida-server` 全程返回同一 PID）
3. 桌面 `hub.log` 全程**无 ERROR 级别日志**（WARN 可以；ERROR 立即 stop + 复现）
4. 4.4 性能基准全部命中或低于阈值
5. 全 11 场景过程 vault.db **完整性**：`vault.checkIntegrity()` 返回 `ok`（无 SQLite corruption）

填记录模板见 §6。一次完整跑预计 **~6-8 小时**（含 24h 长稳测试可独立后台跑）。

---

## 1. 测试机环境矩阵

测试机要求与 [Setup runbook §1](./Adapter_WeChat_SQLCipher_Frida_Setup.md#1-你需要准备的东西) 一致。**Phase 12.9 要求至少跑过 1 台**主测试机，**推荐**多测一台备份机做兼容性。

| 维度 | 主测试机 | 备份机（推荐） |
|---|---|---|
| 设备 | Xiaomi 24115RA8EC（Android 14, arm64-v8a） | 三星 / 华为 / vivo 任一 Android 11+ |
| WeChat 版本 | 8.0.50 ~ 8.0.55（截至 v0.1 验过的） | 8.0.40+ 任一 |
| Root | Magisk ≥ 25.0 + Zygisk on + DenyList(com.tencent.mm) | 同上 |
| frida-server | 16.x 官方 build，监听 27042 或自定义 | 同上 |
| 测试账号 | 个人微信，**至少 6 个月聊天记录** + ≥ 100 个联系人 | 个人微信 |
| 桌面机 | Win 10/11 ≥ 16GB RAM / Mac M2 / Linux | 同上 |

> **数据量门槛**：Phase 12.9 §12.9.5 大库稳定性场景要求测试账号至少包含 **5 万 + 条 message**（不到这个量级，性能基准不能算数）。如果你刚装的小号，跳过 §12.9.5 但要注明 `dataset:small`。

---

## 2. 全场景一览

| # | 场景 | 时长 | 关键判据 |
|---|---|---|---|
| 12.9.1 | 首次 ingest — 联系人 / 群成员 / 消息 全 dump | ≤ 5 min / 5w 条 | vault `Person.subtype=contact` + `Event.subtype=message` 行数 ≥ 期望 |
| 12.9.2 | 解密正确性 spot-check（10 条已知 message 比对源 DB） | ≤ 5 min | 10/10 内容完全一致（含 emoji / 换行 / @mention） |
| 12.9.3 | Ask 自然语言查询走通本地 LLM | ≤ 10 min | 3 类问题 都返回正确答案 + ≥ 1 citation 真指向 wechat-* event |
| 12.9.4 | Citation 反查（点击 chip → event detail） | ≤ 5 min | 5/5 citation event 详情拉回原内容 |
| 12.9.5 | 大库性能 — 5 万条消息 ingest 时长 + 内存峰值 | ≤ 30 min | < 25 min wall + RSS < 1.2GB |
| 12.9.6 | 增量同步 — 第二次只拉新数据 | ≤ 2 min / 100 新 | watermark 命中 + 0 重复 event |
| 12.9.7 | Hook resilience — WeChat 杀进程 + 重开 + 再触发 sync | ≤ 5 min | Frida 自动重 attach 或优雅 `ATTACH_FAILED` 引导 |
| 12.9.8 | Anti-detection — WeChat 启动时反检测 + DenyList 验证 | ≤ 5 min | WeChat 不 crash / 不弹"环境异常"对话框 |
| 12.9.9 | 失败恢复 — frida-server 中途崩 / SELinux 切 enforcing | ≤ 10 min | 桌面端给出 actionable error，不污染 vault |
| 12.9.10 | 隐私 gate — ask 时桌面 LLM 切 Claude | ≤ 5 min | `Non-local LLM blocked` 返回，再带 acceptNonLocal 才放行 |
| 12.9.11 | 长稳定 — 24h 后台监控（chunk 触发 + crash detection） | 24h | 0 crash + 累计 audit 条数 = 期望 sync 次数 × N |

---

## 3. 详细场景

### 12.9.1 — 首次 ingest 全 dump

**前提**：`cc hub wechat register` 成功；vault 此前未含此 uin 的 wechat-* 数据（或先 `cc hub wechat unregister <uin>` 重置）。

**步骤**：

1. 桌面 hub stat 基线：
   ```bash
   cc hub stats --json | tee /tmp/wechat-stats-before.json
   ```
   记 `vault.events / persons / places / items`。
2. 触发 sync：
   ```bash
   cc hub sync-adapter wechat --json | tee /tmp/wechat-sync-1.json
   ```
   或 Vue UI → PDH → WeChat row → 点"立即同步"。
3. 等到 `done` event 返回（CLI 会 block 到 done，UI 在 Adapter row 显 `上次 +N 事件`）。
4. 比对：
   ```bash
   cc hub stats --json | tee /tmp/wechat-stats-after.json
   diff <(jq .vault /tmp/wechat-stats-before.json) <(jq .vault /tmp/wechat-stats-after.json)
   ```

**通过判据**：

- 输出 SyncReport 含 `ingested ≥ 1000`（小号样本 ≥ 100）
- `persons` 增量 ≈ 联系人数（误差 ±10% 容忍 — group member 重复算 1）
- `events.subtype=message` 增量 ≈ 真实消息数（差 < 5% — 撤回 / system 消息可能跳过，记入 `extra.skipReason`）
- `audit_log` 出现 `action=ingest` row，`adapter=wechat`，count 等于 ingested
- **frida-server PID 不变**（`adb shell pgrep -f frida-server` 与 §1 准备阶段一致）

**失败 SOP**：

| 现象 | 排查 |
|---|---|
| ingested = 0 | 检查 DB 路径是否真的解密（`hub.log` 找 `WechatAdapter: opened encrypted DB ...`）；如未见 → 12.9.7 hook resilience 流 |
| ingested ≪ 期望 | `cc hub query-events --adapter wechat --limit 5` 看 normalize 是否丢字段；查 `wechat-adapter.log` |
| sync 中途返回 error | 截 `cc hub recent-audit --action ingest --limit 10` + `hub.log` 最后 100 行 |
| frida PID 变了 | 高优先级！hook 崩了；进 §12.9.7 |

---

### 12.9.2 — 解密正确性 spot-check

> 不验解密正确性，所有后续场景都是空中楼阁。

**步骤**：

1. 在测试机 WeChat 里**手工挑 10 条 message**，覆盖：
   - 3 条纯文本（含中文 / emoji / `@群成员`）
   - 2 条换行多于 5 行
   - 2 条带 url
   - 1 条引用回复
   - 1 条群里的 / 1 条单聊的
2. 记下每条的 timestamp（精确到秒）+ 对话方昵称 + 前 20 字。
3. 桌面端查：
   ```bash
   for i in 1..10; do
     cc hub query-events --adapter wechat --subtype message \
       --since <ts-1s> --until <ts+1s> --limit 5 --json | jq .
   done
   ```
4. 内容字段 (`item.text` / `extra.content`) 对照手记 10 条。

**通过判据**：

- 10/10 文本字符**完全一致**（含 emoji codepoint / 全角空格 / 换行符）
- 时间戳偏差 ≤ 2 秒（NTP 漂移）
- `actor.displayName` 与 WeChat 显示一致
- 单聊 `extra.peerId` / 群聊 `extra.roomId` 准确

**失败 SOP**：

| 现象 | 排查 |
|---|---|
| emoji 变成 `?` 或 `�` | encoding 问题；查 normalize utf-8 链路（`adapters/wechat/db-reader.js` `text_proto` 解码） |
| 换行变成空格 | sqlcipher 拉出 `BLOB` 没解 protobuf；查 `content-parser.js` line 类型 |
| 时间戳差 ≥ 1 分钟 | column 误用了 `lastChangeTime` vs `createTime`；查 schema map |
| 内容前几字对但后半截缺 | message 跨多行没拼；查 `WChatMM` table `Type=49` 长内容 join |

---

### 12.9.3 — Ask 自然语言查询走通本地 LLM

**前提**：桌面 active LLM = Ollama（本地）。如不是，先 `cc llm provider ollama` + 测一下能联通。

**步骤**：3 类问题：

| Q | 期望答案形态 |
|---|---|
| A. "上周我和 `<你妈的 WeChat 昵称>` 聊过几次？最后一次说啥？" | 数字 + 最后一条原文摘录 + ≥ 1 citation 指向 message event |
| B. "我和 `<同事>` 这个月谁说话多？" | 给出消息数对比 + 给出 trend + ≥ 2 citation |
| C. "我关注的 `<某话题词>` 群最近聊了啥？" | 概括 3-5 条要点 + ≥ 3 citation |

```bash
cc hub ask "上周我和 妈妈 聊过几次？最后一次说啥？" --json | tee /tmp/wechat-ask-A.json
```

**通过判据**：

- 3/3 问都返回 `answer` 字符串非空 + `citations[].eventId` 存在
- 每个 citation 用 `cc hub query-events --limit 1` 反查得到原 event（不是幻觉 id）
- `llmName` 含 `ollama:`，`isLocal=true`
- 桌面 LLM 调用日志显示 prompt 里 user role 含 `untrusted-data:` 标记（防 prompt injection）

**失败 SOP**：见 [`Personal_Data_Hub_E2E_Runbook.md §5`](./Personal_Data_Hub_E2E_Runbook.md)。

---

### 12.9.4 — Citation 反查

**步骤**：

1. 从 §12.9.3 任一答案拿 5 个 citation `eventId`
2. UI: 点 chip → 弹 detail sheet → 应显原 message 内容
3. CLI:
   ```bash
   for eid in "$E1" "$E2" "$E3" "$E4" "$E5"; do
     cc hub query-events --json | jq ".[] | select(.id == \"$eid\")"
   done
   ```

**通过判据**：

- 5/5 都返回原 event 且内容与 §12.9.2 spot-check 中验证过的一致
- UI 详情 sheet ≤ 200ms 出现（人感无延迟）

---

### 12.9.5 — 大库性能

**前提**：测试账号 `events.subtype=message` 预期 ≥ 5 万条（§1 数据量门槛）。

**步骤**：

1. 清空 vault wechat 数据：`cc hub wechat unregister <uin>` + 重 register（保持 hook live）。
2. 后台开 monitor：
   ```bash
   while true; do
     ps -o rss= -p $(pgrep -f "electron|cc-hub" | head -1); sleep 5;
   done > /tmp/wechat-rss.csv &
   ```
3. `time cc hub sync-adapter wechat --json` 全跑完
4. 收 monitor：
   ```bash
   awk 'BEGIN{max=0} {if($1>max)max=$1} END{print max/1024 " MB"}' /tmp/wechat-rss.csv
   ```

**通过判据 / 基准（5 万 messages）**：

| 指标 | 期望 | 失败阈值 |
|---|---|---|
| wall clock | ≤ 25 min | > 40 min |
| RSS 峰值 | ≤ 1.2 GB | > 2.0 GB |
| vault.db 增量 | ≤ 200 MB | > 500 MB |
| kg_triples 增量 | ≤ 4× event 数 | — |
| rag 索引增量 | ≤ event 数（每 event 1 doc） | — |

**失败 SOP**：

| 现象 | 排查 |
|---|---|
| wall > 40 min | 检查 `chunkSize` (`adapters/wechat/wechat-adapter.js`)，1k events 一批是上限；查 sqlite WAL fsync 频率 |
| RSS > 2GB | 检查 `WechatAdapter.sync` 是否在内存里持全部 row；改为 streaming cursor |
| vault.db > 500MB | 检查 message text 是否被过度膨胀（如 protobuf raw 也存 extra）；瘦身 `extra` 只留 normalize-after 字段 |

---

### 12.9.6 — 增量同步

**前提**：§12.9.1 已跑过一次。

**步骤**：

1. 在 WeChat 里**发** 10 条消息（给自己 / 文件传输助手）
2. 等 10 秒（让 libwcdb 写入 disk）
3. 再跑 `cc hub sync-adapter wechat --json`

**通过判据**：

- `ingested == 10`（或 11 ±1，文件传输助手有时多/少一条 echo）
- `audit_log` 加 1 行 ingest，count = 10
- 老 events 0 重复（query `events` table 按 id unique，应一致）
- 整体 < 30 秒（hook 已 live + watermark 命中）

---

### 12.9.7 — Hook resilience

**目的**：验证 WeChat 重启 / hook 中断后能恢复，不污染 vault。

**步骤**：

1. 跑 `cc hub sync-adapter wechat` baseline 通过（§12.9.6 增量 OK）
2. 手机上**强行停止** WeChat（Settings → Apps → WeChat → Force Stop）
3. 桌面立刻再跑 `cc hub sync-adapter wechat --json`
4. 期望：返回 `ok:false` + 明确错误（`HOOK_LOST` / `FRIDA_ATTACH_FAILED` / `KEY_NOT_CACHED`）
5. 在手机上**重开 WeChat 进任意聊天**（触发 libwcdb 重 load + sqlite3_key 调用）
6. 再跑 `cc hub sync-adapter wechat --json`
7. 期望：恢复，ingested == 0（无新消息）or 实际新增

**通过判据**：

- 第 3 步**不抛 unhandled exception**，错误**人类可读**
- 第 6 步成功，无需 unregister + re-register
- vault 没产生半截 ingest（`audit_log` 第 3 步要么不写、要么 `action=ingest-failed` 而非 `action=ingest`）
- frida-server PID 没变（只是 attach 断；进程在）

**失败 SOP**：第 3 步若桌面 crash → 立刻 stop + 提 issue + 收 `hub.log` + `frida-message.log`。

---

### 12.9.8 — Anti-detection

**目的**：验 Magisk DenyList + Zygisk + 改端口三件套真的让 WeChat 不报警。

**步骤**：

1. 手机重启
2. 跟着 [Frida Setup §2.3](./Adapter_WeChat_SQLCipher_Frida_Setup.md#23-反检测加固可选但推荐) 三件套全开：
   - Zygisk enabled
   - DenyList 含 `com.tencent.mm`
   - frida-server 跑 `:13337`（非默认端口）
3. 启动 WeChat
4. 等 60 秒看是否：
   - 弹"安全风险"对话框
   - 自动登出 / 闪退
   - "请检查环境"提示

**通过判据**：

- WeChat 正常启动到首屏（聊天列表）
- 进任意聊天能正常发收消息
- 桌面端跑一次 sync 走 §12.9.6 path：仍能拉到刚发的消息
- 微信不会过 ≥ 5 分钟后秒退（部分版本是延时反检测）

**失败 SOP**：

| 现象 | 排查 |
|---|---|
| WeChat 弹"风险" | 升级 Magisk 到最新；考虑 Shamiko module 加强隐藏 |
| 闪退 | 看 `adb logcat \| grep -i tinker\|sigaction`；通常是 patched frida 没匹配 ABI |
| 5 min 后退 | 服务端推送式检测；只能等 frida-server patched 社区跟进 |

---

### 12.9.9 — 失败恢复

**目的**：3 种破坏场景下，桌面 give actionable error，不污染 vault。

#### 12.9.9.a frida-server 中途崩

1. baseline sync OK
2. 手机端 `adb shell "su -c 'pkill -9 frida-server'"`
3. 桌面 `cc hub sync-adapter wechat --json`
4. 期望：`ok:false`，`error.code=FRIDA_ATTACH_FAILED` 或 `KEY_PROVIDER_UNAVAILABLE`
5. 错误信息含**修复指引**："请检查 frida-server 是否运行 (`adb shell pgrep -f frida-server`)"

#### 12.9.9.b SELinux 切 enforcing

1. baseline sync OK
2. `adb shell "su -c setenforce 1"`
3. 重启 frida-server（`pkill -9 frida-server` + 重 push 起来）
4. 桌面 sync
5. 期望：env-probe 重跑应识别到 `selinux: enforcing` + 警告

#### 12.9.9.c Root 撤销

1. baseline sync OK
2. Magisk → 卸载 com.tencent.mm 的 DenyList？模拟"用户改配置"
3. 桌面 sync
4. 期望：sync 仍能跑（DenyList off 影响的是 WeChat 反检测，不是 frida）
5. 但若用户**完全卸载 Magisk**：env-probe 应识别 + 提示
6. 这里 manual 验：`hub.log` 出 `WARN: root status changed`

**通过判据**：3 子场景都不让桌面 / vault.db 进入 inconsistent state（audit 不写 false ingest）。

---

### 12.9.10 — 隐私 Gate

**步骤**：

1. 桌面 `cc llm provider claude`（或任何 cloud provider）
2. `cc hub ask "上周和妈妈聊了啥"` —— 期望 `error: "Non-local LLM blocked"`
3. `cc hub ask "上周和妈妈聊了啥" --accept-non-local` —— 期望返回正常答案
4. `cc hub recent-audit --action ask --limit 2 --json` —— 看到两次 ask 记录，第 1 次 `error`，第 2 次 `acceptNonLocal=true`
5. 切回本地：`cc llm provider ollama`，`cc hub ask "..."` —— 直接返回，无需 flag

**通过判据**：

- 4/4 步行为完全符合期望
- 第 1 步**没有任何 vault 事实**通过网络（抓包 verify — `tcpdump -i any -w /tmp/cap.pcap` 跑期间，过滤 anthropic.com → 应无 outbound 流量）

---

### 12.9.11 — 长稳定 24h

> 这步独立后台跑。开始前确认前 10 步都 PASS。

**步骤**：

1. 桌面起 cron / scheduled task：
   ```bash
   while true; do
     cc hub sync-adapter wechat --json >> /tmp/wechat-24h-sync.jsonl;
     sleep 3600;
   done
   ```
2. 手机持续正常用 WeChat（每天聊天）
3. 24h 后停 loop
4. 检查：
   ```bash
   jq -s 'length' /tmp/wechat-24h-sync.jsonl                    # 期望 ≈ 24
   jq -s '[.[] | select(.error != null)] | length' /tmp/wechat-24h-sync.jsonl  # 期望 0
   adb shell pgrep -f frida-server                              # 与开始时同 PID
   cc hub recent-audit --action ingest --since <24h ago> --limit 100 --json | jq length  # ≈ 24
   ```

**通过判据**：

- 24 次 sync 全 success（≤ 1 次 transient failure 容忍，需 hub.log 解释）
- frida-server PID 不变（hook 进程稳定）
- vault.db 没膨胀异常（< 50 MB / 24h，含 WAL）
- 桌面进程 RSS 增长 < 200 MB（无 leak）
- 手机 WeChat 在期间没被反检测踢出

**失败 SOP**：

- 任一 sync `error.code=FRIDA_ATTACH_FAILED` 出现 ≥ 3 次 → patched build 不稳，提 issue
- vault.db > 200MB → 查 `extra` 字段是否在每条 message 重复存 raw protobuf；瘦身
- 桌面 RSS > 1GB → V8 leak；用 `--inspect` + Chrome DevTools heap profile 看

---

## 4. 性能基准合集

收集所有场景的实测数据填表（一次完整跑）：

| 场景 | 指标 | 期望 | 实测 |
|---|---|---|---|
| 12.9.1 | 首次 ingest 5w 条 wall clock | ≤ 25 min | |
| 12.9.1 | 首次 ingest RSS 峰 | ≤ 1.2 GB | |
| 12.9.1 | vault.db 增量 | ≤ 200 MB | |
| 12.9.2 | 解密 spot-check (10 条) | 10/10 | |
| 12.9.3 | ask 单次延迟 (Ollama 7B) | ≤ 8s | |
| 12.9.4 | citation 详情 sheet 时延 | ≤ 200ms | |
| 12.9.5 | 大库 5w wall clock | ≤ 25 min | |
| 12.9.6 | 增量 10 条 wall clock | ≤ 30s | |
| 12.9.7 | hook recovery 完整循环 | ≤ 5 min | |
| 12.9.11 | 24h 稳定性 sync 成功率 | ≥ 23/24 | |
| 12.9.11 | 24h vault.db 净增长 | ≤ 50 MB | |

---

## 4.4 设备 vs 桌面机能力分布

| 任务 | 设备做 | 桌面做 |
|---|---|---|
| frida hook + 抓 sqlite3_key | ✅ | ❌ |
| 读 encrypted DB 并解密 | ❌（不动用户 device 资源） | ✅ |
| normalize + entity-resolve | ❌ | ✅ |
| LLM 推理 (Ollama) | ❌ | ✅ |
| 存 vault.db / kg / rag | ❌ | ✅ |

**设备 RSS 增长**：理论上 0（frida-gum 已驻留，每次 sync 桌面只是 RPC 取 key，hook 不重 attach）；实测应 ≤ 30 MB / 24h（frida-server 内部 buffer 漂移）。

---

## 5. 已知 traps（与 Adapter_WeChat_SQLCipher.md §13 / §18.9 重叠不重述）

### 5.1 Frida hook 三 trap 速诊表（v0.2，2026-05-22 sjqz parity audit）

如果 `cc hub wechat register` 卡在 hook 阶段（30s timeout / silent fail / DB 死活 open 不了），按下表读 `FridaKeyProvider.getLastTelemetry()` 字段定位。详见 memory [[wechat-frida-hook-audit-traps]] + 单测 `packages/personal-data-hub/__tests__/adapters/wechat-frida-agent.test.js`。

#### Trap A — 模块大小写（sjqz canonical = libWCDB.so 大写）

| 症状 | telemetry 特征 | 修法 |
|---|---|---|
| 30s timeout，从来没看到 `hooked` event；frida-message.log 只有 `module-waiting` | `hooked: []`（空数组）+ `errors:` 含 `"libWCDB.so\|libwcdb.so did not load within 30s"` | 检查 `adb shell ls /data/data/com.tencent.mm/lib*/libWCDB.so` 看实际命名。我们已 fallback 两个 case，但 OEM 定制 ROM 可能用其它名（如 `libwcdb_3_3_5.so`）— 加进 `TARGET_MODULES` 数组 |

#### Trap B — sqlite3_key vs sqlite3_key_v2 参数 index 错配

| 症状 | telemetry 特征 | 修法 |
|---|---|---|
| 拿到 hex 但 DB open 全 PRAGMA profile 都失败（`WeChatDBReader: failed to open with any pragma profile`）| `keySource: "sqlite3_key_v2"` + `keySig: "v2"` + `keyFormat: "raw-bytes"` 但 `keyLength` 不是 32/64（极端如 4 / 8 — 那是 db name 长度）| 已经修了；如果仍命中说明 v2 签名又变了，agent 的 `argIndicesFor()` 表需新增 case |
| 拿到 hex 看着像 ASCII 字符（"main\x00..." / "/data/data/..."）| `keySig: "v1"` 但 `keyLength` 极小或 hex 头几字节是 `6d61696e`（"main"）| WeChat 版本用了不同 v1 调用约定（少见，需 hexdump 验证）|

#### Trap C — Key 格式：ASCII-hex (len=64) vs raw-bytes (len=32) vs ambiguous

| 症状 | telemetry 特征 | 修法 |
|---|---|---|
| 拿到 hex 长度 128 字符（双倍编码）| `keyFormat: "raw-bytes"` + `keyLength: 64` | bug — len=64 应走 ascii-hex path。检查 `wechat-key-hook.js` 的 len 判断分支；如果命中说明 `Memory.readCString` 沙箱注入失败回退到 readByteArray 双编码 |
| `keyFormat: "ambiguous"` 但 DB open 失败 | `keyLength` 既非 32 也非 64（如 16 / 40 / 48）+ telemetry 有 `keyAlt` 字段 | agent 已 emit 两种解释（`hex` + `alt`），但目前 FridaKeyProvider 只 resolve `hex`。如真命中 ambiguous，需 host 改造按 `hex` 失败再试 `alt`（参考 Adapter §18.10 OQ）|

### 5.2 telemetry dump 命令

```bash
# 桌面 hub.log 抓 FridaKeyProvider event
grep -A 1 'frida-message' ~/.chainlesschain/desktop-app-vue/logs/hub.log | tail -40

# 或者注册时加 --json 看完整 telemetry
node packages/cli/bin/chainlesschain.js hub wechat register \
  --uin <UIN> --db-path /tmp/EnMicroMsg.db \
  --wechat-data-path /tmp/com.tencent.mm \
  --json | jq '.fridaTelemetry'
```

期望 telemetry 字段（happy path WeChat 8.x rooted + Frida ≥ 16）：

```json
{
  "hooked": [{"symbol": "sqlite3_key", "module": "libWCDB.so"}],
  "keySource": "sqlite3_key",
  "keySig": "v1",
  "keyFormat": "ascii-hex" | "raw-bytes",
  "keyLength": 64 | 32,
  "keyAlt": null,
  "errors": [],
  "durationMs": 800
}
```

任何字段缺失 / null / 异常都按 §5.1 表查。

### 5.3 新发现的 trap（场景外，要补回设计稿）

> 每发现一个新 trap，按 [`docs/internal/hidden-risk-traps.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/internal/hidden-risk-traps.md) 模式追加到 §18.9 + 索引到 MEMORY.md + 扩 §5.1 表。

---

## 6. 失败上报模板

任何场景 fail：

```
Title: [PDH Phase 12.9 E2E] <场景号> <一句话症状>
Body:
- 产品版本: vX.Y.Z.N (productVersion) + cc 0.X.Y
- 测试机:
  - 设备型号 / Android 版本 / Magisk 版本 / Zygisk on?
  - WeChat 版本 (`adb shell dumpsys package com.tencent.mm | grep versionName`)
  - frida-server 版本 + 端口
  - root: yes/no/partial（Magisk install but no DenyList?）
- 桌面: OS / Node version / Ollama model
- 重现步骤: <详细到能 deterministic 复现的程度>
- env-probe 完整 JSON: `cc hub wechat env-probe --json | jq .`
- **FridaKeyProvider telemetry**（决定性诊断 — 见 §5.1）:
  `cc hub wechat register ... --json | jq '.fridaTelemetry'`
  （必含 `hooked / keySource / keySig / keyFormat / keyLength / keyAlt / errors / durationMs`）
- 桌面 hub.log 最后 200 行
- frida-message.log（如适用）
- vault.db 状态: `cc hub stats --json`
- audit 最近: `cc hub recent-audit --since <出问题前 10 min> --limit 50 --json`
```

---

## 7. 通过 Phase 12.9 后

PASS 后该做的：

1. 在 `docs-site/docs/chainlesschain/personal-data-hub.md` 把 WeChat row 状态从 🚧 v0.5 升为 ✅ Phase 12.9 verified
2. 在 `Adapter_WeChat_SQLCipher.md` §18.8 v1 验收清单打勾
3. 在 [`docs/internal/hidden-risk-traps.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/internal/hidden-risk-traps.md) 补充本次发现的新 trap
4. 在 `MEMORY.md` 加 entry：`wechat_phase_12_9_real_device_verified.md` — 设备型号 + WeChat 版本 + 通过日期
5. 升级 productVersion `vX.Y.Z.N+1`，CHANGELOG 加 "Phase 12.9 WeChat real-device E2E PASS — N scenarios verified on `<device>` / WeChat `<ver>`"

---

## 8. 相关

- [`Adapter_WeChat_SQLCipher.md`](./Adapter_WeChat_SQLCipher.md) §13 trap 登记 / §18 frida-dep 桥接设计
- [`Adapter_WeChat_SQLCipher_Frida_Setup.md`](./Adapter_WeChat_SQLCipher_Frida_Setup.md) 用户端 Frida server setup（本文档前置）
- [`Personal_Data_Hub_E2E_Runbook.md`](./Personal_Data_Hub_E2E_Runbook.md) §11 env-probe + register 流程（本文档前置）
- [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 12 路线图
- [`Personal_Data_Hub_Fixture_Pin_Protocol.md`](./Personal_Data_Hub_Fixture_Pin_Protocol.md) 如果你跑出来发现 schema 与既有 fixture 偏差，按本协议 pin 新 fixture

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E runbook（frida-dep path）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文场景。

### 1. 概述

见正文「范围」。Phase 12.9 WeChat 真机 E2E（frida-dep path）验收：注册完之后的 ingest / 解密 / 查询 / 长期稳定性怎么验（setup 见 Frida Setup、注册见 E2E Runbook §11）。

### 2. 核心特性

验收门禁 + 环境矩阵 + 全场景；性能基准合集；设备 vs 桌面机能力分布；已知 traps。

### 3. 系统架构

见 `Adapter_WeChat_SQLCipher.md` §18 frida-dep 桥接设计。

### 4. 系统定位

Phase 12.9 WeChat 桌面侧的**真机 E2E 验收 runbook**（11 场景）。

### 5. 核心功能

见正文 0–5：验收门禁 / 环境矩阵 / 场景一览 / 详细场景 / 性能基准 / 已知 traps。

### 6. 技术架构

frida-server（桌面侧 ssh）+ SQLCipher 解密；env-probe + register（E2E Runbook §11 前置）。

### 7. 系统特点

前置 = Frida Setup（server）+ E2E Runbook §11（注册）；本文专注 ingest 之后验收。

### 8. 应用场景

WeChat 桌面采集发版前真机验收。

### 9. 竞品对比

桌面侧（frida-server）vs Android 侧（frida-inject，`Android_WeChat_Phase_12_10_6_...`）。

### 10. 配置参考

见正文 1「测试机环境矩阵」。

### 11. 性能指标

见正文 4「性能基准合集」+ 4.4 设备 vs 桌面机能力分布。

### 12. 测试覆盖

11 场景（见正文 2/3）；schema 偏差按 Fixture Pin Protocol 处理。

### 13. 安全考虑

微信语料极高敏感；frida 解密本机自用；SQLCipher 加密。

### 14. 故障排除

见正文 5「已知 traps」（与 `Adapter_WeChat_SQLCipher.md` §13/§18.9 重叠不重述）。

### 15. 关键文件

`Adapter_WeChat_SQLCipher.md` §18；frida-server；vault。

### 16. 使用示例

见正文 3「详细场景」执行步骤。

### 17. 相关文档

见正文「8. 相关」：`Adapter_WeChat_SQLCipher.md`、`Adapter_WeChat_SQLCipher_Frida_Setup.md`、`Personal_Data_Hub_E2E_Runbook.md` §11、`Personal_Data_Hub_Fixture_Pin_Protocol.md`。
