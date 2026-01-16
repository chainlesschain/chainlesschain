# ChainlessChain 编码规范培训指南

> 团队培训材料 - 1 小时速成课程
>
> **目标**: 掌握核心安全规范，能够编写安全的代码
> **时长**: 60 分钟
> **版本**: v1.0

---

## 📅 培训大纲

### 第一部分：规则系统概览 (10 分钟)

**目标**: 了解为什么需要编码规范

#### 当前问题
- ❌ 发现 **163 个 SQL 注入风险点**
- ⚠️ 发现 **315 个敏感信息泄露**
- 📦 发现 **50 个依赖项漏洞**

#### 解决方案
- ✅ 自动化规则验证器
- ✅ Git Hooks 自动检查
- ✅ CI/CD 集成
- ✅ 详细的文档和示例

---

### 第二部分：SQL 安全 (20 分钟)

#### 核心原则

**记住一句话**: better-sqlite3 的 `exec()` **不支持**参数化查询！

#### 错误示例

```javascript
// ❌ 危险！用户输入直接拼接
const userId = req.params.id;
db.exec(`SELECT * FROM users WHERE id = ${userId}`);

// 如果 userId = "1 OR 1=1"
// SQL 变成: SELECT * FROM users WHERE id = 1 OR 1=1
// 返回所有用户！
```

#### 正确示例

```javascript
// ✅ 安全：使用参数化查询
const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
const user = stmt.get(userId);
```

#### 实践演练

**任务 1: 修复以下代码**

```javascript
// ❌ 修复前
function getNoteByTitle(title) {
  return db.exec(`SELECT * FROM notes WHERE title = '${title}'`);
}

// ✅ 修复后
function getNoteByTitle(title) {
  const stmt = db.prepare('SELECT * FROM notes WHERE title = ?');
  return stmt.all(title);
}
```

**任务 2: 动态字段更新**

```javascript
// ❌ 错误：字段名拼接
function updateNote(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = '${updates[k]}'`).join(', ');
  db.exec(`UPDATE notes SET ${fields} WHERE id = ${id}`);
}

// ✅ 正确：白名单 + 参数化
function updateNote(id, updates) {
  const allowedFields = ['title', 'content', 'tags'];
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);  // 字段名来自白名单
      values.push(value);          // 值使用参数
    }
  }

  values.push(id);
  const stmt = db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values);
}
```

---

### 第三部分：P2P 加密 (15 分钟)

#### 核心原则

**所有 P2P 消息必须使用 Signal Protocol 加密！**

#### 常见错误

```javascript
// ❌ 错误 1: 明文传输
p2pNode.pubsub.publish(recipientDID, message);

// ❌ 错误 2: Base64 不是加密
const "encrypted" = Buffer.from(message).toString('base64');
p2pNode.pubsub.publish(recipientDID, "encrypted");

// ❌ 错误 3: 自定义弱加密
function xorEncrypt(text, key) {
  // ROT13, XOR 等都不安全
}
```

#### 正确做法

```javascript
// ✅ 使用 Signal Protocol
async function sendSecureMessage(recipientDID, message) {
  // 1. 获取或创建会话
  const session = await getOrCreateSignalSession(recipientDID);

  // 2. 加密消息
  const encryptedData = await session.encrypt(message);

  // 3. 发送加密数据
  await p2pNode.pubsub.publish(recipientDID, encryptedData);

  // 4. 保存到离线队列（如果需要）
  await saveToOfflineQueue(recipientDID, encryptedData);
}
```

#### 实践演练

**任务: 实现安全的群组消息**

```javascript
// ✅ 为每个成员单独加密
async function sendGroupMessage(memberDIDs, message) {
  for (const did of memberDIDs) {
    const session = await getSignalSession(did);
    const encrypted = await session.encrypt(message);
    await p2pNode.pubsub.publish(did, encrypted);
  }
}
```

---

### 第四部分：敏感信息保护 (10 分钟)

#### 禁止事项

```javascript
// ❌ 禁止 1: 日志记录 PIN
console.log('用户PIN:', pin);

// ❌ 禁止 2: 硬编码密钥
const API_KEY = 'sk-1234567890abcdef';

// ❌ 禁止 3: 明文存储密码
localStorage.setItem('password', password);
```

#### 正确做法

```javascript
// ✅ 正确 1: 只记录结果
console.log('PIN验证:', verified ? '成功' : '失败');

// ✅ 正确 2: 使用环境变量
const API_KEY = process.env.OPENAI_API_KEY;

// ✅ 正确 3: 使用加密存储
const encryptedPwd = await encryptWithUKey(password);
db.prepare('INSERT INTO users (pwd) VALUES (?)').run(encryptedPwd);
```

---

### 第五部分：工具使用 (5 分钟)

#### 常用命令

```bash
# 1. 运行规则验证
npm run validate:rules

# 2. 查看 SQL 修复建议
npm run fix:sql

# 3. 批量修复（预览）
node scripts/batch-fix-sql-injection.js

# 4. 批量修复（应用）
node scripts/batch-fix-sql-injection.js --apply

# 5. 运行示例代码
npm run example:database
npm run example:p2p

# 6. 查看快速参考
npm run docs:rules
```

#### Git Hooks

```bash
# 正常提交（自动验证）
git commit -m "feat(database): 添加新功能"
# → 如果有规则违反，提交会被阻止

# 跳过验证（不推荐）
git commit --no-verify -m "fix: 紧急修复"
```

---

## 🎯 实战练习

### 练习 1: SQL 注入修复

修复以下代码中的所有安全问题：

```javascript
class UserManager {
  searchUsers(keyword) {
    // ❌ 问题：字符串拼接
    return db.exec(`SELECT * FROM users WHERE name LIKE '%${keyword}%'`);
  }

  deleteUser(userId) {
    // ❌ 问题：使用 exec 而非 prepare
    db.exec(`DELETE FROM users WHERE id = ${userId}`);
  }

  updateUserRole(userId, role) {
    // ❌ 问题：字符串拼接
    db.exec(`UPDATE users SET role = '${role}' WHERE id = ${userId}`);
  }
}
```

**答案**：

```javascript
class UserManager {
  searchUsers(keyword) {
    // ✅ 正确
    const stmt = db.prepare('SELECT * FROM users WHERE name LIKE ?');
    return stmt.all(`%${keyword}%`);
  }

  deleteUser(userId) {
    // ✅ 正确
    const stmt = db.prepare('DELETE FROM users WHERE id = ?');
    return stmt.run(userId);
  }

  updateUserRole(userId, role) {
    // ✅ 正确
    const stmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    return stmt.run(role, userId);
  }
}
```

---

### 练习 2: P2P 加密

修复以下代码：

```javascript
// ❌ 问题：未加密
async function shareFile(recipientDID, fileBuffer) {
  await p2pNode.pubsub.publish(recipientDID, {
    type: 'file',
    data: fileBuffer.toString('base64')  // Base64 不是加密
  });
}
```

**答案**：

```javascript
// ✅ 正确：使用加密
async function shareFile(recipientDID, fileBuffer) {
  // 1. 生成对称密钥
  const symmetricKey = crypto.randomBytes(32);

  // 2. 用对称密钥加密文件
  const cipher = crypto.createCipheriv('aes-256-gcm', symmetricKey, iv);
  const encryptedFile = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);

  // 3. 用 Signal Protocol 加密对称密钥
  const session = await getSignalSession(recipientDID);
  const encryptedKey = await session.encrypt(symmetricKey);

  // 4. 发送
  await p2pNode.pubsub.publish(recipientDID, {
    type: 'encrypted_file',
    key: encryptedKey,
    data: encryptedFile,
    authTag: cipher.getAuthTag()
  });
}
```

---

## 📝 课后测验

### 选择题

**1. 以下哪个是正确的数据库查询方式？**

A. `db.exec(\`SELECT * WHERE id = ${id}\`)`  
B. `db.exec('SELECT * WHERE id = ?', [id])`  
C. `db.prepare('SELECT * WHERE id = ?').get(id)` ✅  
D. `db.run('SELECT * WHERE id = ?', id)`

**2. 以下哪个加密方式是安全的？**

A. `Buffer.from(msg).toString('base64')`  
B. `crypto.createHash('md5').update(msg)`  
C. `signalProtocol.encrypt(msg)` ✅  
D. `msg.split('').reverse().join('')`

**3. 如何正确记录日志？**

A. `console.log('User PIN:', pin)`  
B. `console.log('API Key:', apiKey)`  
C. `console.log('Login successful for:', username)` ✅  
D. `console.log('Session data:', session)`

---

## 🚀 下一步行动

### 个人行动

- [ ] 阅读 `.chainlesschain/QUICK_REFERENCE.md`
- [ ] 运行 `npm run example:database` 学习示例
- [ ] 在自己的代码中运行 `npm run validate:rules`
- [ ] 修复发现的问题

### 团队行动

- [ ] 代码审查时检查安全规范
- [ ] 提交代码前运行验证器
- [ ] 遇到问题查阅 `.chainlesschain/SQL_INJECTION_FIX_GUIDE.md`
- [ ] 发现新问题提交 GitHub Issue

---

## 📞 获取帮助

- **文档**: `.chainlesschain/` 目录
- **示例**: `npm run example:database`
- **工具**: `npm run fix:sql`
- **问题**: GitHub Issues (标签: `rules`, `security`)

---

## 🎓 证书

完成培训并通过测验后，你将获得：

**ChainlessChain 安全编码认证**

- 了解 SQL 注入防护原理
- 掌握 P2P 加密最佳实践
- 能够使用自动化工具
- 遵守团队编码规范

---

**培训师**: ChainlessChain 技术团队  
**培训日期**: 2026-01-16  
**下次培训**: 每月第一个周一

