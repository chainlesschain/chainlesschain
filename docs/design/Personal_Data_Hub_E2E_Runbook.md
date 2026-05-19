# Personal Data Hub — E2E 真机验收 Runbook

> Phase 5.7 deliverable. Companion to [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md).
>
> 这份 runbook 描述 8 个真机 E2E 场景的**精确执行步骤、命令、预期输出、截图清单、通过/不通过判据**。每跑一遍把结果填到下方的"结果记录"表里，不通过的场景做 issue 跟踪。

## 0. 前置准备

### 0.1 测试账号要求

至少准备 **2 个真实邮箱账号**：
- 1 个 **QQ 邮箱**（最高频用户群体）— 开启 IMAP + 生成授权码
- 1 个 **189 邮箱** 或 **163 邮箱**（一个国内备份，挑你常用的）
- 银行账单（建议招行 / 工行 / 建行至少一个）— 确保过去 1 年内至少有 3 封含 **加密 PDF 附件** 的月对账单进入收件箱

### 0.2 测试机环境

- Win10/11 主机或 Win 子系统（开发环境）
- Node 22.x（不要用 23+，参 memory `node_23_native_dep_trap.md`）
- 桌面 app: `cd desktop-app-vue && npm run dev` 启动开发模式，或先 `npm run build && npm run make:win` 装好打包版
- CLI: `cc --version` 应是当前 `package.json.productVersion` 对应的 npm 版本

### 0.3 启动前清理（仅在做"全新用户"流程时跑）

```powershell
# 备份现有 hub 数据
$src = "$env:APPDATA\chainlesschain-desktop-vue\.chainlesschain\hub"
$dst = "$env:APPDATA\chainlesschain-desktop-vue\.chainlesschain\hub.backup-$(Get-Date -Format yyyyMMddHHmm)"
if (Test-Path $src) { Move-Item $src $dst }
```

跑完场景后用 `Move-Item $dst $src` 还原。

---

## 1. 场景 1 — QQ 邮箱授权码配置

**目的**: 验证引导文档可读、provider 选择正确、authCode 校验生效、连接测试成功

### 步骤

1. 打开桌面 app → 进入"个人数据中台"页面（侧栏第 N 项）
2. 点 "添加邮箱账号" 按钮
3. 选 **QQ 邮箱**
4. 输入完整邮箱地址 `<your-name>@qq.com`
5. 鼠标悬停 authCode 输入框旁的 `ⓘ` 图标 — 应弹出文字：`QQ: 邮箱 → 设置 → 账户 → IMAP/SMTP → 开启 → 生成授权码`
6. 不输入 authCode，点 "测试连接" — 按钮应 **disabled**（不可点）
7. 输入一个**故意错的** authCode，点 "测试连接" — 应在 5 秒内显示 `认证失败: AUTH_FAILED`，红色 alert
8. 输入**真实**的授权码（按提示从 QQ 邮箱后台生成），点 "测试连接" — 应在 3 秒内显示 `凭证有效 — 可以保存`，绿色 alert
9. 点 "保存并注册" — Drawer 关闭，Adapters 表中出现 `email-imap` 行

### 通过判据

- 所有 8 步都按预期发生
- Adapters 表显示 `email-imap` · v0.6.0 · 高敏感度
- `<hubDir>/email-accounts.json` 存在且 mode = 600（Linux/Mac；Win 检查 ACL）
- 配置文件 JSON 内**确实写了 authCode**（这是必须的，下次同步要用）

### 失败时记录

- 截图: drawer 打开 + 错误 alert
- `cc doctor` 输出 + 日志 `<userData>/logs/main.log` 末尾 200 行

---

## 2. 场景 2 — 189 / 163 邮箱授权码配置（重复场景 1）

跟场景 1 完全相同的流程，只是 provider 改 `189` 或 `163`，授权码格式不同。

**关键差异 / 注意点**：
- 网易系（163 / 126）授权密码：邮箱 → 设置 → POP3/SMTP/IMAP → 开启 → 一次性显示
- 189: 邮箱设置 → 第三方客户端授权码（更隐蔽，文档应明确指向）

---

## 3. 场景 3 — 拉过去 1 年邮件（完整 + 分类 + 进度条不卡死）

**前置**: 场景 1 / 2 至少有一个邮箱已配置成功

### 步骤

1. 在 Adapters 表中找到 `email-imap` 行，点 "同步"
2. **Phase 5.7 重点观察**: 应出现 "同步进行中" 卡片，进度条逐步前进，phase 文本动态切换：
   - `connecting` (attempt 1)
   - `connected`
   - `mailbox-opened` INBOX
   - `fetching` 1 / N → 2 / N → ...
   - `done` (最终)
3. 拉满约 5-10 分钟（取决于邮件数）。**全程进度条应一直动**，不能卡在某个数字超过 60 秒
4. 完成后底部出现 `同步 email-imap: ok` 绿色 alert + 数字摘要 (events=K persons=K KG triples=N RAG docs=N | <duration>ms)
5. 在 stats 卡片刷新后，Vault 事件数应跟摘要里 events 一致

### 验证分类准确性

挑 30 封邮件人工 spot-check：
```bash
# CLI 路径 — 拉 30 条最近 email-imap 事件
cc personal-data-hub query-events --adapter email-imap --limit 30 --json
```

每条事件 `extra.classified` 应是 8 类之一 (`bill_bank`, `bill_credit`, `order`, `travel`, `government`, `register`, `notify`, `other`)。期望：
- 招行/工行/建行/中行的对账单邮件 → `bill_bank`，置信度 ≥ 0.92
- 淘宝 / 京东 / 拼多多 → `order`
- 携程 / 12306 → `travel`
- 银保监会 / 税务局 → `government`
- 各种"您的验证码" → `register` + `verificationCodePresent: true`，且 `content.text === "(redacted: verification code email)"`
- 营销邮件 → `notify` 或 `other`

### 通过判据

- 进度条不卡（任意 60s 窗口都有数字推进）
- 分类准确率 ≥ 80%（30 条样本中 ≥ 24 条与人工判断一致）
- 验证码邮件 100% 触发 redaction

### 失败时记录

- 进度条卡死时的 phase + current/total
- 错分类样本：subject、from、`extra.classified`、人工判断

---

## 4. 场景 4 — 银行 PDF 加密附件解密 + transactions 抽取

**前置**: 场景 3 完成，vault 中至少有 1 封 `bill_bank` 邮件且其 `parsedBody.attachments` 含 PDF 附件

### 准备

如果场景 1 注册邮箱时没填 PDF 密码提示：
1. 点 "添加邮箱账号"（或编辑现有 — 注：v0 不支持 inline edit，需先 unregister 再重新 add）
2. 填写："身份证后 6 位" / "手机后 6 位" / "信用卡尾 6 位" 至少一个真实值
3. 保存

### 步骤

1. 触发 "同步" 一次（PDF 解密在 sync 路径上）
2. 同步完成后，在某条 `bill_bank` 事件上点 event-id（在 ask 结果引用 tag，或通过 CLI `cc personal-data-hub query-events --adapter email-imap --limit 5 --json` 拿到 id）
3. ask 一句话：`帮我看一下 [event-id] 的明细`，citations 应包含该 id
4. 点引用 tag — 打开 Event 详情 drawer
5. Drawer 中：
   - "PDF 解密 / 解析" 区显示 ≥ 1 个文件名（`招行账单_XX月.pdf` 等），状态 = 绿色 `已解密`
   - 显示 `提取 K 条交易`，K ≥ 3
   - "交易明细" 表显示 K 条记录，每条含日期、描述、金额、方向（红 -支出 / 绿 +收入）

### 通过判据

- 至少 1 封 bill_bank 的 PDF 解密成功（**前提**：用户填的 hint 至少 1 个对得上）
- 解密失败的 PDF 显示红色 `解密失败` + 失败原因 + 尝试次数（≥ 4 = empty + 3 hints）
- 提取的交易方向准确率 ≥ 90%（红 ≈ 支出，绿 ≈ 退款/工资入账）

### 失败 SOP（参 Adapter_Email_IMAP.md T4 — PDF 密码尝试失败）

- 解密失败的所有附件：CLI 取出 raw payload → 手工试密码 → 加入 hints
- 标记 unparsable 邮件：UI 不卡，事件仍在 vault（只是缺 transactions）

---

## 5. 场景 5 — 自然语言查询（架构 doc §7.1 5 类问题）

**前置**: 场景 3-4 完成

### 5 类问题（按 Personal_Data_Hub_Architecture.md §7.1）

跑下面 5 条 ask，每条人工判通过。

| # | 问题 | 期望答案模式 |
|---|---|---|
| Q1 | 上个月在淘宝总共花了多少？ | 含具体金额（¥X）+ 引用 N 条 order 事件 |
| Q2 | 我妈生日那周（XX 月 XX 日左右）买过什么礼物？ | 列出该时间窗口的 order 事件 + 商品名 |
| Q3 | 招行信用卡 11 月还款是多少？什么时候到期？ | dueAmount + dueDate 准确（与 PDF 内容一致）|
| Q4 | 今年坐了几次飞机？分别去哪？ | 列出 travel events，vehicleType=flight 的子集 |
| Q5 | 最近收到过哪些 GitHub 的邮件？ | 列出 register/notify 类，serviceName=GitHub；**且不能泄露任何验证码** |

### 通过判据

- Q1-Q4 答案非空且与 vault 数据对得上（手工抽样验证）
- Q5: 答案文本搜索任何 6 位数字 → 不应出现（验证码 redaction 跨整个分析链路有效）
- 每条 citations 数 ≥ 1（不能是 hallucinated-citations warning）

### 失败时记录

- 答案 + citation ids + 模型名 + durationMs
- 期望 vs 实际的 diff 截图

---

## 6. 场景 6 — 增量同步（隔天再跑只拉新邮件）

### 步骤

1. 场景 3 跑完后记录：`stats.vault.events` 数字（设为 N1）
2. 等至少 1 小时，让邮箱新进 ≥ 1 封邮件（自己发一封到自己也行）
3. 再点一次 "同步"
4. 同步完成后再看 `stats.vault.events`（N2）
5. 进度条上的 `fetching` 应只跑很快（数到 1 或 2 就 done），不重新拉全部

### 通过判据

- N2 - N1 = 间隔期新进邮件数（误差 ≤ 1）
- 增量同步 duration < 10 秒（QQ/163 直连情况下）
- audit_log 中 `adapter.sync.ok` 行应显示 `rawCount` 等于本次新邮件数，不是 N2 全量

### 失败时记录

- N1 / N2 / 实际新邮件数 / rawCount 全部记下来
- watermark 文件 `<hubDir>/keys/sync-watermarks.json` 内容（确认 lastUid 递增了）

---

## 7. 场景 7 — 网络中断恢复（自动续传不丢不重）

**目的**: 验证 Phase 5.7 的 retry-with-backoff + watermark 持久化

### 步骤

1. 触发 "同步全部"
2. 进度条到 `fetching 50 / 500` 时（或任意中间状态），**断开 WiFi 30 秒**（保持 cable 拔掉或 airplane mode）
3. 观察 UI：进度条变红 (`exception` status)，phase 切到 `error`，并显示 `重试 #2` / `重试 #3`
4. 30 秒后恢复网络
5. 如果中断发生在 `connecting` 阶段，retry 会在网络恢复后成功，sync 完整继续
6. 如果中断发生在 `fetching` 阶段（已经在拉数据），sync 当前会**失败终止**（Phase 5.7 v0 限制：fetch-iteration retry 留 Phase 5.8）
7. **失败情况下，再点一次 "同步" — 应从断点之后继续**，不是从头拉

### 通过判据

- connecting 阶段中断：retry 自动恢复，全程不需手动重启
- fetching 阶段中断：sync 报错，但再次手动触发后从 watermark 继续，不丢邮件不重复（`rawCount` ≈ 上次断点之后的新数）
- 重试期间 `attempt` 数字显示在进度卡片上

### 失败时记录

- 中断点 phase + current/total
- 主进程日志中 retry 决策（`[PersonalDataHub sync] adapter-progress` phase=error retriable=...）
- 恢复后第二次 sync 的 rawCount

---

## 8. 场景 8 — 撤销授权码（UI 显示 AUTH_EXPIRED + 引导重输）

**目的**: 模拟邮箱授权码被用户在邮箱后台撤销 / 过期的恢复体验

### 步骤

1. 场景 1-3 完成（账号已注册并同步过）
2. 进入 QQ 邮箱后台 → 设置 → 账户 → IMAP/SMTP → **删除已生成的授权码**
3. 回到桌面 app，点 "同步"
4. 预期：UI 显示红色 alert，错误信息含 `AUTH_FAILED` 或类似（具体取决于 QQ 服务端回复）
5. 进度条 phase=error，attempt 显示尝试次数（应**不重试** — auth 错误 short-circuit，参 Phase 5.7.1 `isTransientImapError`）
6. UI 应**引导用户重新生成授权码 + 编辑账号**（v0 限制：UI 没有 inline edit 流程，文档应建议先 unregister 再 add 新的）

### 通过判据

- AUTH_FAILED 不被 retry（attempt 应保持 1）
- 错误信息明确（"Authentication invalid" 或类似），不显示原始 IMAP 协议错误码
- vault 数据完整保留，不因为认证失败而丢任何已同步事件

### 失败时记录

- 实际错误信息全文
- 重试次数（应是 1）
- 重新生成授权码后点 "添加邮箱账号" 再走一遍场景 1 是否顺利

---

## 9. 结果记录模板

每跑一遍把表填出来：

| 场景 | 状态 | 跑的人 | 日期 | 耗时 | 备注 |
|---|---|---|---|---|---|
| 1 — QQ 配置 | ⏳ / ✓ / ✗ | | YYYY-MM-DD | Xmin | |
| 2 — 189/163 配置 | | | | | |
| 3 — 拉 1 年邮件 + 分类 | | | | | |
| 4 — PDF 解密 + transactions | | | | | |
| 5 — 5 类自然语言查询 | | | | | |
| 6 — 增量同步 | | | | | |
| 7 — 网络中断恢复 | | | | | |
| 8 — 授权码撤销 | | | | | |

通过：**全部 8 个 ✓**。任一 ✗ 提 issue 跟踪，issue 模板：
```
Title: [PDH E2E] <场景编号> <一句话症状>
Body:
- 跑的版本: vX.Y.Z.N (productVersion) + cc 0.X.Y
- 邮箱 provider: qq / 163 / ...
- 重现步骤: <runbook 第几步开始偏差>
- 实际 vs 预期: <diff>
- 日志 / 截图: <附件>
```

---

## 10. 性能基准

跑场景 3 + 6 时同时记录以下性能数字（写到 release notes）：

| 指标 | 单位 | 期望 | 实测 |
|---|---|---|---|
| 1000 邮件全量同步耗时 | sec | ≤ 300 | |
| 增量同步（10 新邮件）耗时 | sec | ≤ 20 | |
| 单 PDF 解密 + transactions 抽取 | ms | ≤ 5000 | |
| 自然语言 ask 平均 durationMs | ms | ≤ 8000 | |
| Vault 占用磁盘（1000 邮件） | MB | ≤ 150 | |

跑性能时关掉杀毒软件 / 限速软件 / 同步盘（OneDrive / 坚果云）以减少噪声。
