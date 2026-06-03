# 文件加密 (encrypt / decrypt)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🔐 **AES-256-GCM**: 认证加密，同时保证机密性和完整性
- 🔑 **PBKDF2 密钥派生**: 100,000 次迭代防暴力破解
- 📁 **文件加密**: 加密任意文件，生成 `.enc` 格式
- 🗄️ **数据库加密**: 为 CLI 数据库启用加密保护
- ℹ️ **元数据查看**: 查看加密文件的格式信息
- 🔒 **零外部依赖**: 完全使用 Node.js 内置 `crypto` 模块

## 概述

ChainlessChain CLI 提供 AES-256-GCM 文件加密和数据库加密功能。

- **算法**: AES-256-GCM（认证加密）
- **密钥派生**: PBKDF2 (100,000 次迭代, SHA-512)
- **文件格式**: `CCLC01` 自定义加密格式
- **零外部依赖**: 完全使用 Node.js 内置 `crypto` 模块

## 命令参考

### encrypt file — 加密文件

```bash
chainlesschain encrypt file <path>
chainlesschain encrypt file secret.txt
chainlesschain encrypt file document.pdf -o encrypted.bin
```

使用密码加密文件，生成 `.enc` 后缀的加密文件。

### decrypt file — 解密文件

```bash
chainlesschain decrypt file <path>
chainlesschain decrypt file secret.txt.enc
chainlesschain decrypt file encrypted.bin -o decrypted.txt
```

使用密码解密文件，恢复原始内容。

### encrypt db — 加密数据库

```bash
chainlesschain encrypt db
```

为 CLI 数据库启用加密保护。

### decrypt db — 解密数据库

```bash
chainlesschain decrypt db
```

移除数据库加密保护。

### encrypt info — 加密文件信息

```bash
chainlesschain encrypt info <path>
```

显示加密文件的元数据（格式版本、加密时间等）。

### encrypt status — 加密状态

```bash
chainlesschain encrypt status
```

显示数据库加密状态。

## 加密文件格式

```
┌──────────────────────────────┐
│ Magic Header: "CCLC01" (6B) │  格式标识
├──────────────────────────────┤
│ Salt (32 bytes)              │  PBKDF2 盐值
├──────────────────────────────┤
│ IV (12 bytes)                │  初始化向量
├──────────────────────────────┤
│ Auth Tag (16 bytes)          │  GCM 认证标签
├──────────────────────────────┤
│ Ciphertext (variable)        │  加密数据
└──────────────────────────────┘
```

## 安全特性

- **PBKDF2**: 100,000 次迭代防暴力破解
- **随机盐值**: 每次加密使用唯一 32 字节随机盐
- **GCM 认证**: 同时提供加密和完整性验证
- **时间安全比较**: 密码验证使用 `crypto.timingSafeEqual` 防时序攻击

## 系统架构

```
用户命令 → encrypt.js (Commander) → crypto-manager.js
                                          │
                         ┌────────────────┼────────────────┐
                         ▼                ▼                ▼
                   密码输入 (inquirer)  PBKDF2 密钥派生   AES-256-GCM
                         │                │                │
                         ▼                ▼                ▼
                    交互式密码       100K次迭代+盐值    加密/解密/认证
                         │
                         ▼
                   CCLC01 格式文件 (Salt+IV+Tag+Ciphertext)
```

## 配置参考

```bash
chainlesschain encrypt file <path> [-o <output>]
chainlesschain decrypt file <path> [-o <output>]
chainlesschain encrypt db
chainlesschain decrypt db
chainlesschain encrypt info <path>
chainlesschain encrypt status
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| PBKDF2 密钥派生（100K 迭代） | < 500ms | ~ 200-300ms | ✅ |
| AES-256-GCM 加密（1MB 文件） | < 100ms | ~ 30ms | ✅ |
| AES-256-GCM 解密 + 认证 | < 100ms | ~ 35ms | ✅ |
| encrypt info 元数据读取 | < 50ms | ~ 10ms | ✅ |
| 加密文件大小开销 | 固定 66B | 66 bytes | ✅ |

## 测试覆盖率

```
✅ encrypt.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 使用示例

### 场景 1：加密敏感文件

```bash
chainlesschain encrypt file credentials.json
chainlesschain encrypt info credentials.json.enc
```

加密包含 API Key 的配置文件，生成 `.enc` 加密文件。随后可查看加密文件的元数据信息。

### 场景 2：解密还原文件

```bash
chainlesschain decrypt file credentials.json.enc -o credentials.json
```

输入正确密码解密文件，使用 `-o` 指定输出路径还原为原始文件。

### 场景 3：数据库加密保护

```bash
chainlesschain encrypt status
chainlesschain encrypt db
chainlesschain encrypt status
```

先检查数据库加密状态，启用加密后再次确认。加密后数据库文件使用 SQLCipher AES-256 保护。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 解密失败 "Invalid password" | 密码错误，重新输入正确密码 |
| 加密后文件过大 | 正常现象，加密头部增加约 66 字节 |
| `encrypt db` 无响应 | 确认数据库已初始化：`chainlesschain db init` |
| `info` 显示 "Not encrypted" | 文件不是 CCLC01 格式的加密文件 |

## 关键文件

- `packages/cli/src/commands/encrypt.js` — 命令实现
- `packages/cli/src/lib/crypto-manager.js` — 加密管理库

## 安全考虑

### 密钥管理
- **密码强度**: PBKDF2 100,000 次迭代可抵御离线暴力破解，但密码本身必须足够强（建议 16 位以上，包含大小写字母、数字和特殊字符）
- **密码不存储**: 系统不保存用户密码，每次加密/解密时通过交互式输入获取；忘记密码将无法恢复加密文件
- **盐值唯一性**: 每次加密使用 32 字节随机盐值（`crypto.randomBytes(32)`），即使相同密码加密同一文件，生成的密文也不同

### AES-256 安全性
- **GCM 认证加密**: AES-256-GCM 同时提供机密性和完整性保护，密文被篡改时解密会失败（Auth Tag 校验不通过）
- **IV 不重复**: 每次加密生成 12 字节随机初始化向量（IV），确保同一密钥下不会重复使用 IV（重复 IV 会导致 GCM 安全性完全崩溃）
- **时间安全比较**: 密码验证使用 `crypto.timingSafeEqual` 进行常量时间比较，防止计时攻击（Timing Attack）推测密码

### 文件完整性
- **CCLC01 格式校验**: 解密时首先验证文件头 Magic Header（`CCLC01`），非加密文件或格式损坏的文件会被立即拒绝
- **Auth Tag 验证**: GCM 模式的 16 字节认证标签确保密文未被篡改，任何比特级别的修改都会导致解密失败
- **原始文件保留**: 加密操作生成新的 `.enc` 文件而非就地加密，原始文件由用户决定是否删除，避免加密过程中断导致数据丢失

## 相关文档

- [数据加密](./encryption) — 桌面端多层加密架构
- [DID 身份](./cli-did) — Ed25519 签名
- [数据库管理](./cli-db) — 数据库备份与恢复
- [审计日志](./cli-audit) — 加密操作审计
