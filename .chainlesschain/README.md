# ChainlessChain 规则系统

> 项目编码规范、安全规则和最佳实践的统一管理
>
> **版本**: v1.0.0 | **最后更新**: 2026-01-16

---

## 📚 文档导航

### 核心文档

| 文档 | 用途 | 读者 |
|------|------|------|
| **[rules.md](./rules.md)** | 完整编码规范 | 所有开发者（必读） |
| **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** | 快速参考手册 | 日常开发速查 |
| **[SQL_INJECTION_FIX_GUIDE.md](./SQL_INJECTION_FIX_GUIDE.md)** | SQL 注入修复指南 | 数据库开发者 |
| **[RULES_REVIEW_GUIDE.md](./RULES_REVIEW_GUIDE.md)** | 规则审查流程 | 技术负责人 |

### 示例代码

| 文件 | 描述 |
|------|------|
| [examples/database-good.js](./examples/database-good.js) | ✅ 安全的数据库操作 |
| [examples/database-bad.js](./examples/database-bad.js) | ❌ 不安全的示例（学习用） |
| [examples/p2p-encryption-good.js](./examples/p2p-encryption-good.js) | ✅ 正确的 P2P 加密 |
| [examples/p2p-encryption-bad.js](./examples/p2p-encryption-bad.js) | ❌ 加密常见错误 |

---

## 🚀 快速开始

### 1. 新成员入职

```bash
# 1. 阅读核心规则（15 分钟）
cat .chainlesschain/QUICK_REFERENCE.md

# 2. 运行规则验证器
cd desktop-app-vue
npm run validate:rules

# 3. 查看代码示例
node .chainlesschain/examples/database-good.js
```

### 2. 日常开发

```bash
# 提交代码前自动验证（已配置 Husky）
git add .
git commit -m "feat(module): description"
# → 自动运行规则验证

# 手动运行验证
npm run validate:rules

# 查看 SQL 注入修复建议
node scripts/fix-sql-injection.js
```

### 3. CI/CD 集成

GitHub Actions 已自动配置在 `.github/workflows/code-quality.yml`

每次 push 或 PR 会自动：
- ✅ 运行规则验证器
- ✅ 检查依赖项漏洞
- ✅ 执行数据库测试
- ✅ 构建检查

---

## 📋 规则概览

### 安全规范（强制）

| 规则 | 严重性 | 检测工具 |
|------|--------|----------|
| **SQL 注入防护** | 🔴 Critical | rules-validator.js |
| **P2P 加密** | 🔴 Critical | rules-validator.js |
| **敏感信息泄露** | 🟠 High | rules-validator.js |
| **依赖项漏洞** | 🟠 High | npm audit |

### 代码质量（建议）

| 规则 | 要求 | 工具 |
|------|------|------|
| **测试覆盖率** | ≥ 70% | Vitest |
| **提交规范** | Conventional Commits | commit-msg hook |
| **代码风格** | ESLint + Prettier | lint-staged |

---

## 🛠️ 工具链

### 验证工具

```bash
# 规则验证器（主要工具）
npm run validate:rules

# SQL 注入检查
node scripts/rules-validator.js

# SQL 注入修复建议
node scripts/fix-sql-injection.js
```

### Git Hooks

| Hook | 功能 | 位置 |
|------|------|------|
| **pre-commit** | 代码规则验证 | `.husky/pre-commit` |
| **commit-msg** | 提交信息格式检查 | `.husky/commit-msg` |

### CI/CD

| 工作流 | 触发条件 | 配置文件 |
|--------|----------|----------|
| **Code Quality** | push, PR | `.github/workflows/code-quality.yml` |

---

## 📖 详细说明

### SQL 注入防护

**问题**: 项目中发现 163 个潜在的 SQL 注入风险点

**解决方案**:
1. 阅读 [SQL_INJECTION_FIX_GUIDE.md](./SQL_INJECTION_FIX_GUIDE.md)
2. 参考 [examples/database-good.js](./examples/database-good.js)
3. 运行自动修复工具（预览模式）:
   ```bash
   node scripts/fix-sql-injection.js
   ```

**核心原则**:
```javascript
// ❌ 错误
db.exec(`SELECT * FROM notes WHERE id = ${id}`);

// ✅ 正确
db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
```

### P2P 加密规范

**要求**: 所有 P2P 消息必须使用 Signal Protocol 加密

**示例**:
- ✅ [examples/p2p-encryption-good.js](./examples/p2p-encryption-good.js)
- ❌ [examples/p2p-encryption-bad.js](./examples/p2p-encryption-bad.js)

**核心原则**:
```javascript
// ❌ 错误 - 明文传输
p2pNode.pubsub.publish(did, message);

// ❌ 错误 - Base64 不是加密
p2pNode.pubsub.publish(did, Buffer.from(message).toString('base64'));

// ✅ 正确 - 使用 Signal Protocol
const encrypted = await signalProtocol.encrypt(message);
p2pNode.pubsub.publish(did, encrypted);
```

### 提交规范

**格式**: `<type>(<scope>): <subject>`

**Type 类型**:
- `feat` - 新功能
- `fix` - Bug 修复
- `security` - 安全问题修复（高优先级）
- `docs` - 文档更新
- `refactor` - 重构
- `test` - 测试
- `chore` - 构建/工具链

**Scope 模块**（必须指定）:
- `rag`, `llm`, `p2p`, `database`, `plugin`, `ui`, `trade`, `did`, `git`

**示例**:
```bash
git commit -m "feat(rag): 添加重排序器支持"
git commit -m "fix(database): 修复SQL注入漏洞"
git commit -m "security(p2p): 强化E2E加密"
```

---

## 🔄 规则审查流程

规则系统会定期审查和更新，详见 [RULES_REVIEW_GUIDE.md](./RULES_REVIEW_GUIDE.md)

**审查周期**:
- 每周一: 查看上周违规情况
- 每月 1 日: 月度规则审查会议
- 每季度: 全面规则体系评估

**提议新规则**:
1. 创建 GitHub Issue (标签: `rules`)
2. 使用模板提交规则提案
3. 技术评审 (≥2/3 同意)
4. 试运行 (1 周)
5. 正式发布

---

## 📊 当前状态

### 规则验证结果（最近一次）

```
❌ 发现 163 个错误（SQL 注入）
⚠️  发现 315 个警告（敏感信息日志）
📦 发现 50 个依赖项漏洞
```

**优先修复**:
1. 🔴 P0: 用户输入直接拼接 SQL（立即修复）
2. 🟠 P1: 使用 `db.exec()` 而非 `db.prepare()`（本月修复）
3. 🟡 P2: DDL 语句使用 `exec()`（计划修复）

### 修复进度跟踪

- [ ] database.js (核心数据库)
- [ ] contacts/ (联系人模块)
- [ ] social/ (社交模块)
- [ ] trade/ (交易模块)
- [ ] blockchain/ (区块链模块)
- [ ] p2p/ (P2P 模块)

---

## 🆘 常见问题

### Q1: 为什么提交被阻止？

A: pre-commit hook 检测到规则违反。查看错误信息，修复后重新提交。

临时跳过（不推荐）:
```bash
git commit --no-verify
```

### Q2: 如何修复 SQL 注入问题？

A: 参考 [SQL_INJECTION_FIX_GUIDE.md](./SQL_INJECTION_FIX_GUIDE.md)，或运行：
```bash
node scripts/fix-sql-injection.js  # 查看建议
```

### Q3: 规则验证器有误报怎么办？

A: 在代码前添加注释：
```javascript
// eslint-disable-next-line chainless-rules
db.exec('CREATE TABLE ...');  // 静态 DDL 可以使用 exec
```

然后提交 Issue 报告误报。

### Q4: 如何添加新规则？

A: 参考 [RULES_REVIEW_GUIDE.md](./RULES_REVIEW_GUIDE.md) 的"规则更新流程"。

---

## 📞 获取帮助

- **文档**: 查看本目录下的各个文档
- **示例**: 运行 `examples/` 目录下的示例代码
- **工具**: 使用 `scripts/rules-validator.js` 和 `scripts/fix-sql-injection.js`
- **问题**: 提交 GitHub Issue (标签: `rules`, `security`)

---

## 🏆 最佳实践

### ✅ DO（推荐）

- 提交前运行 `npm run validate:rules`
- 参考 `examples/` 中的正确示例
- 遇到问题查阅 `SQL_INJECTION_FIX_GUIDE.md`
- 定期运行 `npm audit` 检查依赖漏洞
- 使用 Conventional Commits 格式

### ❌ DON'T（禁止）

- 使用 `--no-verify` 跳过验证
- 硬编码 API 密钥、PIN 码、密码
- 使用 `db.exec()` 拼接用户输入
- 明文传输 P2P 消息
- 使用 Base64 代替加密

---

## 🎯 目标

- **短期** (1 个月):
  - [ ] 修复所有 P0 SQL 注入问题
  - [ ] 依赖项漏洞降至 < 10 个
  - [ ] 团队培训完成率 100%

- **中期** (3 个月):
  - [ ] 规则验证 0 错误
  - [ ] 测试覆盖率 > 80%
  - [ ] CI/CD 通过率 > 95%

- **长期** (6 个月):
  - [ ] 集成 SonarQube
  - [ ] 自动化安全扫描
  - [ ] 规则系统 2.0

---

## 📜 变更日志

### v1.0.0 (2026-01-16)

- ✨ 初始发布
- ✅ 创建核心规则文档
- ✅ 实现 SQL 注入验证器
- ✅ 配置 Git Hooks
- ✅ 集成 GitHub Actions
- ✅ 添加代码示例库
- ✅ 编写修复指南

---

**维护者**: ChainlessChain 技术团队
**审核周期**: 每月
**反馈**: 通过 GitHub Issues
