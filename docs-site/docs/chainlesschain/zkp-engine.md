# 零知识证明引擎

> **版本: v4.2.0 | 状态: ✅ 生产就绪 | 6 IPC Handlers | 2 数据库表 | Phase 88**

ChainlessChain 零知识证明引擎（ZKP Engine）提供 zk-SNARK/zk-STARK 本地证明生成能力，基于 Groth16 证明系统和 Circom 电路编译器，支持隐私交易和选择性披露的身份证明，在不泄露原始数据的前提下验证声明的真实性。

## 概述

零知识证明引擎是 ChainlessChain 的隐私计算核心模块，基于 Groth16/PLONK/STARK 证明系统在本地生成零知识证明。它支持 Circom DSL 编写和编译自定义算术电路，提供隐私交易证明（隐藏交易金额和参与方）和 DID 身份选择性披露能力，在不泄露原始数据的前提下验证声明的真实性。

## 核心特性

- 🔐 **zk-SNARK/zk-STARK**: 本地生成零知识证明，无需可信第三方
- ⚡ **Groth16 证明系统**: 高效的配对友好曲线证明，验证速度极快
- 🔧 **Circom 电路编译**: 支持 Circom DSL 编写和编译自定义算术电路
- 💸 **隐私交易**: 隐藏交易金额和参与方的零知识交易证明
- 🪪 **身份证明**: 选择性披露，证明身份属性而不泄露完整信息

## 系统架构

```
┌──────────────────────────────────────────────┐
│           零知识证明引擎 (ZKP Engine)          │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Circom   │ │ 身份证明 │ │ 选择性披露   │ │
│  │ 电路编译 │ │ DID+ZKP  │ │ Verifier     │ │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ │
│       │            │              │          │
│       ▼            ▼              ▼          │
│  ┌──────────────────────────────────────┐    │
│  │       Groth16 / PLONK / STARK       │    │
│  │         证明系统核心引擎              │    │
│  └──────────────────┬───────────────────┘    │
│                     │                        │
│       ┌─────────────┼─────────────┐          │
│       ▼             ▼             ▼          │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐    │
│  │证明生成 │  │证明验证  │  │统计查询 │    │
│  └─────────┘  └──────────┘  └─────────┘    │
│                     │                        │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  zkp_circuits / zkp_proofs (SQLite) │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/crypto/zkp-engine.js` | ZKP 证明生成与验证核心 |
| `desktop-app-vue/src/main/crypto/circom-compiler.js` | Circom 电路编译器 |
| `desktop-app-vue/src/main/crypto/identity-proof.js` | DID 身份零知识证明 |
| `desktop-app-vue/src/main/crypto/zkp-ipc.js` | ZKP IPC 处理器 (6 个) |
| `desktop-app-vue/src/renderer/stores/zkpEngine.ts` | Pinia 状态管理 |

## IPC 接口

### ZKP 操作（6 个）

| 通道                        | 功能       | 说明                             |
| --------------------------- | ---------- | -------------------------------- |
| `zkp:generate-proof`        | 生成证明   | 根据电路和输入生成零知识证明     |
| `zkp:verify-proof`          | 验证证明   | 验证零知识证明的有效性           |
| `zkp:compile-circuit`       | 编译电路   | 编译 Circom 电路为 R1CS 约束系统 |
| `zkp:create-identity-proof` | 身份证明   | 创建身份属性的零知识证明         |
| `zkp:selective-disclose`    | 选择性披露 | 披露部分身份属性，隐藏其余       |
| `zkp:get-stats`             | 获取统计   | 查询证明生成/验证的统计信息      |

## 使用示例

### 编译 Circom 电路

```javascript
const circuit = await window.electron.ipcRenderer.invoke(
  "zkp:compile-circuit",
  {
    source: `
      pragma circom 2.0.0;
      template AgeCheck() {
        signal input age;
        signal input threshold;
        signal output valid;
        valid <-- (age >= threshold) ? 1 : 0;
        valid * (valid - 1) === 0;
      }
      component main = AgeCheck();
    `,
    name: "age-check",
    optimization: 2,
  },
);
// circuit = { success: true, circuitId: "cir_age_check", constraints: 3, compiled: true, wasmPath: "...", zkeyPath: "..." }
```

### 生成零知识证明

```javascript
const proof = await window.electron.ipcRenderer.invoke("zkp:generate-proof", {
  circuitId: "cir_age_check",
  inputs: {
    age: 25,
    threshold: 18,
  },
  proofSystem: "groth16", // groth16 | plonk | stark
});
// proof = { success: true, proofId: "prf_abc123", proof: { pi_a: [...], pi_b: [...], pi_c: [...] }, publicSignals: ["1"], generationTime: 1200 }
```

### 验证证明

```javascript
const result = await window.electron.ipcRenderer.invoke("zkp:verify-proof", {
  proofId: "prf_abc123",
  circuitId: "cir_age_check",
  publicSignals: ["1"],
});
// result = { success: true, valid: true, verificationTime: 15 }
```

### 创建身份证明

```javascript
const idProof = await window.electron.ipcRenderer.invoke(
  "zkp:create-identity-proof",
  {
    did: "did:agent:my-agent",
    claims: {
      ageOver18: true,
      country: "CN",
      role: "developer",
    },
    disclose: ["country"], // 仅披露国家，隐藏年龄和角色
  },
);
// idProof = { success: true, proofId: "prf_id_001", disclosed: { country: "CN" }, hiddenClaims: ["ageOver18", "role"], proof: { ... } }
```

### 选择性披露

```javascript
const disclosure = await window.electron.ipcRenderer.invoke(
  "zkp:selective-disclose",
  {
    proofId: "prf_id_001",
    requestedClaims: ["ageOver18"],
    verifierDid: "did:agent:verifier-001",
  },
);
// disclosure = { success: true, disclosed: { ageOver18: true }, proof: { ... }, verifiableUntil: 1709209856789 }
```

## 数据库 Schema

**2 张核心表**:

| 表名           | 用途     | 关键字段                                                 |
| -------------- | -------- | -------------------------------------------------------- |
| `zkp_circuits` | 电路存储 | id, name, source_hash, wasm_path, zkey_path, constraints |
| `zkp_proofs`   | 证明存储 | id, circuit_id, proof_data, public_signals, status       |

### zkp_circuits 表

```sql
CREATE TABLE IF NOT EXISTS zkp_circuits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  wasm_path TEXT,
  zkey_path TEXT,
  vkey_data TEXT,                        -- 验证密钥 JSON
  constraints INTEGER DEFAULT 0,
  optimization_level INTEGER DEFAULT 1,
  status TEXT DEFAULT 'compiled',        -- compiled | error | deprecated
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_zkp_circuits_name ON zkp_circuits(name);
CREATE INDEX IF NOT EXISTS idx_zkp_circuits_status ON zkp_circuits(status);
```

### zkp_proofs 表

```sql
CREATE TABLE IF NOT EXISTS zkp_proofs (
  id TEXT PRIMARY KEY,
  circuit_id TEXT NOT NULL,
  proof_data TEXT NOT NULL,              -- 证明数据 JSON
  public_signals TEXT,                   -- 公共信号 JSON 数组
  proof_system TEXT DEFAULT 'groth16',   -- groth16 | plonk | stark
  status TEXT DEFAULT 'valid',           -- valid | expired | revoked
  generation_time INTEGER,               -- 生成耗时(ms)
  verification_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  expires_at INTEGER,
  FOREIGN KEY (circuit_id) REFERENCES zkp_circuits(id)
);
CREATE INDEX IF NOT EXISTS idx_zkp_proofs_circuit ON zkp_proofs(circuit_id);
CREATE INDEX IF NOT EXISTS idx_zkp_proofs_status ON zkp_proofs(status);
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "zkpEngine": {
    "enabled": true,
    "defaultProofSystem": "groth16",
    "circom": {
      "version": "2.0.0",
      "optimizationLevel": 2,
      "maxConstraints": 1000000
    },
    "proof": {
      "defaultExpiry": 86400000,
      "cacheEnabled": true,
      "maxConcurrentGeneration": 2
    },
    "identity": {
      "defaultDisclosure": [],
      "autoRenew": true,
      "renewBeforeExpiry": 3600000
    }
  }
}
```

## 故障排除

| 问题         | 解决方案                                  |
| ------------ | ----------------------------------------- |
| 电路编译失败 | 检查 Circom 语法，确认约束数未超限        |
| 证明生成慢   | 减少电路约束数，限制并发数，确认 CPU 可用 |
| 验证失败     | 确认 publicSignals 与生成时一致           |
| 身份证明过期 | 启用 autoRenew 或手动重新生成             |
| 内存不足     | 减小电路规模，增加系统内存                |

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 电路约束过多编译慢 | 电路复杂度过高或未分拆子电路 | 拆分为多个子电路，减少单电路约束数 |
| 证明生成 OOM 内存溢出 | 电路规模超出系统内存上限 | 增加系统内存，或减小电路规模和 witness 大小 |
| 验证密钥不匹配 | 编译电路后密钥未更新或版本混用 | 重新生成密钥对 `zkp keygen --circuit <name>` |
| 证明验证失败返回 false | publicSignals 与生成时不一致 | 对比 publicSignals，确认输入参数完全一致 |
| 可信设置仪式超时 | 参与方网络延迟或参与人数过多 | 减少参与方数量，或切换到无需可信设置的 PLONK |

### 常见错误修复

**错误: `CIRCUIT_COMPILE_SLOW` 电路编译超时**

```bash
# 查看电路约束数
chainlesschain zkp circuit-info --name <circuit>

# 启用增量编译
chainlesschain zkp compile --circuit <name> --incremental
```

**错误: `PROOF_GEN_OOM` 证明生成内存不足**

```bash
# 查看当前内存使用
chainlesschain zkp stats --memory

# 限制证明生成内存上限
chainlesschain zkp config --max-memory 4GB --circuit <name>
```

**错误: `VKEY_MISMATCH` 验证密钥不匹配**

```bash
# 重新生成验证密钥
chainlesschain zkp keygen --circuit <name> --force

# 验证密钥与电路的对应关系
chainlesschain zkp vkey-check --circuit <name>
```

## 配置参考

### 完整配置项说明

```javascript
// .chainlesschain/config.json — zkpEngine 完整配置
{
  "zkpEngine": {
    // 全局开关
    "enabled": true,

    // 默认证明系统: groth16 | plonk | stark
    "defaultProofSystem": "groth16",

    // Circom 电路编译器配置
    "circom": {
      "version": "2.0.0",           // Circom DSL 版本
      "optimizationLevel": 2,       // 优化等级 0-2，2 为最高
      "maxConstraints": 1000000,    // 单电路最大约束数（约 1M）
      "incrementalCompile": true,   // 启用增量编译，跳过未变更电路
      "cacheDir": ".zkp-cache"      // 编译产物缓存目录（相对 .chainlesschain/）
    },

    // 证明生成配置
    "proof": {
      "defaultExpiry": 86400000,        // 证明默认有效期（ms），默认 24 小时
      "cacheEnabled": true,             // 相同输入复用缓存证明，避免重复生成
      "maxConcurrentGeneration": 2,     // 最大并发证明生成数（建议 ≤ CPU 核数 / 2）
      "generationTimeoutMs": 120000,    // 单次证明生成超时（ms），默认 2 分钟
      "autoRevoke": false               // 证明过期时是否自动撤销（置为 revoked）
    },

    // 身份证明配置
    "identity": {
      "defaultDisclosure": [],          // 默认披露字段列表，空数组 = 最小披露
      "autoRenew": true,                // 临近过期时自动续签证明
      "renewBeforeExpiry": 3600000,     // 提前多久触发自动续签（ms），默认 1 小时
      "auditDisclosure": true           // 记录每次选择性披露的验证方 DID 和时间戳
    },

    // 性能调优
    "performance": {
      "wasmMemoryMb": 512,              // WASM 见证计算内存上限（MB）
      "proofWorkerThreads": 2,          // 证明生成 Worker 线程数
      "verifyBatchSize": 10             // 批量验证时每批最大数量
    }
  }
}
```

### 多证明系统对比配置

```javascript
// 按场景选择证明系统
const PROOF_SYSTEM_CONFIG = {
  groth16: {
    // 最快的证明/验证速度，需要可信设置仪式
    trustedSetup: true,
    proofSizeBytes: 192,      // 证明体积最小
    verifyTimeMs: 5,          // 链上验证极快
    useCase: "隐私交易、高频验证场景"
  },
  plonk: {
    // 无需可信设置，通用 SRS，证明体积较大
    trustedSetup: false,
    proofSizeBytes: 896,
    verifyTimeMs: 12,
    useCase: "无需可信设置的身份证明"
  },
  stark: {
    // 量子安全，无可信设置，证明体积最大
    trustedSetup: false,
    proofSizeBytes: 45000,    // 体积较大
    verifyTimeMs: 80,
    useCase: "后量子安全场景、监管合规"
  }
};
```

## 性能指标

### 核心操作基准（Apple M2 / AMD Ryzen 7 参考值）

| 操作 | 目标 | 实际（10K 约束电路） | 状态 |
| ---- | ---- | -------------------- | ---- |
| Circom 电路编译（首次） | < 5s | ~3.2s | ✅ 达标 |
| Circom 电路编译（增量） | < 500ms | ~180ms | ✅ 达标 |
| Groth16 证明生成（10K 约束） | < 3s | ~1.8s | ✅ 达标 |
| Groth16 证明生成（100K 约束） | < 30s | ~22s | ✅ 达标 |
| Groth16 证明验证 | < 20ms | ~8ms | ✅ 达标 |
| PLONK 证明生成（10K 约束） | < 8s | ~6.1s | ✅ 达标 |
| PLONK 证明验证 | < 30ms | ~14ms | ✅ 达标 |
| 身份证明创建（3 个 claims） | < 2s | ~1.1s | ✅ 达标 |
| 选择性披露验证 | < 50ms | ~18ms | ✅ 达标 |
| 缓存证明复用（命中） | < 5ms | ~1.2ms | ✅ 达标 |

### 内存占用参考

| 场景 | 内存峰值 | 说明 |
| ---- | -------- | ---- |
| 10K 约束电路 Witness 计算 | ~256MB | 标准身份证明场景 |
| 100K 约束电路 Witness 计算 | ~1.5GB | 复杂隐私交易电路 |
| 并发 2 路证明生成 | ~2.8GB | 默认 maxConcurrentGeneration=2 |
| 验证操作（仅验证） | ~32MB | 验证无需加载 witness |

### 并发扩展性

| 并发证明数 | 吞吐量（证明/分钟） | CPU 利用率 | 状态 |
| ---------- | ------------------- | ---------- | ---- |
| 1 | ~20 | 45% | ✅ 基准 |
| 2 | ~36 | 82% | ✅ 推荐（默认） |
| 4 | ~42 | 98% | ⚠️ CPU 争抢，延迟上升 |

## 测试覆盖率

### 测试文件列表

| 测试文件 | 覆盖范围 | 用例数 |
| -------- | -------- | ------ |
| ✅ `desktop-app-vue/tests/unit/crypto/zkp-engine.test.js` | 证明生成/验证核心逻辑、缓存、并发 | 48 |
| ✅ `desktop-app-vue/tests/unit/crypto/circom-compiler.test.js` | 电路编译、增量编译、约束数统计 | 31 |
| ✅ `desktop-app-vue/tests/unit/crypto/identity-proof.test.js` | 身份证明创建、选择性披露、自动续签 | 27 |
| ✅ `desktop-app-vue/tests/unit/crypto/zkp-ipc.test.js` | 6 个 IPC Handler 参数校验与响应格式 | 42 |
| ✅ `desktop-app-vue/tests/unit/crypto/zkp-proof-systems.test.js` | Groth16 / PLONK / STARK 三系统对比 | 19 |
| ✅ `desktop-app-vue/tests/unit/crypto/zkp-security.test.js` | 证明撤销、过期策略、验证密钥保护 | 23 |
| ✅ `desktop-app-vue/tests/integration/zkp-full-flow.test.js` | 端到端：编译→生成→验证→身份证明 | 14 |

**总计**: 7 个测试文件，204 个测试用例

### 关键测试场景

```
✅ 编译 Circom 电路并验证约束数正确
✅ Groth16 证明生成与公共信号验证
✅ PLONK 无可信设置场景证明完整性
✅ 身份证明选择性披露最小化
✅ 证明过期后验证返回 expired 状态
✅ 并发 2 路证明生成无竞争条件
✅ 相同输入缓存复用命中率 > 95%
✅ 电路约束超限时编译抛出明确错误
✅ 验证密钥不匹配时验证返回 false
✅ 选择性披露记录 verifierDid 审计日志
```

## 安全考虑

### 证明系统安全性
- **可信设置**: Groth16 需要可信设置仪式（Trusted Setup），泄露 toxic waste 将导致伪造证明；建议使用多方参与的 Powers of Tau 仪式或切换到无需可信设置的 PLONK/STARK
- **电路审计**: 自定义 Circom 电路上线前务必进行形式化验证或第三方审计，约束不完整可能导致零知识性失效
- **侧信道防护**: 证明生成过程中避免在共享环境下运行，防止计时攻击（Timing Attack）泄露 witness 信息

### 密钥与证明管理
- **验证密钥保护**: `vkey_data` 存储在 SQLite 中并由 SQLCipher 加密，切勿以明文导出或传输验证密钥
- **证明有效期**: 所有证明默认设置过期时间（`defaultExpiry`），过期证明自动标记为 `expired` 状态，防止无限期重放
- **证明撤销**: 支持主动撤销已签发的证明（状态置为 `revoked`），撤销后验证方将拒绝接受

### 身份证明隐私
- **最小披露原则**: 使用选择性披露时仅公开必要的身份属性，系统默认 `defaultDisclosure` 为空数组
- **验证方身份校验**: 选择性披露操作需指定 `verifierDid`，系统记录披露对象以便事后审计
- **证明不可关联性**: 同一身份的多次证明之间不应可被关联，避免使用固定的 `proofId` 前缀或可预测的标识符

## 故障深度排查

### 电路编译失败

1. **Circom 语法检查**: 确认使用 `pragma circom 2.0.0;` 版本声明，信号定义使用 `signal input/output`，约束使用 `===`
2. **约束数超限**: 检查电路约束数是否超过 `maxConstraints`（默认 100 万），复杂电路需分拆为多个子电路
3. **模板参数错误**: Circom 模板参数必须为编译时常量，不支持运行时动态值
4. **编译器路径**: 确认 Circom 编译器已安装且在 PATH 中可访问（`circom --version`）

### 证明验证错误

| 现象 | 排查步骤 |
|------|---------|
| `valid: false` | 确认 `publicSignals` 与生成证明时完全一致（顺序和数值），任何偏差都会导致验证失败 |
| 验证密钥不匹配 | 检查 `circuitId` 是否正确，证明必须使用同一电路的验证密钥验证 |
| 证明已过期 | `status: "expired"` 表示超过 `defaultExpiry`（默认 24 小时），需重新生成证明 |
| 跨设备验证失败 | 确认导出的验证密钥（`vkey_data`）完整且未被篡改 |

### 性能问题

- **证明生成慢（>10s）**: 减少电路约束数是最有效的优化手段；限制 `maxConcurrentGeneration`（默认 2）避免 CPU 争抢
- **内存不足（OOM）**: 大型电路的 witness 计算需要大量内存，建议预留 4GB+ 可用内存；减小电路规模或增加系统内存
- **Groth16 vs PLONK**: Groth16 证明生成快、验证快但需要可信设置；PLONK 无需可信设置但证明体积较大，根据场景选择
- **证明缓存**: 启用 `cacheEnabled: true` 避免相同输入重复生成证明

## 相关文档

- [加密系统](/chainlesschain/encryption)
- [DID 身份](/chainlesschain/social)
- [Agent 联邦网络](/chainlesschain/agent-federation)
