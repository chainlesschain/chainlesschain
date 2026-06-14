# Phase 4.5 — 真机测试复现器（全 4 source）

> **状态**：v0.2（2026-05-20）。Phase 4.5.1 → 4.5.6 全部落地后，可在 Redmi 24115RA8EC（Android 16 / SDK 36）上做端到端真机测试。
>
> **配套**：[`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) v0.3、[`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md)、[`Adapter_System_Data.md`](./Adapter_System_Data.md)。
>
> **范围**：Contacts + Call Log + SMS + WiFi 全 4 source via `SystemDataAdapter`。Sidecar extractors：`android.list_devices` / `android.pull_file` / `android.adb_shell` / `android.adb_backup`。
>
> **v0.1 → v0.2 差异**：从单 method (contacts only) 升级到全 adapter 流。新增 SMS opt-in + WiFi 优雅降级 + adb backup / shell。原单 source smoke `smoke-system-data-contacts.js` 保留供单点验证；正式入口 `smoke-system-data.js`。

---

## 1. 前置准备

### 1.1 Host 侧（Windows / Mac / Linux dev box）

```bash
# 1. Python 3.11+（已有 3.12.10）
python --version

# 2. Sidecar 依赖（pytest 仅测试用）
cd packages/personal-data-hub-bridge
pip install -e ".[test]"

# 3. Node 依赖
cd ../personal-data-hub
npm install  # 复用 monorepo 已 hoist 的 better-sqlite3-multiple-ciphers

# 4. ADB 在 PATH 上
adb version
# Android Debug Bridge version 1.0.41 ...
```

### 1.2 Device 侧（Redmi 24115RA8EC）

| 项 | 要求 | 备注 |
|---|---|---|
| USB 调试 | ON | 开发者选项 → USB 调试 |
| ADB 授权 | "始终允许此电脑" | 第一次 `adb devices` 后弹的对话框 |
| Root 状态 | **二选一** | 见下方 §2.1（root）/ §2.2（非 root 工作流） |

确认设备能 talk：

```bash
adb devices -l
# List of devices attached
# 24115RA8ECabc123  device usb:1-3 product:redmi_xxx model:Redmi_xxx ...
```

记下 serial（这里假设是 `24115RA8ECabc123`）。

---

## 2. 把 contacts2.db 拿到 host 侧

> Android 11+ 把 `/data/data/com.android.providers.contacts/databases/contacts2.db` 锁在 root 之下。普通用户的 ADB 没法直接 `adb pull` 系统 provider 数据。所以有两条路：

### 2.1 Root 路径（最干净，需要 Magisk / userdebug）

```bash
# 一次性提权 adb（要求 ro.debuggable=1 或 Magisk）
adb root
# adbd is already running as root —— or:
# adbd cannot run as root in production builds

# 之后直接 pull
adb pull /data/data/com.android.providers.contacts/databases/contacts2.db ./contacts2.db
```

**Redmi 24115RA8EC 默认零售 build 不允许 adb root**。下面用 §2.2 兜底。

### 2.2 非 root 路径（Termux + tsu / Magisk 内 sh）

如果设备已 root 但 `adb root` 被锁，从设备内 shell 提权，先把 db 拷到 `/sdcard/Download/`（普通 ADB 可读位置）：

```bash
# 设备侧（Termux app + tsu，或 MT Manager root shell）
su -c 'cp /data/data/com.android.providers.contacts/databases/contacts2.db /sdcard/Download/contacts2.db'
su -c 'chmod 644 /sdcard/Download/contacts2.db'

# Host 侧
adb -s 24115RA8ECabc123 pull /sdcard/Download/contacts2.db ./contacts2.db
```

### 2.3 完全无 root（Android 14+ Mi Cloud 导出）

小米账号 → 云服务 → 通讯录 → 导出为 vcf。**本 phase 不支持** vcf 解析（系统 provider parser 走的是 SQLite schema）。这条路径要等 Phase 5+ 加 `contacts.parse_vcard`。

---

## 3. 通过 sidecar 跑全链路

### 3.1 一键 smoke 脚本（推荐）

**入口 1 — `smoke-system-data.js`（全 4 source，正式入口）**：

```bash
cd packages/personal-data-hub

# A. 离线（host 上已有 4 个 db 文件）
node scripts/smoke-system-data.js \
  --contacts-db ./contacts2.db \
  --calllog-db ./contacts2.db \
  --sms-db ./mmssms.db \
  --wifi-dir ./wifi/

# B. 真机 sdcard workaround（非 root）— 默认不含 SMS
node scripts/smoke-system-data.js \
  --serial 24115RA8ECabc123 \
  --extract-mode sdcard

# C. 真机 + 显式 opt-in SMS（用户知情）
node scripts/smoke-system-data.js \
  --serial 24115RA8ECabc123 \
  --extract-mode sdcard \
  --include sms

# D. 真机 + 排除 WiFi（隐私偏好）
node scripts/smoke-system-data.js \
  --serial 24115RA8ECabc123 \
  --extract-mode sdcard \
  --exclude wifi

# E. 仅列设备
node scripts/smoke-system-data.js --list
```

**入口 2 — `smoke-system-data-contacts.js`（仅 contacts 切片，Phase 4.5.2 原始 smoke）**：

```bash
node scripts/smoke-system-data-contacts.js --db ./contacts2.db
node scripts/smoke-system-data-contacts.js --serial XYZ --workaround sdcard
```

### 3.2 默认隐私行为（无需 flag）

| Source | 默认 | 启用方式 |
|---|---|---|
| contacts | ✓ 开 | 自动 |
| calllog | ✓ 开 | 自动 |
| **sms** | ✗ 关 | `--include sms`（显式知情同意） |
| wifi | ✓ 开 | 自动（密码字段永不入库，只记元数据） |

任何 source 都可 `--exclude <key>` 关闭，或 `--include <key>` 开启 / 强制保留。

### 3.3 真机 sdcard workaround 详细步骤

无 root 时，配合 Termux + tsu / MT Manager root shell 复制 4 个 source 到 `/sdcard/Download/`：

```bash
# 设备侧（Termux 内 su -c 或 MT Manager root 文件管理器）
su -c 'cp /data/data/com.android.providers.contacts/databases/contacts2.db /sdcard/Download/contacts2.db'
su -c 'cp /data/data/com.android.providers.contacts/databases/calllog.db /sdcard/Download/calllog.db 2>/dev/null || true'
su -c 'cp /data/data/com.android.providers.telephony/databases/mmssms.db /sdcard/Download/mmssms.db'
su -c 'cp /data/misc/wifi/WifiConfigStore.xml /sdcard/Download/WifiConfigStore.xml'
su -c 'chmod 644 /sdcard/Download/contacts2.db /sdcard/Download/calllog.db /sdcard/Download/mmssms.db /sdcard/Download/WifiConfigStore.xml'

# Host 侧 — smoke 脚本会自动从 /sdcard/Download/ pull
node scripts/smoke-system-data.js --serial <YOUR_SERIAL> --extract-mode sdcard
```

**输出**（成功时）：

```
{"ts":"...","level":"info","msg":"output directory ready","outDir":"C:\\...\\out\\20260520-093045"}
[sidecar] {"ts":...,"level":"info","msg":"forensics-bridge starting","methods":[...]}
{"ts":"...","level":"info","msg":"sidecar ready"}
{"ts":"...","level":"info","msg":"progress","processed":0,"total":287,"phase":"scanning"}
{"ts":"...","level":"info","msg":"progress","processed":200,"total":287,"phase":"parsing"}
{"ts":"...","level":"info","msg":"progress","processed":287,"total":287,"phase":"done"}
{"ts":"...","level":"info","msg":"parse completed","status":"ok","totalPersons":287,"watermark":null,"stats":{"with_phone":283,"with_email":42,"starred":12},"chunks":2,"wallMs":380,"personsCollected":287}
{"ts":"...","level":"info","msg":"all persons passed UnifiedSchema validation"}
{"ts":"...","level":"info","msg":"summary","totalPersons":287,"withPhone":283,"withEmail":42,"starred":12,"invalidPersons":0,"outDir":"..."}
```

### 3.2 输出目录

```
out/20260520-093045/
  ├── contacts2.db                          (只有 --serial 走 pull 时才有)
  └── contacts-normalized-batch.json         (Persons + parse result + 元数据)
```

`contacts-normalized-batch.json` 示例片段（**已脱敏**）：

```json
{
  "schemaVersion": "0.1.0",
  "generatedAt": "2026-05-20T01:30:45.123Z",
  "sidecar": { "pythonRoot": "C:\\code\\chainlesschain\\packages\\personal-data-hub-bridge" },
  "input": { "dbPath": "...", "serial": "24115RA8ECabc123", "workaround": "sdcard" },
  "parseResult": {
    "status": "ok",
    "totalPersons": 287,
    "watermark": null,
    "stats": { "with_phone": 283, "with_email": 42, "starred": 12 }
  },
  "wallMs": 380,
  "persons": [
    {
      "id": "person:system:android:1",
      "type": "person",
      "subtype": "contact",
      "names": ["妈妈"],
      "identifiers": { "phone": ["13800001111", "13900002222"], "email": ["mom@..."] },
      "ingestedAt": 1716180123456,
      "confidence": 1.0,
      "source": { "adapter": "system-data", "adapterVersion": "0.1.0", "originalId": "1", "capturedAt": ..., "capturedBy": "sqlite" },
      "extra": { "starred": true, "deviceSerial": "24115RA8ECabc123" },
      "notes": "亲妈，过年回家"
    }
  ]
}
```

---

## 4. 验收 checklist

| # | 验收项 | 预期 |
|---|---|---|
| V1 | `python -m pytest`（在 `personal-data-hub-bridge/`） | 87 测试全绿（6 dispatcher + 6 IPC + 19 android extractor + 12 contacts + 12 calllog + 15 sms + 17 wifi） |
| V2 | `npx vitest run` （在 `personal-data-hub/`） | 全套测试全绿（含 6 sidecar 集成 + 1 contacts cross-validate + 21 SystemDataAdapter + 17 disclosure） |
| V3 | 本地 fixture smoke：`node scripts/_make-fixture-all.js ./fx && node scripts/smoke-system-data.js --contacts-db ./fx/contacts2.db --calllog-db ./fx/contacts2.db --sms-db ./fx/mmssms.db --wifi-dir ./fx/wifi --include sms` | 17 entities (7 persons + 8 events + 2 places)，全部通过 `validate()`，wallMs < 100 |
| V4 | Redmi 真机 smoke（无 SMS）：`--serial 24115RA8ECabc123 --extract-mode sdcard` | 真实联系人 + 通话 + WiFi；全 entities 通过 schema 验证；wallMs < 10s |
| V5 | Redmi 真机 smoke（含 SMS）：`--serial XYZ --extract-mode sdcard --include sms` | 上述基础 + SMS Events；`extra.channelType` 包含 `verification`/`service`/`personal` 三类 |
| V6 | 任一 Person 的 `identifiers.phone[0]` 在手机通讯录里可搜到 | 至少抽 3 条 |
| V7 | 任一 incoming call Event 的 `actor` 等于一个真实 contact 的 Person.id | 至少抽 2 条 |
| V8 | `out/<ts>/system-data-batch.json` 中 grep `"password"` 应**0 命中**（验证 WiFi 密码不入库） | `grep -c '"password"' system-data-batch.json` == 0 |
| V9 | 重复跑两次 smoke | 两次 totalPersons / Events / Places 字段一致；(adapter, originalId) 去重 |
| V10 | sidecar `capabilities` 列出全部方法 | 10 methods (sidecar.* 2 + system.* 4 + android.* 4) |
| V11 | `out/<ts>/validation-errors.json` 不存在 | 全 entity 过 UnifiedSchema |
| V12 | `--include sms` 后 `out/<ts>/system-data-batch.json` 内 `extra.channelType` 字段存在且分类合理 | 抽 3 条 SMS 验证 |

---

## 5. 已知限制

| 项 | 状态 | Defer 到 |
|---|---|---|
| `adb backup` 基础 | ✅ 已做 (`android.adb_backup` method) | — |
| .ab 文件解压 | 未做（capture only） | 4.5 后续 sub-phase |
| `apk_downgrade` 提取 | 未做 | sjqz extractor 完整 fork |
| `system.parse_calllog` / `parse_sms` / `parse_wifi` | ✅ 已做 | — |
| `system.parse_contacts` cross-validate | ✅ 已做 (1 test) | — |
| iOS 通讯录 | 未做 | 4.5 iOS sub-phase（待 `pymobiledevice3` 接入） |
| 隐私 UI 弹窗（Vue 实现） | 未做（data layer ✅ 完整：`buildDisclosurePayload` + `sanitizeInclude` 等） | desktop-app-vue 集成 sub-phase |
| LocalVault 持久化（目前 smoke 只写 JSON） | 未做 | AdapterRegistry.syncAdapter() 接入（hub wiring sub-phase） |
| 增量 watermark | N/A | system data 设计就是全量同步 + (adapter, originalId) 去重 |

---

## 6. 故障排查

| 症状 | 原因 | 修法 |
|---|---|---|
| `ADB_NOT_INSTALLED` | adb 不在 PATH | `winget install -e --id Google.PlatformTools` 或下载 platform-tools |
| `DEVICE_NOT_FOUND` (retryable) | USB 没插好 / 未授权 / 设备休眠 | `adb devices` 看状态；解锁屏幕；重新授权 |
| `EXTRACT_PERMISSION_DENIED` 直 pull `/data/data/...` | 无 root / `adb root` 被拒 | 改走 §2.2 sdcard workaround |
| Python sidecar 不启动 (`SIDECAR_NOT_RUNNING`) | python 不在 PATH 或 venv 没激活 | 设 `FORENSICS_BRIDGE_PYTHON` 指向具体解释器 |
| validatePerson 失败 | sidecar / hub schema 漂移 | 报 bug，附 `validation-errors.json` |
| 中文名乱码 | Windows 控制台 cp936 | sidecar 已强制 UTF-8（`PYTHONIOENCODING=utf-8`），如仍乱码 `chcp 65001` |
| 速度 > 30s/百条 | DB 文件 I/O 慢（移动盘 / 网盘） | 拷到本地 SSD 再跑 |

---

## 7. 下一步触发

Phase 4.5.1 → 4.5.6 已全部落地 ✅。剩余非 Phase 4.5 必选项（按需触发）：

- **真机 V4-V12 跑通**（你的当前目标）— 在 Redmi 24115RA8EC 上做一次全 4 source smoke，对照 §4 验收表打勾
- **Vue UI 集成**（Phase 4.5 后续 sub-phase / 独立 milestone）— `buildDisclosurePayload()` 已 ready，desktop-app-vue 写 Vue 组件渲染 disclosure dialog + IPC 调 `adapter.sync()`；data layer 完整不缺
- **AdapterRegistry 接入** — 把 SystemDataAdapter 注册到 hub `AdapterRegistry`，让 `vault.putBatch` 真持久化 entities；目前 smoke 只 JSON dump
- **iOS 通讯录** — `pymobiledevice3` 接入；不在 4.5 关键路径
- **.ab 解压** — `android.adb_backup` 已捕获文件，要 unzlib + untar 才能进 parsers；目前用户可手动 unpack 或 defer 到下个 sub-phase

---

## 8. 参考

**Sidecar (Python)**
- `packages/personal-data-hub-bridge/forensics_bridge/ipc_server.py` — IPC entry
- `packages/personal-data-hub-bridge/forensics_bridge/dispatcher.py` — method registry + capabilities
- `packages/personal-data-hub-bridge/forensics_bridge/parsers/system.py` — Contacts / CallLog / SMS / WiFi parsers
- `packages/personal-data-hub-bridge/forensics_bridge/extractors/android.py` — list_devices / pull_file / adb_shell / adb_backup

**Hub (Node)**
- `packages/personal-data-hub/lib/sidecar/supervisor.js` — SidecarSupervisor
- `packages/personal-data-hub/lib/adapters/_python-sidecar-base.js` — `PythonSidecarAdapter` 基类
- `packages/personal-data-hub/lib/adapters/system-data/system-data-adapter.js` — SystemDataAdapter
- `packages/personal-data-hub/lib/adapters/system-data/disclosure.js` — UI metadata + sanitizeInclude / resolveRetentionMs / buildDisclosurePayload

**Scripts**
- `packages/personal-data-hub/scripts/smoke-system-data.js` — 全 4 source smoke 入口
- `packages/personal-data-hub/scripts/smoke-system-data-contacts.js` — 单 contacts 切片（Phase 4.5.2 原始）
- `packages/personal-data-hub/scripts/_make-fixture-all.js` — 生成 4 source 测试 fixture

**Tests**
- `packages/personal-data-hub-bridge/tests/test_parsers_system_*.py` — 56 parser 单测
- `packages/personal-data-hub-bridge/tests/test_extractor_android.py` — 19 extractor 单测
- `packages/personal-data-hub/__tests__/adapters/system-data-adapter.test.js` — 21 adapter 单测
- `packages/personal-data-hub/__tests__/adapters/system-data-disclosure.test.js` — 17 disclosure 单测
- `packages/personal-data-hub/__tests__/sidecar-contacts-cross-validate.test.js` — sidecar ↔ hub schema 漂移哨兵

**Design docs**
- 上游 [sjqz `parsers/system.py`](file://C:/code/sjqz/src/mobile_forensics/parsers/system.py) — fork 源
- [`Adapter_System_Data.md`](./Adapter_System_Data.md) — 数据模型 + 隐私 SOP
- [`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md) — IPC 协议

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Phase 4.5 真机测试复现器（全 4 source）：系统数据真机复现。

### 2. 核心特性
真机复现器 / 4 source / 测试。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「真机测试复现器（Phase 4.5）」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
