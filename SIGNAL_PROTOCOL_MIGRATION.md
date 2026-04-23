# Signal Protocol 依赖评估与迁移决策备忘

> 日期：2026-04-22
> 对应审计：[AUDIT_2026-04-22.md](./AUDIT_2026-04-22.md)
> 范围：Desktop 主实现、移动端对齐、迁移可行性、许可与发布风险
> 结论状态：已完成评估，待确认执行范围

---

## 一页结论

**推荐决策：本迭代不做 Signal 依赖硬切换。**

当前最合理的路径不是“继续无视风险”，也不是“马上把桌面端切到官方库”，而是：

1. 先把桌面端现有实现修到真实集成可用，并把它作为后续迁移基线。
2. 同时抽象出 `signal driver` 接口，为后续双栈迁移做准备。
3. 在 legal/build/跨端协议三项门槛过关后，再决定是否切到官方 `@signalapp/libsignal-client`。

**不建议本版本直接硬切官方库**，原因有四个：

- 虽然桌面端基线问题已修复，但仍不具备“可直接替换官方库”的充分条件。
- 桌面、uni-app、Android、iOS 当前并不是同一套实现，迁移会扩大跨端兼容面。
- 官方 JS 包是原生绑定路线，Electron 打包、预编译和安装链路复杂度明显上升。
- 官方 JS 包在 npm 标注为 `AGPL-3.0-only`，需要单独 legal review，不能作为纯技术替换处理。

---

## 现状快照

### 1. 桌面端实际依赖

- 桌面端仍直接依赖 `@privacyresearch/libsignal-protocol-typescript@^0.0.16`
- 证据：`desktop-app-vue/package.json` 第 169 行
- 唯一主调用入口：`desktop-app-vue/src/main/p2p/signal-session-manager.js`
- 动态加载位置：`loadSignalLibrary()`，第 93 行

### 2. 跨端并未共用同一实现

- Desktop：第三方 TS fork + 本地包装器
- uni-app：`tweetnacl + crypto-js` 自实现，非 libsignal 兼容实现
- Android：自实现 `X3DHKeyExchange` 与 `DoubleRatchet`
- iOS：`Package.swift` 已声明 `LibSignalClient` 依赖，但社交服务当前实现仍是 `CryptoKit` 自实现

这意味着“迁移依赖”本质上只覆盖桌面端；如果要做到协议一致，还需要后续单独收敛移动端实现。

---

## 已验证事实

### 1. 包装层单测通过

2026-04-22 执行：

```bash
npm.cmd run test:signal:unit
```

结果：

- `2` 个测试文件通过
- `68` 个测试通过
- 结论：桌面端包装层和 mock 契约目前可用

### 2. 初始评估时，真实桌面集成脚本失败

2026-04-22 执行：

```bash
node scripts/test-signal-encryption.js
```

结果：

- `32` 项检查中 `24` 通过、`8` 失败
- 首条消息未产出预期的 `PreKeyWhisperMessage`
- 多个解密路径报错：`No record for device alice.1`

这说明初始风险不只是“依赖老旧”，还包括**真实集成路径存在正确性问题**。在这个前提下，直接做库迁移会把“旧实现不稳”和“新实现替换风险”叠加到一起。

### 3. Phase 0 修复后，真实桌面集成脚本已通过

针对桌面端消息类型语义与解密分支映射错误修复后，于 2026-04-22 再次执行：

```bash
node scripts/test-signal-encryption.js
```

结果：

- `32` 项检查全部通过
- 首条消息正确产出 `PreKeyWhisperMessage`
- 接收方可自动建立会话并完成后续双向收发

这意味着当前桌面端已经具备一个**可复现、可验证的迁移基线**。因此后续推荐路线从“先排障”收敛为“保留现有实现作为稳定基线，再做 driver 抽象和官方库 POC”。

### 4. 风险已从“当前实现风险”回落为“维护与迁移风险”

旧 memo 把问题主要描述为：

- 第三方 fork
- 长期低活跃
- 安全审计红线

更新后的判断应当是：

- 初始故障已修复，桌面端真实加密/解密流当前可用
- 第三方 fork、长期维护、许可与跨端不一致风险仍然成立
- 因此当前不应硬切，而应以已修复的桌面基线推进后续迁移设计

---

## 风险拆分

### A. 继续维持当前桌面依赖的风险

- 第三方 fork，维护不确定
- 版本长期停留在 `0.0.x`
- 出现上游协议/实现问题时响应不可控
- 当前真实集成基线已恢复可用，但长期维护风险仍在

### B. 迁移到官方 JS 客户端的新增风险

- 原生模块引入 Electron 打包复杂度
- Windows/macOS/Linux 预编译产物和安装链路需要验证
- 当前会话存储格式不可直接假设兼容
- 必须设计 legacy/official 双驱动会话路由
- npm 页面显示官方包为 `AGPL-3.0-only`，需 legal review

### C. 跨端一致性风险

- uni-app 不是 libsignal
- Android 不是 libsignal JS
- iOS 依赖声明和实际实现不一致
- 如果桌面端单独换库，短期只能得到“桌面内部收敛”，拿不到“全端统一协议栈”

---

## 选项评估

| 选项 | 描述 | 优点 | 风险/缺点 | 结论 |
|---|---|---|---|---|
| A | 维持现状，不做代码改动 | 成本最低 | 审计风险持续；长期维护问题仍未解决 | 否决 |
| B | 本版本直接切官方库 | 长期维护面最好 | 原生绑定、许可、会话兼容、跨端联调一次性爆发 | 否决 |
| C | 先修旧实现，再做 driver 抽象与官方 POC | 风险可控，能建立迁移基线 | 需要两阶段投入 | **推荐** |
| D | 先做跨端协议统一，再决定底层库 | 战略上最干净 | 范围过大，不适合当前审计项 | 后续路线，不作为本次决策 |

---

## 推荐决策

### 决策结论

采用 **选项 C：以已修复的桌面实现为基线，抽象驱动后再做官方 POC**。

### 决策理由

1. 桌面端真实集成现已可验证，具备作为迁移基线的条件。
2. 有了稳定基线后，才能区分后续问题来自旧逻辑、新库适配，还是迁移策略本身。
3. 官方库虽然维护面更好，但引入原生绑定与 AGPL 许可，已超出“普通依赖升级”范围。
4. 跨端当前并未统一，桌面端硬切不能一次性解决全端协议债务。

---

## 执行建议

### Phase 0：立即执行，1 个迭代内完成

- 保持 `desktop-app-vue/src/main/p2p/signal-session-manager.js` 当前真实集成路径稳定
- 把 `node scripts/test-signal-encryption.js` 纳入可重复执行的回归门禁
- 在 CI 或发布前检查中新增一条“真实 Signal 集成 smoke test”

目标：

- 首条消息类型符合预期
- 对端能自动建立可解密会话
- 至少当前桌面端单向/双向收发路径稳定

### Phase 1：桌面端驱动抽象

建议将桌面端拆成：

- `signal-driver-legacy.js`
- `signal-driver-official.js`
- `signal-session-manager.js` 只负责路由与存储协调

最小接口建议：

```ts
interface SignalDriver {
  initialize(): Promise<void>;
  getPreKeyBundle(): Promise<PreKeyBundle>;
  processPreKeyBundle(recipientId: string, deviceId: number, bundle: PreKeyBundle): Promise<void>;
  encryptMessage(recipientId: string, deviceId: number, plaintext: string | Uint8Array): Promise<Ciphertext>;
  decryptMessage(senderId: string, deviceId: number, ciphertext: Ciphertext): Promise<string>;
  hasSession(recipientId: string, deviceId: number): Promise<boolean>;
  deleteSession(recipientId: string, deviceId: number): Promise<void>;
}
```

### Phase 2：官方库 POC 立项门槛

只有以下条件全部满足，才建议启动桌面端官方库 POC：

1. 现有真实集成测试持续全绿
2. legal 确认 `AGPL-3.0-only` 许可可接受，或给出替代方案
3. Electron 三平台安装/打包链路验证通过
4. 会话迁移方案被明确选定

---

## 会话迁移策略

### 不可接受方案

- 直接硬切并复用旧 session store，假设格式天然兼容

### 可接受方案

#### 方案 1：双栈灰度

- 新配置项：`config.signal.driver = 'legacy' | 'official'`
- session 记录增加 `driver` 字段
- 老会话按 legacy 解密
- 新建会话按官方驱动创建
- 观察一个发布周期后再考虑淘汰 legacy

优点：

- 用户影响最小
- 便于回滚

缺点：

- 一段时间内维护两套实现

#### 方案 2：版本切换硬重握手

- 升级后清空旧 session
- 所有对端重新建立 E2E 会话

优点：

- 实现简单

缺点：

- 用户体验差
- 对多设备和离线场景影响大

**推荐：仅接受方案 1，不接受方案 2。**

---

## 对产品与发布的实际影响

### 如果本迭代执行推荐方案

- 不改变对外协议承诺
- 先降低当前真实故障风险
- 为后续迁移创造可验证落点

### 如果本迭代直接硬切官方库

- 交付风险显著增加
- 桌面端安装/打包链路会成为新增阻塞点
- 需要同步回答许可问题
- 需要额外处理会话兼容和回滚路径

---

## 明确不做的事

本备忘录**不建议**在当前审计闭环内做以下动作：

- 不做桌面端 Signal 依赖硬切换
- 不在没有 legal review 的前提下引入 `AGPL-3.0-only` 包作为正式发布依赖
- 不把桌面端迁移误写成“全端 Signal 协议统一”

---

## 待确认事项

需要用户或项目负责人确认两点：

1. 是否接受“先修旧实现，再做 POC”的两阶段方案
2. 是否允许引入官方库的 legal review 和 Electron 原生模块打包验证工作

若答案为“是”，则后续实施建议按下面顺序推进：

1. 保持桌面端真实集成稳定
2. 抽象 driver 接口
3. 做官方库 POC
4. legal/build 评审通过后，再定正式迁移窗口

---

## 附：证据定位

- 桌面端旧依赖：`desktop-app-vue/package.json:169`
- 桌面端加载旧库：`desktop-app-vue/src/main/p2p/signal-session-manager.js:93`
- 桌面端会话建立：`desktop-app-vue/src/main/p2p/signal-session-manager.js:270`
- 桌面端加解密：`desktop-app-vue/src/main/p2p/signal-session-manager.js:371`、`desktop-app-vue/src/main/p2p/signal-session-manager.js:429`
- uni-app 自实现：`mobile-app-uniapp/src/services/p2p/signal-session-manager.js:23`
- Android 自实现 X3DH：`android-app/core-e2ee/src/main/java/com/chainlesschain/android/core/e2ee/protocol/X3DHKeyExchange.kt:22`
- Android 自实现 Double Ratchet：`android-app/core-e2ee/src/main/java/com/chainlesschain/android/core/e2ee/protocol/DoubleRatchet.kt:22`
- iOS 现实现使用 CryptoKit：`ios-app/ChainlessChain/Features/Social/Services/SignalProtocolManager.swift:2`
- iOS 说明仍是 CryptoKit 路线：`ios-app/ChainlessChain/Features/Social/Services/SignalProtocolManager.swift:7`
- iOS 包声明 `LibSignalClient`：`ios-app/Package.swift:127`
- 真实集成脚本：`desktop-app-vue/scripts/test-signal-encryption.js:2`
- 脚本内首条消息断言：`desktop-app-vue/scripts/test-signal-encryption.js:319`

---

## 附：外部参考

- 官方 JS 包 npm 页面：<https://www.npmjs.com/package/@signalapp/libsignal-client>
- Signal Protocol 文档：<https://signal.org/docs/>

> 说明：官方 JS 包的维护活跃度与许可信息应在正式立项前再次复核；本备忘录只把它视为 POC 候选，不视为已批准正式替换。
---

---

## 2026-04-22 Status Update

- Phase 1 minimum driver abstraction is now implemented on desktop.
- `desktop-app-vue/src/main/p2p/signal-session-manager.js` is reduced to a facade that preserves legacy config defaults, routes by `config.signal.driver`, and lazily loads drivers.
- `desktop-app-vue/src/main/p2p/signal-driver-legacy.js` remains the default production baseline.
- `desktop-app-vue/src/main/p2p/signal-driver-official.js` exists only as a placeholder contract and is not ready for production traffic.
- Runtime config wiring now exists in `P2PManager`: the desktop path can read `p2p.signal.driver` from database-backed P2P settings, with constructor-config fallback and invalid-value fallback to `legacy`.
- Verification after the abstraction change:
  - `npm.cmd run test:signal:unit` => 71/71 passed
  - `node scripts/test-signal-encryption.js` => 32/32 passed

Decision impact:
- The recommendation does not change: do not hard-cut to the official library in this iteration.
- The migration path is now more concrete: keep `legacy` stable, use the facade/driver split as the transition seam, and run any official-library work as an isolated POC behind the new driver boundary.

Updated code evidence:
- Facade routing: `desktop-app-vue/src/main/p2p/signal-session-manager.js:26`
- Facade initialize entry: `desktop-app-vue/src/main/p2p/signal-session-manager.js:101`
- Legacy driver initialize: `desktop-app-vue/src/main/p2p/signal-driver-legacy.js:54`
- Legacy driver decrypt path: `desktop-app-vue/src/main/p2p/signal-driver-legacy.js:432`
- Official driver placeholder: `desktop-app-vue/src/main/p2p/signal-driver-official.js:22`

## 2026-04-23 Status Update

- Phase 2 official-driver POC is now implemented as a diagnostic skeleton instead of a placeholder-only contract.
- `desktop-app-vue/src/main/p2p/signal-driver-official.js` now exposes:
  - `probeSupport()` for package presence, runtime, version, and export-key diagnostics
  - `getDiagnostics()` for post-probe inspection
  - actionable failure paths in `loadSignalLibrary()` / `initialize()`
- A standalone verification script now exists at `desktop-app-vue/scripts/test-signal-official-driver.js`.
- Unit coverage now includes the official-driver probe paths in `desktop-app-vue/tests/unit/p2p/signal-driver-official.test.js`.

Local POC result on 2026-04-23:
- `node scripts/test-signal-official-driver.js` reports `status = missing_dependency`
- The current desktop workspace does not have `@signalapp/libsignal-client` installed
- `recommendedDriver` remains `legacy`

Verification snapshot:
- `npm.cmd run test:signal:unit` => 74/74 passed
- `node scripts/test-signal-encryption.js` => 32/32 passed
- `node scripts/test-signal-official-driver.js` => expected failure, because the package is not installed and the adapter layer is intentionally not implemented for production use

Decision impact:
- The recommendation still does not change: do not hard-cut to the official library in this iteration.
- The migration seam is now verified in code: routing and diagnostics are ready, but production traffic should remain on `legacy` until the official package is installed, packaged, and validated end-to-end.
- The next gate is no longer "can we structure the code for dual drivers"; it is "can the official package be installed and loaded reliably in this Electron desktop runtime".

Updated code evidence:
- Runtime config routing: `desktop-app-vue/src/main/p2p/p2p-manager.js:214`
- Signal manager config builder: `desktop-app-vue/src/main/p2p/p2p-manager.js:231`
- Official driver probe entry: `desktop-app-vue/src/main/p2p/signal-driver-official.js:79`
- Official driver diagnostics accessor: `desktop-app-vue/src/main/p2p/signal-driver-official.js:125`
- Official driver load gate: `desktop-app-vue/src/main/p2p/signal-driver-official.js:137`
- Official driver initialize gate: `desktop-app-vue/src/main/p2p/signal-driver-official.js:151`
- Official driver probe test: `desktop-app-vue/tests/unit/p2p/signal-driver-official.test.js:12`
- Official driver standalone probe script: `desktop-app-vue/scripts/test-signal-official-driver.js:1`
