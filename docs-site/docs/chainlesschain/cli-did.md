# DID 身份管理 (did)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🪪 **W3C DID 标准**: 基于 W3C DID Core 规范子集
- 🔑 **Ed25519 签名**: 高性能椭圆曲线数字签名
- 🏠 **本地存储**: 密钥对安全存储在本地 SQLite
- ✍️ **消息签名/验证**: 对任意消息进行数字签名和验证
- 📤 **身份导出**: 支持导出 DID 文档（可选含私钥）
- 🔒 **零外部依赖**: 完全使用 Node.js 内置 `crypto` 模块

## 概述

ChainlessChain CLI 提供基于 Ed25519 的 W3C DID 去中心化身份管理功能。

- **算法**: Ed25519 签名密钥对
- **DID 格式**: `did:chainless:<base64url-of-sha256-of-pubkey>`
- **标准**: W3C DID Core 子集
- **存储**: 本地 SQLite `did_identities` 表

## 命令参考

### did create — 创建身份

```bash
chainlesschain did create
chainlesschain did create --label "work"    # 指定标签
```

生成 Ed25519 密钥对，计算 DID 标识符，创建 W3C DID 文档，保存到数据库。

### did list — 列出所有身份（默认）

```bash
chainlesschain did list
chainlesschain did                          # 等同于 did list
```

显示所有已创建的 DID 身份，标记默认身份。

### did show — 查看身份详情

```bash
chainlesschain did show <did>
```

显示完整的 DID 文档，包括公钥、验证方法等。

### did resolve — 解析 DID

```bash
chainlesschain did resolve <did>
```

解析 DID 并返回 DID 文档（本地解析）。

### did sign — 签名消息

```bash
chainlesschain did sign "message to sign"
chainlesschain did sign "message" --did <specific-did>
```

使用默认（或指定）DID 的私钥对消息进行 Ed25519 签名。

### did verify — 验证签名

```bash
chainlesschain did verify "message" --signature <base64sig> --did <did>
```

验证 Ed25519 签名的有效性。

### did export — 导出身份

```bash
chainlesschain did export <did>
chainlesschain did export <did> --include-private   # 包含私钥（危险）
```

导出 DID 文档和公钥信息。使用 `--include-private` 导出私钥（需谨慎）。

### did set-default — 设置默认身份

```bash
chainlesschain did set-default <did>
```

设置指定 DID 为默认签名身份。

### did delete — 删除身份

```bash
chainlesschain did delete <did>
```

删除指定 DID 身份（需确认）。

## DID 文档格式

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:chainless:abc123...",
  "verificationMethod": [{
    "id": "did:chainless:abc123...#key-1",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:chainless:abc123...",
    "publicKeyMultibase": "z..."
  }],
  "authentication": ["did:chainless:abc123...#key-1"],
  "assertionMethod": ["did:chainless:abc123...#key-1"]
}
```

## 技术实现

- **密钥生成**: `crypto.generateKeyPairSync("ed25519")` (Node.js 内置)
- **DID 计算**: SHA-256(公钥) → base64url 编码
- **签名**: Ed25519 签名 → base64 编码
- **零外部依赖**: 完全使用 Node.js 内置 `crypto` 模块

## 系统架构

```
用户命令 → did.js (Commander) → did-manager.js
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
             crypto.generateKeyPairSync   SHA-256 哈希   Ed25519 签名
                    │                │                │
                    ▼                ▼                ▼
              私钥/公钥对      DID 标识符       数字签名/验证
                    │
                    ▼
             SQLite did_identities 表
```

## 配置参考

```bash
chainlesschain did create [--label <name>]
chainlesschain did list
chainlesschain did show <did>
chainlesschain did resolve <did>
chainlesschain did sign <message> [--did <specific-did>]
chainlesschain did verify <message> --signature <base64sig> --did <did>
chainlesschain did export <did> [--include-private]
chainlesschain did set-default <did>
chainlesschain did delete <did>
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| Ed25519 密钥对生成 | < 50ms | ~ 10ms | ✅ |
| DID 标识符计算（SHA-256） | < 10ms | ~ 2ms | ✅ |
| did sign（Ed25519 签名） | < 20ms | ~ 5ms | ✅ |
| did verify（签名验证） | < 20ms | ~ 6ms | ✅ |
| did list（SQLite 查询） | < 100ms | ~ 15ms | ✅ |

## 测试覆盖率

```
✅ did.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 安全考虑

- 私钥存储在本地 SQLite 数据库，建议配合数据库加密使用
- `export --include-private` 导出私钥极其危险，仅用于备份迁移
- Ed25519 签名使用 Node.js 内置 `crypto` 模块，零外部依赖
- DID 标识符基于公钥 SHA-256 哈希，不可逆推出私钥

## 使用示例

### 场景 1：创建并管理身份

```bash
chainlesschain did create --label "个人"
chainlesschain did create --label "工作"
chainlesschain did list
chainlesschain did set-default did:chainless:abc123
```

创建多个 DID 身份用于不同场景，设置常用身份为默认签名身份。

### 场景 2：消息签名与验证

```bash
chainlesschain did sign "这是一条重要消息"
chainlesschain did verify "这是一条重要消息" --signature <base64sig> --did did:chainless:abc123
```

使用默认 DID 对消息进行 Ed25519 数字签名，接收方可通过公钥验证签名真实性。

### 场景 3：身份备份导出

```bash
chainlesschain did export did:chainless:abc123
chainlesschain did export did:chainless:abc123 --include-private
```

导出 DID 文档用于共享公钥信息。`--include-private` 仅用于安全备份迁移，务必妥善保管。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `create` 失败 | 确认数据库已初始化：`chainlesschain db init` |
| `sign` 找不到默认身份 | 先创建身份：`chainlesschain did create` |
| `verify` 验证失败 | 确认消息内容、签名、DID 三者匹配 |
| `resolve` 返回空 | DID 仅支持本地解析，确认 DID 存在于本地数据库 |

## 关键文件

- `packages/cli/src/commands/did.js` — 命令实现
- `packages/cli/src/lib/did-manager.js` — DID 管理库

## 相关文档

- [RBAC 权限](./cli-auth) — 基于角色的访问控制
- [文件加密](./cli-encrypt) — AES-256-GCM 加密
- [审计日志](./cli-audit) — 操作审计
- [DID v2](./did-v2) — 桌面端 DID 系统详情
