# Signal Protocol 依赖评估与迁移决策备忘

> 日期：2026-04-22
> 对应审计：`AUDIT_2026-04-22.md` §5 高风险依赖
> 状态：**需用户决策**，未实施

---

## 现状

**当前依赖**：`@privacyresearch/libsignal-protocol-typescript@^0.0.16`

- npm registry `time.created`: 2020-07-06
- npm registry `time.modified`: 2025-06-18（仅元数据更新，版本号仍为 0.0.16，未发布新版本）
- 项目地址：`https://github.com/privacyresearchgroup/libsignal-protocol-typescript`
- 唯一调用点：`desktop-app-vue/src/main/p2p/signal-session-manager.js:96`（动态 import）
- 核心职责：端到端加密消息通信（X3DH + Double Ratchet），~628 行

**为何被审计标红**：
1. 版本号 `0.0.16` 表明库作者认为其尚未达到 1.0 稳定质量
2. 连续 5 年零大版本更新（0.0.16 是 2020 年就有的版本号）
3. 第三方 fork，并非 Signal 官方产物
4. 加密协议库停更 = 无人跟进协议漏洞披露（CVE）与密码学最佳实践升级

---

## 替代选项对比

| 选项 | npm 包 | 最新版本 | 最近更新 | 维护方 | 语言栈 | 难度 |
|---|---|---|---|---|---|---|
| **A. 保持现状** | `@privacyresearch/libsignal-protocol-typescript` | 0.0.16 | 2020（代码） | 社区 fork | 纯 TS | 零 |
| **B. 迁移到官方** | `@signalapp/libsignal-client` | 0.92.2 | 2026-04-16（6 天前） | **Signal 官方** | Rust + NAPI 原生绑定 | 高 |
| **C. 保留 + 审计** | 同 A | — | — | — | — | 低 |

### 选项 A：保持现状
- **代价**：0
- **风险**：出现协议层 CVE 时无补丁；审计会反复标红；新人接手会质疑技术选型

### 选项 B：迁移到 `@signalapp/libsignal-client`
- **代价**：
  - API 面完全不同（Rust 原生绑定 vs 纯 TS 类）；`signal-session-manager.js` 的 `KeyHelper / SessionBuilder / SessionCipher / SignalProtocolAddress` 4 类需全部重写
  - 打包复杂度 +1：原生模块需要为 Windows / macOS x64 / macOS arm64 / Linux 分别提供 prebuilt，或者在安装时本地编译
  - **会话格式不兼容** → 升级后老的加密会话全部失效，用户需重新握手。必须有迁移策略（二选一）：
    - 双跑：老会话用老库解密、新会话用新库加密。直到所有用户都产生了新会话再下掉老库（周期可能 30–90 天）
    - 硬切：版本 bump 时清空所有历史 Session DB，所有用户强制重新建立 E2E 通道
  - 测试：端到端测试需要跨设备对齐（Android 端 Signal 协议也要同步升级）
- **收益**：
  - 与 Signal 官方同步维护，CVE 能第一时间跟进
  - 官方 C++/Rust 实现性能优于纯 TS 实现
  - 审计通过，长期维护可行
- **时间估算**：主进程迁移 3–5 人日；Android 侧对齐 + 跨端联调 2–3 人日；回归测试 1 周

### 选项 C：保留 + 主动审计
- **代价**：0.5 人日，锁定当前版本到一个已知 commit，做一次内部 code review（密钥生成/存储/加密路径），记录所有已识别的风险点
- **风险**：技术债仍在，下次审计仍会标红；但至少团队对库的实际代码质量有判断，不是盲目依赖
- **收益**：让审计标红变成"已知风险、已评估"而不是"未评估"

---

## 建议

**短期（本季度）**：选项 C —— 先做一次代码 review 并把风险评估落在文档里。把选项 B 列入下季度路线。

**中期（下一版本迭代窗口）**：启动选项 B 的 POC —— 先在 `signal-session-manager.js` 的等价实现上写 feature flag，两套会话管理器共存，`config.signal.driver = 'legacy' | 'official'`，灰度切换。

**不建议**：立刻直接替换（选项 B 硬切）。会破坏所有现有用户的端到端加密历史会话，且 Android 端需要同步升级。

---

## 附：迁移 POC 起点（若采用选项 B）

```js
// src/main/p2p/signal-session-manager.js — driver 路由
async loadSignalLibrary() {
  const driver = this.config.driver || 'legacy';
  if (driver === 'official') {
    const signal = require('@signalapp/libsignal-client');
    // TODO: 适配 PublicKey / PrivateKey / PreKeyBundle / SessionRecord 等类
    // 对应到老代码的 KeyHelper / SessionBuilder / SessionCipher / SignalProtocolAddress
    ...
  } else {
    const signal = await import('@privacyresearch/libsignal-protocol-typescript');
    ...
  }
}
```

配合：
- `config.signal.driver` 默认 `legacy`
- 新建会话时如果 driver=official 则写入 `sessions.driver = 'official'` 标记
- 读取会话时按标记路由到对应 cipher
- 每台设备记录一次迁移完成后清理 legacy 驱动

---

*需用户确认选项后实施。本文档仅作风险披露，不包含代码改动。*
