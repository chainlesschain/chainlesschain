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

## 相关文档

- [数据加密](./encryption) — 桌面端多层加密架构
- [DID 身份](./cli-did) — Ed25519 签名
- [数据库管理](./cli-db) — 数据库备份与恢复
- [审计日志](./cli-audit) — 加密操作审计
