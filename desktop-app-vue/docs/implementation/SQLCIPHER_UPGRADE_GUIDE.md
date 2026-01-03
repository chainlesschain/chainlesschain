# SQLCipher 数据库加密升级指南

## 概述

本文档介绍如何使用新的 SQLCipher 加密功能来保护你的本地数据库。

## 功能特性

### ✅ 已实现的功能

1. **AES-256 加密**：使用 SQLCipher 4.x 提供的硬件级加密
2. **U-Key 集成**：支持使用 U-Key 硬件派生加密密钥
3. **密码派生**：支持使用用户密码派生加密密钥（PBKDF2）
4. **自动迁移**：首次启动时自动从 sql.js 迁移到 SQLCipher
5. **可选加密**：支持在设置中开启/关闭加密功能
6. **平滑升级**：保留 sql.js 作为 fallback，确保兼容性

### 🔐 加密模式

#### 1. U-Key 模式（推荐）

使用 U-Key 硬件派生数据库加密密钥，提供最高安全级别。

**优势**：
- 密钥存储在硬件中，无法导出
- 抗暴力破解
- 支持多设备同步（通过 U-Key）

**使用方式**：
```javascript
const { createDatabaseAdapter } = require('./src/main/database');

const adapter = await createDatabaseAdapter({
  dbPath: 'path/to/database.db',
  encryptionEnabled: true,
  pin: '123456', // U-Key PIN码
  configPath: 'path/to/key-config.json'
});

const db = await adapter.createDatabase();
```

#### 2. 密码模式

使用用户密码派生加密密钥，适合无硬件设备场景。

**优势**：
- 无需额外硬件
- 跨平台兼容
- 简单易用

**使用方式**：
```javascript
const adapter = await createDatabaseAdapter({
  dbPath: 'path/to/database.db',
  encryptionEnabled: true,
  password: 'your-strong-password',
  configPath: 'path/to/key-config.json'
});

const db = await adapter.createDatabase();
```

## 使用指南

### 1. 新项目（直接使用加密）

```javascript
const { createDatabaseAdapter } = require('./src/main/database');

async function initDatabase() {
  // 创建适配器
  const adapter = await createDatabaseAdapter({
    dbPath: './data/chainlesschain.db',
    encryptionEnabled: true,
    password: 'your-password', // 或使用 pin: 'ukey-pin'
    configPath: './data/key-config.json'
  });

  // 创建数据库
  const db = await adapter.createDatabase();

  // 使用数据库
  db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)');

  // 完成后关闭
  await adapter.close();
}
```

### 2. 现有项目（自动迁移）

如果你已有 sql.js 数据库，适配器会自动执行迁移：

```javascript
const adapter = await createDatabaseAdapter({
  dbPath: './data/chainlesschain.db',  // 现有 sql.js 数据库
  encryptionEnabled: true,
  autoMigrate: true,  // 启用自动迁移（默认）
  password: 'your-password',
  configPath: './data/key-config.json'
});

const db = await adapter.createDatabase();
// 迁移完成后，原数据库会被重命名为 chainlesschain.db.old
// 加密数据库保存为 chainlesschain.encrypted.db
```

### 3. 手动迁移

```javascript
const { migrateDatabase } = require('./src/main/database');

const result = await migrateDatabase({
  sourcePath: './data/chainlesschain.db',
  targetPath: './data/chainlesschain.encrypted.db',
  encryptionKey: 'hex-encoded-key'
});

console.log('迁移完成:', result);
// 输出: { success: true, tablesCount: 10, backupPath: '...' }
```

### 4. 禁用加密（使用 sql.js）

```javascript
const adapter = await createDatabaseAdapter({
  dbPath: './data/chainlesschain.db',
  encryptionEnabled: false  // 禁用加密
});

const db = await adapter.createDatabase();
// 将使用 sql.js，无加密
```

## 密钥管理

### 密钥派生配置

```javascript
// PBKDF2 配置
{
  iterations: 100000,      // 迭代次数
  keyLength: 32,           // 256位密钥
  digest: 'sha256'         // 哈希算法
}
```

### 密钥元数据

密钥元数据（不包含密钥本身）保存在配置文件中：

```json
{
  "method": "password",
  "salt": "hex-encoded-salt",
  "encryptionEnabled": true,
  "version": 1,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### 更换密钥

```javascript
const { createEncryptedDatabase } = require('./src/main/database');

const db = createEncryptedDatabase('./data/database.encrypted.db', 'old-key');
db.open();

// 更换密钥
db.rekey('new-key');

db.close();
```

## 数据迁移

### 迁移流程

1. **备份**：自动创建原数据库备份
2. **迁移表结构**：复制所有表定义
3. **迁移数据**：批量复制所有数据
4. **迁移索引**：重建所有索引
5. **验证**：检查数据完整性
6. **完成**：重命名原数据库

### 迁移回滚

```javascript
const { DatabaseMigrator } = require('./src/main/database');

const migrator = new DatabaseMigrator({
  sourcePath: './data/chainlesschain.db',
  targetPath: './data/chainlesschain.encrypted.db',
  backupPath: './data/chainlesschain.db.backup'
});

try {
  await migrator.migrate();
} catch (error) {
  console.error('迁移失败，执行回滚');
  await migrator.rollback();
}
```

## 集成到 DatabaseManager

修改 `src/main/database.js` 中的 `initialize` 方法：

```javascript
const { createDatabaseAdapter } = require('./database');

async initialize() {
  try {
    // 创建数据库适配器
    this.adapter = await createDatabaseAdapter({
      dbPath: this.dbPath,
      encryptionEnabled: getAppConfig().enableEncryption,
      password: this.password,  // 从用户输入获取
      pin: this.pin,            // 从 U-Key 获取
      configPath: path.join(app.getPath('userData'), 'key-config.json')
    });

    // 创建数据库
    this.db = await this.adapter.createDatabase();

    // 应用兼容性补丁
    this.applyStatementCompat();

    // 创建表
    this.createTables();

    // 运行迁移
    this.runMigrations();

    console.log('数据库初始化成功');
    return true;
  } catch (error) {
    console.error('数据库初始化失败:', error);
    throw error;
  }
}
```

## 安全最佳实践

### 1. 密钥存储

❌ **不要**：
- 将密钥硬编码在代码中
- 将密钥保存在配置文件中
- 将密钥传输到服务器

✅ **应该**：
- 使用 U-Key 派生密钥
- 使用强密码（至少 12 位，包含大小写字母、数字、符号）
- 将密钥保存在内存中，使用完后立即清除

### 2. 密码策略

```javascript
// 验证密码强度
function validatePassword(password) {
  if (password.length < 12) {
    throw new Error('密码至少需要 12 个字符');
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    throw new Error('密码需要包含大小写字母');
  }

  if (!/\d/.test(password)) {
    throw new Error('密码需要包含数字');
  }

  if (!/[!@#$%^&*]/.test(password)) {
    throw new Error('密码需要包含特殊字符');
  }

  return true;
}
```

### 3. 备份策略

- 定期备份加密数据库
- 备份时保持加密状态
- 验证备份完整性
- 安全存储备份密钥

## 性能优化

### SQLCipher vs sql.js

| 指标 | sql.js | SQLCipher |
|------|--------|-----------|
| 读取性能 | 1x | 3-5x ⚡ |
| 写入性能 | 1x | 3-5x ⚡ |
| 内存占用 | 高 📈 | 低 📉 |
| 安全性 | 无加密 ❌ | AES-256 ✅ |
| 跨平台 | ✅ | ✅ |

### 优化建议

1. **批量操作使用事务**：
```javascript
db.getHandle().transaction(() => {
  for (const item of items) {
    stmt.run(item);
  }
})();
```

2. **预编译语句重用**：
```javascript
const stmt = db.prepare('INSERT INTO users VALUES (?, ?)');
for (const user of users) {
  stmt.run(user);
}
stmt.free();
```

## 故障排除

### 问题 1: "Invalid encryption key"

**原因**：密钥不正确或数据库已损坏

**解决**：
1. 确认密码/PIN 正确
2. 检查密钥元数据文件
3. 尝试从备份恢复

### 问题 2: 迁移失败

**原因**：数据库被锁定或权限不足

**解决**：
1. 关闭所有数据库连接
2. 检查文件权限
3. 查看迁移日志

### 问题 3: 性能下降

**原因**：未使用事务进行批量操作

**解决**：
1. 使用事务包装批量操作
2. 启用 WAL 模式：`db.pragma('journal_mode = WAL')`

## 测试

运行数据库加密测试：

```bash
npm run test:db
```

## 参考资料

- [SQLCipher 官方文档](https://www.zetetic.net/sqlcipher/documentation/)
- [@journeyapps/sqlcipher GitHub](https://github.com/journeyapps/node-sqlcipher)
- [PBKDF2 规范](https://tools.ietf.org/html/rfc2898)

## 更新日志

### v1.0.0 (2025-01-15)
- ✅ 实现 SQLCipher 集成
- ✅ 支持 U-Key 密钥派生
- ✅ 自动数据库迁移
- ✅ 可选加密模式
- ✅ 完整文档和测试
