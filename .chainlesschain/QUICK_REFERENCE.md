# 编码规范快速参考

> 一页纸速查表 - 打印或保存为书签
>
> **版本**: v1.0 | **更新**: 2026-01-16

---

## 🔐 SQL 安全

| ❌ 错误 | ✅ 正确 |
|---------|---------|
| `db.exec(\`SELECT * WHERE id = ${id}\`)` | `db.prepare('SELECT * WHERE id = ?').get(id)` |
| `db.exec('INSERT INTO t VALUES (' + v + ')')` | `db.prepare('INSERT INTO t VALUES (?)').run(v)` |
| `db.exec('UPDATE t SET f = ' + val)` | `db.prepare('UPDATE t SET f = ?').run(val)` |

**记住**: better-sqlite3 的 `exec()` **不支持**参数化查询！

---

## 🔒 P2P 加密

| ❌ 错误 | ✅ 正确 |
|---------|---------|
| `p2p.publish(did, msg)` | `p2p.publish(did, await encrypt(msg))` |
| `Buffer.from(msg).toString('base64')` | `signalProtocol.encrypt(msg)` |

**记住**: 所有 P2P 消息必须使用 Signal Protocol 加密！

---

## 🚫 敏感信息

| ❌ 禁止 | ✅ 允许 |
|---------|---------|
| `console.log('PIN:', pin)` | `console.log('PIN验证:', success)` |
| `const key = 'sk-abc123'` | `const key = process.env.API_KEY` |
| `localStorage.setItem('pwd', pwd)` | 使用加密存储或 U-Key |

**记住**: PIN/密码/密钥永不记录日志或硬编码！

---

## 📝 Git 提交

```
<type>(<scope>): <subject>

feat(rag): 添加重排序器
fix(database): 修复SQL注入
security(p2p): 强化加密
```

**Type**: feat, fix, security, docs, refactor, test, chore, perf
**Scope**: 必须指定模块 (rag, llm, database, p2p, etc.)

---

## 🧪 测试覆盖

| 模块 | 要求 |
|------|------|
| database, llm, p2p | ≥ 80% |
| blockchain, trade | ≥ 70% |
| UI 组件 | ≥ 60% |

---

## 🛠️ 常用命令

```bash
# 规则验证
npm run validate:rules

# 查看 SQL 注入修复建议
node scripts/fix-sql-injection.js

# 运行测试
npm run test:db
npm run test:ukey

# Git 提交（会自动验证）
git commit -m "feat(module): description"

# 跳过验证（不推荐）
git commit --no-verify
```

---

## 📚 完整文档

- **主规则**: `.chainlesschain/rules.md`
- **SQL 修复**: `.chainlesschain/SQL_INJECTION_FIX_GUIDE.md`
- **审查指南**: `.chainlesschain/RULES_REVIEW_GUIDE.md`
- **示例代码**: `.chainlesschain/examples/`

---

## 🆘 遇到问题？

1. 查看错误提示中的文件和行号
2. 参考 `.chainlesschain/SQL_INJECTION_FIX_GUIDE.md`
3. 运行 `node scripts/fix-sql-injection.js` 查看建议
4. 咨询团队技术负责人

---

**打印此页保存在桌面！** 📌
