# ChainlessChain 编码规范与安全规则

本文档定义 ChainlessChain 项目的编码规范和安全规则，所有代码提交必须遵守这些规则。

## 1. 安全规范

### 1.1 SQL 注入防护

**强制规则**：所有数据库查询必须使用参数化查询（Prepared Statements）

#### ✅ 正确示例

```javascript
// SQLite (desktop-app-vue)
db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)').run(title, content);

// 使用 IN 子句
const placeholders = ids.map(() => '?').join(',');
db.prepare(`SELECT * FROM notes WHERE id IN (${placeholders})`).all(...ids);
```

#### ❌ 错误示例

```javascript
// 直接拼接 SQL - 禁止！
db.exec(`SELECT * FROM notes WHERE id = ${noteId}`);
db.exec(`INSERT INTO notes (title, content) VALUES ('${title}', '${content}')`);
```

#### MyBatis 规范 (Java Backend)

```xml
<!-- 使用 #{} 而非 ${} -->
<select id="selectNote" resultType="Note">
  SELECT * FROM notes WHERE id = #{id}
</select>

<!-- 动态 IN 子句 -->
<select id="selectNotes" resultType="Note">
  SELECT * FROM notes WHERE id IN
  <foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
</select>
```

**检查规则**：
- JavaScript: 禁止使用 `db.exec()` 或模板字符串拼接 SQL
- Java: 禁止 MyBatis 中使用 `${}`（除非用于表名/列名等元数据，且必须有白名单验证）

---

### 1.2 P2P 加密与安全通信

**强制规则**：所有 P2P 消息必须使用 E2E 加密（Signal Protocol）

#### ✅ 正确示例

```javascript
// 发送加密消息
async function sendEncryptedMessage(recipientDID, message) {
  // 1. 加载或建立 Signal Protocol 会话
  const session = await getSignalSession(recipientDID);

  // 2. 加密消息
  const encryptedData = await session.encrypt(message);

  // 3. 通过 libp2p 发送
  await p2pNode.pubsub.publish(recipientDID, encryptedData);
}

// 接收消息解密
libp2pNode.pubsub.on('message', async (msg) => {
  const session = await getSignalSession(msg.from);
  const decrypted = await session.decrypt(msg.data);
  // 处理解密后的消息
});
```

#### ❌ 错误示例

```javascript
// 明文传输 - 禁止！
await p2pNode.pubsub.publish(recipientDID, plainMessage);

// 自定义弱加密算法 - 禁止！
const encrypted = Buffer.from(message).toString('base64'); // Base64 不是加密！
```

**检查规则**：
- 所有 `p2pNode.pubsub.publish()` 调用前必须经过 Signal Protocol 加密
- 禁止使用 Base64、ROT13 等编码方式代替加密
- 禁止自行实现加密算法（使用标准库：Signal Protocol, node-forge, WebCrypto）

---

### 1.3 数据库加密

**强制规则**：敏感数据库必须启用 SQLCipher 加密

#### ✅ 正确示例

```javascript
const Database = require('better-sqlite3');
const db = new Database('data/chainlesschain.db');

// 启用 SQLCipher
const encryptionKey = await getUKeyDerivedKey(); // 从 U-Key 派生密钥
db.pragma(`key = '${encryptionKey}'`);
db.pragma('cipher_page_size = 4096');
db.pragma('kdf_iter = 256000');
```

#### ❌ 错误示例

```javascript
// 未加密数据库 - 仅允许用于临时/缓存数据
const db = new Database('data/plaintext.db'); // 没有设置 key
```

**检查规则**：
- 主数据库文件（`chainlesschain.db`）必须设置 `pragma key`
- 加密密钥必须从 U-Key 或用户密码派生，禁止硬编码
- KDF 迭代次数不得低于 64000

---

### 1.4 U-Key 安全

**强制规则**：U-Key PIN 码必须安全存储和传输

#### ✅ 正确示例

```javascript
// 从用户输入获取 PIN（内存中处理，不记录日志）
const pin = await promptUserForPIN(); // 使用 password input

// 验证后立即清除
const verified = await ukey.verify(pin);
pin = null; // 清除引用

// 模拟模式下使用环境变量
const simulationPIN = process.env.UKEY_SIMULATION_PIN || '123456';
```

#### ❌ 错误示例

```javascript
// 硬编码 PIN - 禁止！
const pin = '123456';

// 记录 PIN 到日志 - 禁止！
console.log('User PIN:', pin);

// 明文存储 PIN - 禁止！
localStorage.setItem('pin', pin);
```

**检查规则**：
- 禁止硬编码 PIN 码（除了默认演示值 `123456` 在模拟模式下）
- 禁止在日志、控制台、文件中记录 PIN
- PIN 验证后必须立即清除内存引用

---

## 2. 代码质量规范

### 2.1 错误处理

**强制规则**：所有异步操作必须有错误处理

#### ✅ 正确示例

```javascript
// Try-catch
try {
  const result = await someDatabaseOperation();
  return result;
} catch (error) {
  console.error('Database operation failed:', error.message);
  throw new Error('Failed to complete operation');
}

// IPC 错误处理
ipcMain.handle('database:query', async (event, sql) => {
  try {
    return { success: true, data: db.prepare(sql).all() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

#### ❌ 错误示例

```javascript
// 缺少错误处理 - 禁止！
const result = await someDatabaseOperation();

// 忽略错误 - 禁止！
try {
  await riskyOperation();
} catch (e) {
  // 空 catch 块
}
```

---

### 2.2 输入验证

**强制规则**：所有外部输入必须验证

#### ✅ 正确示例

```javascript
// 类型验证
function createNote(title, content) {
  if (typeof title !== 'string' || title.length === 0) {
    throw new Error('Invalid title');
  }
  if (typeof content !== 'string') {
    throw new Error('Invalid content');
  }
  // 长度限制
  if (title.length > 500) {
    throw new Error('Title too long');
  }
  return db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)').run(title, content);
}

// DID 格式验证
function validateDID(did) {
  const didRegex = /^did:key:[a-zA-Z0-9]+$/;
  if (!didRegex.test(did)) {
    throw new Error('Invalid DID format');
  }
  return did;
}
```

#### ❌ 错误示例

```javascript
// 无验证直接使用 - 禁止！
function createNote(title, content) {
  return db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)').run(title, content);
}
```

**检查规则**：
- IPC handler 的所有参数必须验证类型和范围
- 文件路径必须验证（防止路径遍历攻击）
- DID/地址格式必须使用正则表达式验证

---

### 2.3 依赖项安全

**强制规则**：定期检查和更新依赖项

```bash
# 检查漏洞
npm audit

# 自动修复（谨慎使用）
npm audit fix

# 检查过期依赖
npm outdated
```

**已知兼容性要求**：
- MyBatis Plus: 必须 >= 3.5.9（Spring Boot 3.x 兼容性）
- Ollama Python 客户端: `httpx<0.26.0`（避免兼容性问题）
- Electron: >= 39.x（安全更新）

---

## 3. 架构规范

### 3.1 分层架构

```
┌─────────────────────────────────────┐
│  Renderer Process (Vue3 Frontend)  │
│  - UI Components                    │
│  - Pinia Stores                     │
│  - IPC Client                       │
└─────────────────────────────────────┘
              ↕ IPC
┌─────────────────────────────────────┐
│  Main Process (Electron Backend)    │
│  - IPC Handlers                     │
│  - Business Logic                   │
│  - Database Access                  │
│  - External Service Integration     │
└─────────────────────────────────────┘
              ↕
┌─────────────────────────────────────┐
│  External Services                  │
│  - Ollama (LLM)                     │
│  - Qdrant (Vector DB)               │
│  - Project Service (Spring Boot)    │
└─────────────────────────────────────┘
```

**规则**：
- Renderer 进程不得直接访问数据库或文件系统（使用 IPC）
- Main 进程不得直接操作 DOM（通过 IPC 发送事件）
- 所有跨进程通信必须通过 IPC 通道

---

### 3.2 模块职责

| 模块 | 职责 | 禁止操作 |
|------|------|----------|
| `database.js` | 数据库初始化、Schema 管理 | 业务逻辑 |
| `llm/index.js` | LLM 调用封装 | 直接修改数据库 |
| `rag/index.js` | RAG 检索与重排序 | UI 交互 |
| `p2p/index.js` | P2P 网络管理 | 存储明文消息 |
| `ukey/index.js` | U-Key 硬件交互 | 记录 PIN 日志 |

---

## 4. 测试规范

### 4.1 单元测试覆盖

**强制要求**：
- 核心业务逻辑测试覆盖率 >= 70%
- 安全相关模块（加密、验证）>= 90%

```javascript
// 示例：测试 SQL 注入防护
describe('Database Security', () => {
  it('should prevent SQL injection in note queries', () => {
    const maliciousInput = "1' OR '1'='1";
    const result = db.prepare('SELECT * FROM notes WHERE id = ?').get(maliciousInput);
    expect(result).toBeUndefined(); // 应返回 undefined 而非所有记录
  });
});
```

---

## 5. 代码审查清单

提交代码前请检查：

- [ ] 所有数据库查询使用参数化查询
- [ ] P2P 消息已加密（Signal Protocol）
- [ ] 敏感数据库已启用 SQLCipher
- [ ] U-Key PIN 未硬编码或记录日志
- [ ] 所有异步操作有 try-catch
- [ ] 外部输入已验证（类型、格式、范围）
- [ ] 无 `console.log` 泄露敏感信息
- [ ] 依赖项无已知漏洞（`npm audit`）
- [ ] 符合分层架构（Renderer 不直接访问数据库）
- [ ] 代码注释清晰（复杂逻辑必须注释）
- [ ] 遵循 Conventional Commits 规范

---

## 6. Git 提交规范

### 6.1 Commit Message 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type 类型**：
- `feat`: 新功能
- `fix`: Bug 修复
- `security`: 安全问题修复（高优先级）
- `docs`: 文档更新
- `refactor`: 重构（不改变功能）
- `test`: 添加测试
- `chore`: 构建/工具链更新
- `perf`: 性能优化

**Scope 范围**：
- `ukey`: U-Key 模块
- `p2p`: P2P 网络
- `rag`: RAG 检索
- `database`: 数据库
- `llm`: LLM 集成
- `social`: 社交功能
- `trade`: 交易系统

**示例**：

```
security(database): 修复 SQL 注入漏洞

- 将所有 db.exec() 替换为 db.prepare()
- 添加输入验证（title 长度限制 500 字符）
- 增加单元测试覆盖注入场景

Fixes #123
```

---

## 7. 自动化检查

本项目使用 `RulesValidator` 自动检查代码规范，检查项包括：

1. **SQL 注入检测**：扫描 `.js` 文件中的 `db.exec()` 和字符串拼接
2. **P2P 加密检测**：检查 `p2pNode.pubsub.publish()` 前是否加密
3. **敏感信息泄露**：检测日志中的 PIN、密钥、密码
4. **依赖项漏洞**：运行 `npm audit`（阻塞 >= high severity）

运行检查：

```bash
# 在 desktop-app-vue 目录
npm run validate:rules

# 或手动运行
node scripts/rules-validator.js
```

---

## 附录：工具与资源

- **SQL 注入学习**：[OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)
- **Signal Protocol 文档**：[@privacyresearch/libsignal-protocol-typescript](https://github.com/privacyresearch/libsignal-protocol-typescript)
- **SQLCipher 配置**：[SQLCipher Documentation](https://www.zetetic.net/sqlcipher/sqlcipher-api/)
- **安全编码指南**：[Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

**最后更新**：2026-01-16
**版本**：v1.0.0
