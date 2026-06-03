# 后量子密码 (pqc)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔑 **密钥管理**: 查看所有 PQC 密钥，按算法过滤
- ⚡ **PQC 密钥生成**: 支持 ML-KEM、ML-DSA 等后量子算法生成密钥对
- 📋 **迁移状态**: 查看经典密码到后量子密码的迁移进度
- 🔄 **密钥迁移**: 执行从经典算法到 PQC 算法的密钥迁移

## 概述

ChainlessChain CLI 后量子密码（PQC）模块为系统提供抗量子计算攻击的密码学能力。支持 NIST 标准化的 ML-KEM（密钥封装）和 ML-DSA（数字签名）算法族。

`generate` 命令生成 PQC 密钥对，支持 encryption（加密）、signing（签名）和 key_exchange（密钥交换）三种用途。系统还支持混合模式（hybrid），同时使用经典和后量子算法提供双重安全保障。`migration-status` 和 `migrate` 管理从经典密码体系到 PQC 的渐进迁移。

## 命令参考

### pqc keys — 查看密钥

```bash
chainlesschain pqc keys
chainlesschain pqc keys -a ML-KEM-768
chainlesschain pqc keys --json
```

列出所有 PQC 密钥，支持按算法过滤。

### pqc algorithms — 列出支持的算法 (v5.0.2.10)

```bash
chainlesschain pqc algorithms                # 全部算法目录（ML-KEM / ML-DSA / SLH-DSA / Hybrid）
chainlesschain pqc algorithms -f slh-dsa     # 过滤 SLH-DSA 变体（6 个）
chainlesschain pqc algorithms -f hybrid --json
```

输出每个算法的名称、标准（FIPS 203 / 204 / 205）、用途、密钥大小与推荐场景。

### pqc generate — 生成密钥对

```bash
chainlesschain pqc generate <algorithm>

# FIPS 203 — ML-KEM
chainlesschain pqc generate ML-KEM-768  -p encryption
chainlesschain pqc generate ML-KEM-1024 -p key_exchange

# FIPS 204 — ML-DSA
chainlesschain pqc generate ML-DSA-65 -p signing
chainlesschain pqc generate ML-DSA-87 -p signing

# FIPS 205 — SLH-DSA (v5.0.2.10)
chainlesschain pqc generate SLH-DSA-128s -p signing   # 短签名、128 位安全
chainlesschain pqc generate SLH-DSA-128f -p signing   # 快签名、128 位安全
chainlesschain pqc generate SLH-DSA-192s -p signing
chainlesschain pqc generate SLH-DSA-192f -p signing
chainlesschain pqc generate SLH-DSA-256s -p signing
chainlesschain pqc generate SLH-DSA-256f -p signing

# 混合模式 (经典 + PQC) —— v5.0.2.10 扩展
chainlesschain pqc generate HYBRID-ED25519-ML-DSA     -p signing
chainlesschain pqc generate HYBRID-ED25519-SLH-DSA    -p signing
chainlesschain pqc generate HYBRID-X25519-ML-KEM      -p encryption
```

生成指定算法的 PQC 密钥对。

支持的算法：
- **ML-KEM-768** / **ML-KEM-1024** — 密钥封装机制（加密、密钥交换，FIPS 203）
- **ML-DSA-65** / **ML-DSA-87** — 格基数字签名（签名，FIPS 204）
- **SLH-DSA-{128,192,256}{s,f}** — 基于哈希的无状态签名（v5.0.2.10 · FIPS 205）：`s` 变体签名更短、速度慢；`f` 变体签名更大、速度快。共 6 个参数集
- **Hybrid 混合模式** — 同时生成经典 (Ed25519/X25519) + PQC 密钥，过渡期双重安全保障

### pqc migration-status — 迁移状态

```bash
chainlesschain pqc migration-status
chainlesschain pqc migration-status --json
```

显示所有密钥迁移计划的状态，包括源算法、目标算法、已迁移/总密钥数。

### pqc migrate — 执行迁移

```bash
chainlesschain pqc migrate <plan-name> <target-algorithm>
chainlesschain pqc migrate "升级到 ML-KEM" ML-KEM-768 -s RSA-2048
chainlesschain pqc migrate "签名迁移" ML-DSA-65 -s Ed25519
```

执行密钥迁移计划，将指定源算法的密钥迁移到目标 PQC 算法。

## 数据库表

| 表名 | 说明 |
|------|------|
| `pqc_keys` | PQC 密钥（算法、用途、密钥大小、混合模式、经典算法、创建时间） |
| `pqc_migration_status` | 迁移计划（计划名、源算法、目标算法、已迁移数、总数、状态） |

## 系统架构

```
用户命令 → pqc.js (Commander) → pqc-manager.js
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
          密钥生成                 密钥管理                迁移引擎
    (ML-KEM/ML-DSA)          (列出/查询)          (计划/执行/状态)
                ▼                      ▼                      ▼
            pqc_keys              pqc_keys         pqc_migration_status
```

## 配置参考

```bash
# CLI 选项
-a, --algorithm <name>   # 按算法过滤 (keys 子命令)
-p, --purpose <purpose>  # 密钥用途 (encryption | signing | key_exchange)
-s, --source <algo>      # 源算法 (migrate 子命令，例: RSA-2048 / Ed25519)
--hybrid                 # 启用混合模式（经典 + PQC 双算法）
--json                   # JSON 格式输出

# 环境变量
CHAINLESSCHAIN_DB_PATH   # pqc_keys / pqc_migration_status 存储路径
CHAINLESSCHAIN_DB_KEY    # SQLCipher 加密密钥
PQC_DEFAULT_KEM          # 默认 KEM 算法 (默认 ML-KEM-768)
PQC_DEFAULT_DSA          # 默认 DSA 算法 (默认 ML-DSA-65)
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| `pqc keys` | < 100ms | ~50ms | ✅ |
| `pqc generate ML-KEM-768` | < 500ms | ~280ms | ✅ |
| `pqc generate ML-DSA-65` | < 600ms | ~350ms | ✅ |
| `pqc generate ML-KEM-1024` | < 800ms | ~450ms | ✅ |
| `pqc migration-status` | < 120ms | ~60ms | ✅ |
| `pqc migrate` (计划创建) | < 200ms | ~100ms | ✅ |

## 测试覆盖率

```
✅ pqc-manager.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/pqc.js` — 命令实现
- `packages/cli/src/lib/pqc-manager.js` — PQC 管理库

## 使用示例

### 场景 1：生成 PQC 密钥

```bash
# 生成加密密钥（ML-KEM-768）
chainlesschain pqc generate ML-KEM-768 -p encryption

# 生成签名密钥（ML-DSA-65）
chainlesschain pqc generate ML-DSA-65 -p signing

# 查看所有密钥
chainlesschain pqc keys --json
```

### 场景 2：经典密钥迁移

```bash
# 查看当前迁移状态
chainlesschain pqc migration-status

# 执行 RSA → ML-KEM 迁移
chainlesschain pqc migrate "RSA 升级计划" ML-KEM-1024 -s RSA-2048

# 执行 Ed25519 → ML-DSA 迁移
chainlesschain pqc migrate "签名算法升级" ML-DSA-87 -s Ed25519

# 确认迁移完成
chainlesschain pqc migration-status --json
```

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No PQC keys" | 未生成密钥 | 使用 `pqc generate` 生成密钥 |
| "No migration plans" | 未创建迁移计划 | 使用 `pqc migrate` 创建迁移 |
| 密钥生成失败 | 不支持的算法 | 使用支持的算法：ML-KEM-768/1024、ML-DSA-65/87 |

## 安全考虑

- **抗量子攻击**: 采用 NIST 标准化的后量子算法，抵抗量子计算机攻击
- **混合模式**: 支持经典 + PQC 双算法混合，确保过渡期安全
- **渐进迁移**: 支持分批迁移密钥，不影响现有业务
- **密钥隔离**: PQC 密钥存储在加密数据库中，独立于经典密钥

## 相关文档

- [DID 身份](./cli-did) — 去中心化身份
- [加密管理](./cli-encrypt) — 文件加密
- [ZKP 引擎](./cli-zkp) — 零知识证明
