# DB 加密翻 gate · B.2 人工 GUI smoke — PowerShell 步骤单

> 配套 `db-encryption-preflip-checklist.md` 的 **B.2**。B.1 探针（`npm run test:db-encryption-realstore`，真 DPAPI）全绿后，**只剩这 2 条真实用户路径**需在真 Windows 桌面人工跑：
> 1. **装旧版（明文库）→ 升级开加密**：探针用临时 fixture 库，验不了真实 `<userData>` 升级路径。
> 2. **真断电/强杀中断迁移**：探针不做物理中断；崩溃恢复的逻辑分支 L2 G5a/G5b 已证，这里验真现场不丢数据。
>
> 其余场景（数据一致 / 旧 key 打不开 / 并发锁 / kill-switch / fail-closed）已被 A 层 52 测试 + B.1 探针 6 测试自动覆盖，**本单不重复**。

---

## 0. 关键事实（本仓库实测）

| 项 | 值 |
|---|---|
| `<userData>` | `$env:APPDATA\chainlesschain-desktop-vue` |
| 明文库 | `<userData>\data\chainlesschain.db` |
| 加密库 | `<userData>\data\chainlesschain.encrypted.db` |
| 源库改名（迁移成功） | `<userData>\data\chainlesschain.db.old` |
| 迁移备份 | `<userData>\data\chainlesschain.db.backup.<ts>` |
| 迁移锁（迁移中存在） | `<userData>\data\chainlesschain.encrypted.db.migrating.lock` |
| 托管口令（safeStorage 密文） | `<userData>\db-secret.enc` |
| 密钥元数据（salt，不含密钥） | `<userData>\db-key-config.json` |
| 主进程日志 | `<userData>\logs\chainlesschain-<yyyy-mm-dd>.log` |
| 加密开关 env | `CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION=1`（强开）/ `=0`（kill-switch 强关）|

> ⛔ **绝不能用 `npm run dev` / `npm run start` 跑本 smoke**：它们带 `CHAINLESSCHAIN_DISABLE_NATIVE_DB=1`，会强制 sql.js 明文回退，**整条 SQLCipher 迁移路径被绕过**，跑了等于没跑。

### 先放一组 PowerShell 辅助变量（每个新窗口先粘一次）

```powershell
$UD   = Join-Path $env:APPDATA 'chainlesschain-desktop-vue'
$DATA = Join-Path $UD 'data'
$LOG  = Get-ChildItem (Join-Path $UD 'logs') -Filter 'chainlesschain-*.log' |
        Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName

function Show-DbFiles { Get-ChildItem $DATA -ErrorAction SilentlyContinue |
  Select-Object Name,Length,LastWriteTime | Format-Table -Auto
  '--- userData root ---'
  Get-ChildItem $UD -Filter 'db-*' -ErrorAction SilentlyContinue |
  Select-Object Name,Length | Format-Table -Auto }

function Tail-DbLog { param([int]$n=80)
  $LOG = Get-ChildItem (Join-Path $UD 'logs') -Filter 'chainlesschain-*.log' |
         Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName
  Get-Content $LOG -Tail $n |
  Select-String '加密|encrypted-migration|口令来源|opt-in|迁移|回收陈旧|拒绝明文|requireEncryption' }

function Kill-App { Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^(ChainlessChain|electron)' } |
  Stop-Process -Force; Start-Sleep 1; 'killed' }
```

### 启动方式（二选一，A 最忠实）

**A — 打包 exe（推荐，真实安装/升级语义）**
用你平时发布的安装包装好后定位 exe（forge 输出常在 `desktop-app-vue\out\...\ChainlessChain.exe`）。设 `$APP = '<那个 exe 的完整路径>'`，启动：
```powershell
$env:CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION = '1'   # 或先不设 = 明文基线
& $APP
```

**B — production-from-repo（快，userData 同为 chainlesschain-desktop-vue）**
```powershell
cd C:\code\chainlesschain\desktop-app-vue
npm run build                                     # 必须先 build:renderer + build:main
# 明文基线（不设 env）：
$env:NODE_ENV='production'; Remove-Item Env:\CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION -ErrorAction SilentlyContinue; npx electron .
# 开加密：
$env:NODE_ENV='production'; $env:CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION='1'; npx electron .
```
> 用 B 时**务必确认没有** `CHAINLESSCHAIN_DISABLE_NATIVE_DB`（`Get-ChildItem Env:CHAINLESS*` 查一下）。下文统一记启动为「**启动(明文)**」「**启动(=1)**」。

---

## 场景 1 — 装旧版（明文库）→ 升级开加密（核心）

### 1.1 重置到「未迁移」干净态

```powershell
Kill-App
# 备份现有 data（保险），然后清掉加密产物、把 .old 还原成主库
$bak = Join-Path $UD ("data.bak-" + (Get-Date -Format yyyyMMdd-HHmmss))
if (Test-Path $DATA) { Copy-Item $DATA $bak -Recurse }
Remove-Item (Join-Path $DATA 'chainlesschain.encrypted.db') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $DATA 'chainlesschain.encrypted.db.migrating.lock') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $UD   'db-secret.enc')        -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $UD   'db-key-config.json')   -Force -ErrorAction SilentlyContinue
$old = Join-Path $DATA 'chainlesschain.db.old'
if (Test-Path $old) { Move-Item $old (Join-Path $DATA 'chainlesschain.db') -Force }
Show-DbFiles    # 期望：有 chainlesschain.db；无 *.encrypted.db / db-secret.enc
```

### 1.2 明文基线 + 造数据

- [ ] **启动(明文)**。日志应见 `数据库加密状态: 未启用`（`Tail-DbLog`）。
- [ ] 在 App 里建 **≥3 条笔记** + **≥1 个会话**。记下当前**笔记数 = ______、会话数 = ______**（看列表数）。
- [ ] 完全退出（`Kill-App` 或正常关闭）。
- [ ] `Show-DbFiles` 确认：有 `chainlesschain.db`，**无** `chainlesschain.encrypted.db`，**无** `db-secret.enc`。

### 1.3 升级开加密 + 首次迁移

- [ ] **启动(=1)**。`Tail-DbLog` 应连续出现：
  - [ ] `DB 加密 opt-in 已开启`
  - [ ] `数据库加密状态: 已启用`
  - [ ] `数据库口令来源: managed-new`
  - [ ] `[encrypted-migration] 迁移 + 重开校验通过`
- [ ] **数据完好**：App 内笔记数 == 1.2 记下的数、会话数 == 1.2 记下的数。
- [ ] `Show-DbFiles` 确认：
  - [ ] 出现 `chainlesschain.encrypted.db`
  - [ ] 出现 `chainlesschain.db.old`（源库已改名）
  - [ ] 出现 `db-secret.enc`
  - [ ] **无** `chainlesschain.encrypted.db.migrating.lock`（锁已清）

### 1.4 二次启动复用托管口令（不重迁移）

- [ ] 完全退出，再次 **启动(=1)**。`Tail-DbLog` 应见 `数据库口令来源: managed`（**不是** `managed-new`，即复用，不再 migrate）。
- [ ] App 内数据仍完好（条数不变）。

> **场景 1 通过判据**：1.3 数据零丢失 + 三个加密产物文件齐全 + 锁清理 + 1.4 复用 managed 口令。
> 任一不满足 → **不翻 gate**，把 `Tail-DbLog` 全文 + `Show-DbFiles` 贴回。

---

## 场景 2 — 真断电/强杀中断迁移（不丢数据）

> 难点是要在「迁移进行中」的窗口内打断。库越大窗口越长 → 先把库撑大，再强杀。

### 2.1 撑大库 + 重置到未迁移态

- [ ] 用场景 1.2 的方式（或导入大量数据）把 `chainlesschain.db` 撑到**够大**（迁移肉眼可感，几百 ms~数秒）。
- [ ] 按 **1.1** 重置到未迁移态（保留这个大 `chainlesschain.db`）。

### 2.2 迁移中强杀 / 断电

- [ ] **启动(=1)**，在日志刚出现 `DB 加密 opt-in 已开启` / 迁移开始、但**还没出现** `迁移 + 重开校验通过`的窗口内：
  - 物理断电，或在另一个 PowerShell 窗口立即跑 `Kill-App`。
- [ ] `Show-DbFiles` 看中断现场：可能残留 `*.migrating.lock`、半成品 `*.encrypted.db`，但**源 `chainlesschain.db` 或其 `.old`/`.backup.<ts>` 必须还在**。

### 2.3 重启恢复

- [ ] 再次 **启动(=1)**。期望：
  - [ ] 源明文库/`.old`/`.backup.<ts>` 仍在，**数据可恢复、零丢失**。
  - [ ] App 能重试迁移并最终成功（最终见 `迁移 + 重开校验通过`），或锁 >10min 被自动回收（日志 `回收陈旧迁移锁`）。
  - [ ] 最终**无残留** `*.migrating.lock` 阻塞。
- [ ] 进 App 核对数据条数 == 撑大后的预期数（零丢失）。

> **场景 2 通过判据**：中断后重启**没丢任何数据**、能恢复/重试到成功、无孤儿锁。
> 若一次没卡进迁移窗口（库太小迁移瞬间完成）→ 把库撑更大重试；多次仍抓不到窗口时记录现象，连同 `Tail-DbLog` 贴回评估。

---

## 跑完之后

1. 把两场景的 `Tail-DbLog` 输出 + `Show-DbFiles` 输出 + 记下的条数贴回，我帮你判读签核。
2. 两场景全过 → 在 `db-encryption-preflip-checklist.md` 签核表 B.2 打勾。
3. 然后翻 gate（C/D 段）：
   - 改 `desktop-app-vue\src\main\database\db-encryption-flag.js`：`PHASE_1_5_DEFAULT_ON = false` → `true`
   - 同步改 `db-encryption-flag.test.js` 里 `expect(PHASE_1_5_DEFAULT_ON).toBe(false)` → `toBe(true)`
   - 跑 `npm run test:db-encryption` 复绿 → commit（`feat(db): flip Phase 1.5 — DB encryption on by default in packaged builds`）

> 恢复用：场景跑乱了想还原，1.1 里备份的 `data.bak-<ts>` 整目录拷回 `data` 即可。

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：DB 加密翻 gate · B.2 人工 GUI smoke — PowerShell 步骤单。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
