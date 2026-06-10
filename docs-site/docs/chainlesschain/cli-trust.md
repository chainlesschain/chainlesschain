# 信任与安全锚（cc trust）

> **版本: Phase 68-71 CLI port + V2 + trustgov 治理覆盖层 | 状态: ✅ 可用（模拟后端） | 74 + 44 单元测试全绿**
>
> `cc trust` 是桌面端「信任安全系统」（Phase 68-71，设计文档 `docs/design/modules/39_信任安全系统.md`）的 CLI 移植面：**信任根证明**（TPM/TEE/SE 锚点，Phase 68）、**PQC 互操作测试记录**（Phase 69）、**卫星消息队列**（Phase 70）、**HSM 设备注册表**（Phase 71），外加 V2 设备/传输状态机与 trustgov 治理覆盖层。注意：CLI 端为**模拟实现** —— 不含真实 TPM/TEE/SE 硬件、真实 PQC 密钥交换、真实卫星收发器和 USB HSM 驱动（这些在桌面端）。

## 概述

`cc trust` 把四类信任安全对象做成可脚本化的 CRUD + 状态机：

1. **信任根证明（attestation）**：对 `tpm` / `tee` / `secure_element` 三种锚点执行 challenge-response 证明（模拟：response = sha256(challenge+anchor) 截断，状态恒为 `valid`），可附设备指纹。
2. **PQC 互操作测试**：记录某算法与 peer 的兼容性测试结果。支持算法白名单：`ml-kem-768` / `ml-kem-1024` / `ml-dsa-65` / `ml-dsa-87` / `slh-dsa-128s` / `slh-dsa-128f`（其余记为 `unsupported`）。
3. **卫星消息**：`iridium` / `starlink` / `beidou` 三家供应商，优先级 1-10，状态机 `queued → sent → confirmed`（`failed` 可重试回 `queued`）。
4. **HSM 设备**：`yubikey` / `ledger` / `trezor` / `generic` 四类厂商，合规级别 `fips_140_2` / `fips_140_3` / `cc_eal4`，支持模拟签名（默认算法 `ecdsa-p256`）。

V1 表面带 SQLite 持久化（运行时注入共享 DB 时）；**V2 表面与 trustgov 覆盖层为纯进程内状态机**（注册/转移/配额/自动翻转），不落库。

## 核心特性

- 🔐 **三锚点证明**：TPM / TEE / Secure Element，挑战可自定义（`-c`），缺省随机 32 字节
- 🧪 **PQC 互操作记录**：兼容性 PASS/FAIL + 时延，按算法过滤检索
- 🛰️ **卫星消息队列**：供应商/优先级/状态过滤，状态转移白名单校验（非法转移拒绝）
- 🔑 **HSM 注册表 + 模拟签名**：注册/移除/查询/签名，签名自动刷新 `last_seen`
- 🧮 **V2 设备成熟度状态机**：`provisional → active ⇄ degraded → retired`（retired 终态），按 operator 限活跃设备数
- 📡 **V2 传输生命周期**：`queued → sending → confirmed|failed|canceled`，按 device 限未完结传输数
- 🤖 **自动翻转批处理**：闲置设备批量 `retired`（`auto-retire-idle-devices`）、卡死 SENDING 传输批量 `failed`（`auto-fail-stuck-transmissions`）
- 🏛️ **trustgov 治理覆盖层（iter18）**：profile（`pending→active⇄suspended→archived`）+ check（`queued→verifying→verified|failed|cancelled`）双状态机，含配额与 auto-suspend/auto-fail
- 📊 **三层统计**：`stats`（V1 四类对象汇总）、`stats-v2`、`trustgov-gov-stats-v2`

## 命令参考

```bash
# 目录/枚举
cc trust anchors | hsm-vendors | compliance-levels | sat-providers [--json]
cc trust hsm-maturities-v2 | transmissions-v2 | trustgov-enums-v2

# Phase 68 — 信任根证明
cc trust attest <tpm|tee|secure_element> [-c <hex>] [-f <fingerprint>] [--json]
cc trust attest-show <id> [--json]
cc trust attestations [-a <anchor>] [-s <status>] [--limit <n>] [--json]

# Phase 69 — PQC 互操作
cc trust interop-test <algorithm> [-p <peer>] [-l <latencyMs>] [--json]
cc trust interop-tests [-a <algo>] [--limit <n>] [--json]

# Phase 70 — 卫星消息
cc trust sat-send <payload> [-p <provider>] [-r <1-10>] [--json]
cc trust sat-status <id> <queued|sent|confirmed|failed>
cc trust sat-show <id>  |  cc trust sat-messages [-p ...] [-s ...] [--limit <n>]

# Phase 71 — HSM
cc trust hsm-register <vendor> [-m <model>] [-s <serial>] [-c <compliance>] [-f <firmware>]
cc trust hsm-remove <id> | hsm-show <id> | hsm-devices [-v <vendor>] [--limit <n>]
cc trust hsm-sign <device-id> -d <data> [-a <algorithm>]

cc trust stats [--json]

# V2 — 设备/传输状态机（进程内）
cc trust register-device-v2 <id> -o <operator> -v <vendor> [-i <initial>] [--metadata <json>]
cc trust device-v2 <id> | list-devices-v2 [-o ...] [-s ...]
cc trust set-device-maturity-v2 <id> <status> [-r <reason>] [--metadata <json>]
cc trust activate-device|degrade-device|retire-device <id> [-r <reason>]
cc trust touch-device-usage <id>
cc trust enqueue-transmission-v2 <id> -d <device> -p <provider> -x <payload>
cc trust transmission-v2 <id> | list-transmissions-v2 [-d ...] [-s ...]
cc trust set-transmission-status-v2 <id> <status> [-r <reason>]
cc trust start-transmission|confirm-transmission|fail-transmission|cancel-transmission <id>
cc trust auto-retire-idle-devices | auto-fail-stuck-transmissions | stats-v2

# V2 配额读写
cc trust max-active-devices-per-operator         # get（set- 前缀写）
cc trust max-pending-transmissions-per-device
cc trust device-idle-ms | transmission-stuck-ms
cc trust active-device-count [-o <operator>] | pending-transmission-count [-d <device>]

# trustgov 治理覆盖层（iter18）
cc trust trustgov-register-v2 <id> <owner> [--level <v>]
cc trust trustgov-activate-v2|suspend-v2|archive-v2|touch-v2|get-v2 <id>  |  trustgov-list-v2
cc trust trustgov-create-check-v2 <id> <profileId> [--subject <v>]
cc trust trustgov-verifying-check-v2|complete-check-v2|fail-check-v2|cancel-check-v2 <id>
cc trust trustgov-config-v2 | trustgov-set-max-active-v2 <n> | trustgov-set-max-pending-v2 <n>
cc trust trustgov-set-idle-ms-v2 <n> | trustgov-set-stuck-ms-v2 <n>
cc trust trustgov-auto-suspend-idle-v2 | trustgov-auto-fail-stuck-v2 | trustgov-gov-stats-v2
```

## 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│ cc trust <subcommand>      (commands/trust.js)                     │
│   preAction hook: 有 root._db 时 ensureTrustSecurityTables(db)      │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                ┌──────────────▼──────────────────┐
                │ src/lib/trust-security.js        │
                ├──────────────────────────────────┤
                │ V1 (Phase 68-71)                 │   SQLite 表（注入 db 时）:
                │  attest / interop / satellite /  │──► trust_attestations
                │  hsm  →  内存 Map + db 双写       │    pqc_interop_tests
                │                                  │    satellite_messages
                │ V2 (设备/传输状态机)              │    hsm_devices
                │  _devicesV2/_transmissionsV2 Map │
                │  转移白名单 + operator/device 配额│   （V2 / trustgov: 纯进程内
                │                                  │     Map，不落库）
                │ trustgov 覆盖层 (iter18)          │
                │  profile + check 双状态机         │
                └──────────────────────────────────┘
```

### 状态机（来自代码转移表）

```
卫星消息(V1):  queued → sent|failed;  sent → confirmed|failed;  failed → queued(重试)
设备 V2:       provisional → active|retired;  active → degraded|retired;
               degraded → active|retired;  retired=终态
传输 V2:       queued → sending|canceled|failed;  sending → confirmed|failed|canceled
trustgov 档案: pending → active|archived;  active → suspended|archived;
               suspended → active|archived;  archived=终态
trustgov 检查: queued → verifying|cancelled;  verifying → verified|failed|cancelled
```

## 配置参考

均为代码内默认值，经对应 `set-*` 子命令在**当前进程内**修改（无配置文件/环境变量）：

| 配置项 | 默认值 | 读/写命令 |
|--------|--------|-----------|
| `TS_DEFAULT_MAX_ACTIVE_DEVICES_PER_OPERATOR` | `8` | `max-active-devices-per-operator` / `set-...` |
| `TS_DEFAULT_MAX_PENDING_TRANSMISSIONS_PER_DEVICE` | `20` | `max-pending-transmissions-per-device` / `set-...` |
| `TS_DEFAULT_DEVICE_IDLE_MS` | `2592000000`（30 天） | `device-idle-ms` / `set-device-idle-ms` |
| `TS_DEFAULT_TRANSMISSION_STUCK_MS` | `120000`（2 分钟） | `transmission-stuck-ms` / `set-...` |
| trustgov maxActive / maxPending | `8` / `20` | `trustgov-config-v2` / `trustgov-set-max-*-v2` |
| trustgov idleMs / stuckMs | 30 天 / `60000`（60 秒） | `trustgov-set-idle-ms-v2` / `trustgov-set-stuck-ms-v2` |
| 卫星 provider 默认 | `iridium` | `sat-send -p` |
| 卫星 priority | 默认 `5`，钳制到 `[1,10]` | `sat-send -r` |
| HSM 签名算法默认 | `ecdsa-p256` | `hsm-sign -a` |
| 各 list 命令 `--limit` | `50` | — |
| V1 持久化 DB | 运行时注入的共享 SQLite（`root._db`） | — |

## 性能指标

无独立基准（基准数据待补）；代码内的运行边界：

- **传输卡死阈值**：SENDING 超过 2 分钟（默认）可被 `auto-fail-stuck-transmissions` 批量翻 `failed`
- **设备闲置阈值**：`lastUsedAt` 超 30 天（默认）可被 `auto-retire-idle-devices` 批量翻 `retired`；`touch-device-usage` 续命
- **trustgov 检查卡死阈值**：VERIFYING 超 60 秒（默认）
- **配额**：每 operator 最多 8 个活跃（active+degraded）设备；每 device 最多 20 条未完结传输 —— 超限注册/入队直接抛错
- **互操作时延**：未指定 `-l` 时模拟为 5-55ms 随机值
- **查询**：所有 list 走内存 Map 全扫 + 排序 + limit（默认 50），数据量与进程内对象数线性相关

## 测试覆盖

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| `packages/cli/__tests__/unit/trust-security.test.js` | 74 | V1 四子系统（attest/interop/satellite/hsm/stats）+ V2 设备注册/转移/过滤/传输/auto-flip/stats |
| `packages/cli/__tests__/unit/lib/trust-security-v2.test.js` | 44 | trustgov 覆盖层：枚举/配置/档案生命周期/活跃配额/检查生命周期/auto-flip/治理统计 |

```bash
cd packages/cli
npx vitest run __tests__/unit/trust-security.test.js __tests__/unit/lib/trust-security-v2.test.js
```

> 另：`__tests__/integration/mtc-federation-governance-trust-cli.test.js`（15 用例）覆盖的是 `cc mtc federation` 的跨联邦信任锚，**不是** `cc trust` —— 同名易混。

## 安全考虑

- **枚举白名单 fail-closed**：非法锚点/供应商/厂商直接拒绝（`invalid_anchor` / `invalid_provider` / `invalid_vendor`），不写任何数据
- **状态转移白名单**：卫星 V1 与全部 V2 状态机都查转移表，非法转移返回 `invalid_transition` 或抛 `illegal transition A → B`；终态（`retired` / `archived` / `confirmed|failed|canceled` 等）不可再转移
- **配额上限**：operator 活跃设备、device 未完结传输、trustgov owner 活跃档案 / profile 未完结检查均有硬上限，超限即抛错（防资源/队列被单一主体打爆）
- **配置项正整数校验**：所有 `set-*` 经 `_positiveIntV2` 检查，非正整数抛错
- **⚠️ 模拟边界**：`attest` 的状态恒为 `valid`、`hsm-sign` 是 sha256 模拟签名 —— **不可作为真实安全证明使用**；真实 TPM/TEE/SE 与 HSM 驱动在桌面端

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `Failed: invalid_anchor` | 锚点不在 `tpm/tee/secure_element` | `cc trust anchors` 查合法值 |
| `Compatible: NO (unsupported)` | 算法不在 PQC 白名单（大小写不敏感比对） | 用 `ml-kem-768/1024`、`ml-dsa-65/87`、`slh-dsa-128s/128f` |
| `Failed: invalid_transition`（sat-status） | 状态转移不在白名单（如 `confirmed` 后再改） | 按 `queued→sent→confirmed`、`failed→queued` 顺序推进 |
| `operator <x> active device cap reached` | 该 operator 活跃设备已达上限（默认 8） | 先 `retire-device` 释放，或 `set-max-active-devices-per-operator` 调大 |
| `illegal transition provisional → degraded` 等 | V2 转移表不允许 | 先 `activate-device` 再 `degrade-device` |
| `device <id> is terminal (retired)` | 终态设备不可再转移 | 用新 id 重新 `register-device-v2` |
| 重启后 V2 设备/传输/trustgov 数据消失 | V2 与 trustgov 是**纯进程内**状态，不落 SQLite | 预期行为；持久对象用 V1 表面（hsm-register / sat-send 等） |
| V1 数据也不持久 / 列表为空 | 当前调用环境未注入共享 DB（`root._db`），preAction 跳过建表 | 在已初始化 DB 的运行时（REPL/桌面联动）中使用；纯 headless 下 V1 持久化依赖该注入 |
| `invalid JSON: ...` | `--metadata` 不是合法 JSON | 注意 shell 引号转义，传紧凑 JSON |
| 把模拟证明当真实硬件证明 | CLI port 不含真实硬件路径 | 见「安全考虑」模拟边界说明 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/trust.js` | `cc trust` 全部子命令（含 `registerTrustgovV2Commands` 覆盖层注册） |
| `packages/cli/src/lib/trust-security.js` | V1 四子系统 + V2 状态机 + trustgov 覆盖层全部实现（1206 行） |
| `packages/cli/__tests__/unit/trust-security.test.js` | 74 单元测试（MockDatabase） |
| `packages/cli/__tests__/unit/lib/trust-security-v2.test.js` | 44 单元测试（trustgov） |
| `docs/design/modules/39_信任安全系统.md` | 桌面端设计文档（Phase 68-71 全量设计） |

## 使用示例

```bash
# 1) 执行一次 TEE 证明并查看
cc trust attest tee -f "device-fp-001"
cc trust attestations --json

# 2) PQC 互操作测试
cc trust interop-test ml-kem-768 -p peer-A -l 12
cc trust interop-tests -a ml-kem-768

# 3) 卫星消息全生命周期
cc trust sat-send "SOS coordinates ..." -p beidou -r 9
cc trust sat-status <id> sent
cc trust sat-status <id> confirmed
cc trust sat-messages -s confirmed

# 4) HSM 注册 + 模拟签名
cc trust hsm-register yubikey -m "YubiKey 5C" -c fips_140_2
cc trust hsm-sign <device-id> -d "hello"

# 5) V2 设备 + 传输状态机
cc trust register-device-v2 dev-1 -o op-A -v ledger
cc trust activate-device dev-1
cc trust enqueue-transmission-v2 tx-1 -d dev-1 -p iridium -x "payload"
cc trust start-transmission tx-1 && cc trust confirm-transmission tx-1
cc trust stats-v2

# 6) 运维批处理：清闲置设备 / 卡死传输
cc trust auto-retire-idle-devices
cc trust auto-fail-stuck-transmissions

# 7) trustgov 治理档案 + 检查
cc trust trustgov-register-v2 prof-1 owner-A --level high
cc trust trustgov-activate-v2 prof-1
cc trust trustgov-create-check-v2 chk-1 prof-1 --subject did:cc:bob
cc trust trustgov-verifying-check-v2 chk-1 && cc trust trustgov-complete-check-v2 chk-1
cc trust trustgov-gov-stats-v2
```

## 相关文档

- [信任根系统](./trust-root.md)
- [卫星通信](./satellite-comm.md)
- [PQC 生态](./pqc-ecosystem.md)
- [PQC 迁移](./pqc-migration.md)
- [CLI PQC（cc pqc）](./cli-pqc.md)
- [SIMKey 硬件密钥](./simkey.md)
- [U-Key 硬件安全](./ukey.md)
