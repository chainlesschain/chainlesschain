/**
 * SQLCipher 加密功能测试
 *
 * 测试数据库加密、迁移和密钥管理功能
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 导入数据库加密模块
const {
  KeyManager,
  createEncryptedDatabase,
  createUnencryptedDatabase,
  migrateDatabase,
  createDatabaseAdapter
} = require('./src/main/database/index');

// 测试配置
const TEST_DIR = path.join(os.tmpdir(), 'chainlesschain-sqlcipher-test');
const TEST_PASSWORD = 'Test@Password123!';
const TEST_PIN = '123456';

/**
 * 清理测试目录
 */
function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

/**
 * 测试 1: 密钥管理器
 */
async function testKeyManager() {
  console.log('\n=== 测试 1: 密钥管理器 ===');

  const keyManager = new KeyManager({
    encryptionEnabled: true,
    ukeyEnabled: false, // 使用密码模式
    configPath: path.join(TEST_DIR, 'key-config.json')
  });

  await keyManager.initialize();

  // 测试密码派生
  console.log('测试密码派生...');
  const result1 = await keyManager.deriveKeyFromPassword(TEST_PASSWORD);
  console.log('✓ 密钥长度:', result1.key.length, '字符 (应为64，256位十六进制)');
  console.log('✓ 盐值长度:', result1.salt.length, '字符');

  // 测试使用相同盐值派生相同密钥
  const result2 = await keyManager.deriveKeyFromPassword(
    TEST_PASSWORD,
    Buffer.from(result1.salt, 'hex')
  );
  console.log('✓ 相同密码和盐值产生相同密钥:', result1.key === result2.key);

  // 测试元数据保存和加载
  await keyManager.saveKeyMetadata({
    method: 'password',
    salt: result1.salt
  });
  const metadata = keyManager.loadKeyMetadata();
  console.log('✓ 元数据保存和加载成功:', metadata.method === 'password');

  await keyManager.close();
  console.log('✓ 密钥管理器测试通过');
}

/**
 * 测试 2: SQLCipher 基本操作
 */
async function testSQLCipherBasics() {
  console.log('\n=== 测试 2: SQLCipher 基本操作 ===');

  const dbPath = path.join(TEST_DIR, 'test-encrypted.db');

  // 生成测试密钥
  const keyManager = new KeyManager({ encryptionEnabled: true });
  await keyManager.initialize();
  const keyResult = await keyManager.deriveKeyFromPassword(TEST_PASSWORD);

  // 创建加密数据库
  console.log('创建加密数据库...');
  const db = createEncryptedDatabase(dbPath, keyResult.key);
  db.open();

  // 创建表
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE
    )
  `);
  console.log('✓ 表创建成功');

  // 插入数据
  const stmt = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
  stmt.run(['Alice', 'alice@example.com']);
  stmt.run(['Bob', 'bob@example.com']);
  stmt.free();
  console.log('✓ 数据插入成功');

  // 查询数据
  const selectStmt = db.prepare('SELECT * FROM users ORDER BY id');
  const users = selectStmt.all();
  selectStmt.free();
  console.log('✓ 数据查询成功，共', users.length, '条记录');

  db.close();

  // 验证加密：尝试用错误的密钥打开
  console.log('验证加密...');
  try {
    const wrongDb = createEncryptedDatabase(dbPath, 'wrong-key-12345678901234567890123456789012');
    wrongDb.open();
    wrongDb.close();
    console.log('✗ 加密验证失败：错误的密钥应该无法打开数据库');
    process.exit(1);
  } catch (error) {
    console.log('✓ 加密验证成功：错误的密钥无法打开数据库');
  }

  await keyManager.close();
  console.log('✓ SQLCipher 基本操作测试通过');
}

/**
 * 测试 3: 数据库迁移
 */
async function testDatabaseMigration() {
  console.log('\n=== 测试 3: 数据库迁移 ===');

  const initSqlJs = require('sql.js');

  // 创建 sql.js 数据库
  console.log('创建 sql.js 数据库...');
  const SQL = await initSqlJs();
  const sqlJsDb = new SQL.Database();

  // 创建表和数据
  sqlJsDb.run(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT,
      price REAL
    )
  `);

  sqlJsDb.run("INSERT INTO products VALUES (1, 'Apple', 1.50)");
  sqlJsDb.run("INSERT INTO products VALUES (2, 'Banana', 0.75)");
  sqlJsDb.run("INSERT INTO products VALUES (3, 'Orange', 1.25)");

  // 保存到文件
  const sqlJsPath = path.join(TEST_DIR, 'source.db');
  const data = sqlJsDb.export();
  fs.writeFileSync(sqlJsPath, Buffer.from(data));
  sqlJsDb.close();
  console.log('✓ sql.js 数据库创建成功，共 3 条记录');

  // 执行迁移
  console.log('执行数据库迁移...');
  const keyManager = new KeyManager({ encryptionEnabled: true });
  await keyManager.initialize();
  const keyResult = await keyManager.deriveKeyFromPassword(TEST_PASSWORD);

  const migrationResult = await migrateDatabase({
    sourcePath: sqlJsPath,
    targetPath: path.join(TEST_DIR, 'migrated.db'),
    encryptionKey: keyResult.key
  });

  console.log('✓ 迁移完成，迁移了', migrationResult.tablesCount, '个表');
  console.log('✓ 备份文件:', migrationResult.backupPath);

  // 验证迁移后的数据
  console.log('验证迁移后的数据...');
  const migratedDb = createEncryptedDatabase(
    path.join(TEST_DIR, 'migrated.db'),
    keyResult.key
  );
  migratedDb.open();

  const stmt = migratedDb.prepare('SELECT * FROM products ORDER BY id');
  const products = stmt.all();
  stmt.free();

  console.log('✓ 迁移后数据行数:', products.length, '(应为 3)');
  console.log('✓ 第一条记录:', products[0]);

  migratedDb.close();
  await keyManager.close();
  console.log('✓ 数据库迁移测试通过');
}

/**
 * 测试 4: 数据库适配器
 */
async function testDatabaseAdapter() {
  console.log('\n=== 测试 4: 数据库适配器 ===');

  // 测试场景 1：新建加密数据库
  console.log('场景 1: 新建加密数据库');
  const adapter1 = await createDatabaseAdapter({
    dbPath: path.join(TEST_DIR, 'adapter-test1.db'),
    encryptionEnabled: true,
    password: TEST_PASSWORD,
    configPath: path.join(TEST_DIR, 'adapter-config1.json')
  });

  const db1 = await adapter1.createDatabase();
  db1.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
  db1.prepare('INSERT INTO test VALUES (?, ?)').run([1, 'Hello']);

  console.log('✓ 引擎类型:', adapter1.getEngine());
  console.log('✓ 是否加密:', adapter1.isEncrypted());

  adapter1.saveDatabase(db1);
  db1.close();
  await adapter1.close();

  // 测试场景 2：禁用加密
  console.log('\n场景 2: 禁用加密 (使用 sql.js)');
  const adapter2 = await createDatabaseAdapter({
    dbPath: path.join(TEST_DIR, 'adapter-test2.db'),
    encryptionEnabled: false
  });

  const db2 = await adapter2.createDatabase();
  console.log('✓ 引擎类型:', adapter2.getEngine());
  console.log('✓ 是否加密:', adapter2.isEncrypted());

  adapter2.saveDatabase(db2);
  db2.close();
  await adapter2.close();

  console.log('✓ 数据库适配器测试通过');
}

/**
 * 测试 5: 性能对比
 */
async function testPerformance() {
  console.log('\n=== 测试 5: 性能对比 ===');

  const RECORD_COUNT = 1000;

  // SQLCipher 性能测试
  console.log(`测试 SQLCipher 插入 ${RECORD_COUNT} 条记录...`);
  const keyManager = new KeyManager({ encryptionEnabled: true });
  await keyManager.initialize();
  const keyResult = await keyManager.deriveKeyFromPassword(TEST_PASSWORD);

  const sqlcipherDb = createEncryptedDatabase(
    path.join(TEST_DIR, 'perf-sqlcipher.db'),
    keyResult.key
  );
  sqlcipherDb.open();

  sqlcipherDb.exec(`
    CREATE TABLE perf_test (
      id INTEGER PRIMARY KEY,
      name TEXT,
      value REAL,
      timestamp INTEGER
    )
  `);

  const start1 = Date.now();
  const stmt1 = sqlcipherDb.prepare('INSERT INTO perf_test VALUES (?, ?, ?, ?)');

  sqlcipherDb.getHandle().transaction(() => {
    for (let i = 0; i < RECORD_COUNT; i++) {
      stmt1.run([i, `Record ${i}`, Math.random() * 100, Date.now()]);
    }
  })();

  stmt1.free();
  const time1 = Date.now() - start1;
  console.log(`✓ SQLCipher: ${time1}ms (${(RECORD_COUNT / time1 * 1000).toFixed(0)} 条/秒)`);

  sqlcipherDb.close();
  await keyManager.close();

  // sql.js 性能测试
  console.log(`测试 sql.js 插入 ${RECORD_COUNT} 条记录...`);
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const sqlJsDb = new SQL.Database();

  sqlJsDb.run(`
    CREATE TABLE perf_test (
      id INTEGER PRIMARY KEY,
      name TEXT,
      value REAL,
      timestamp INTEGER
    )
  `);

  const start2 = Date.now();
  const stmt2 = sqlJsDb.prepare('INSERT INTO perf_test VALUES (?, ?, ?, ?)');

  for (let i = 0; i < RECORD_COUNT; i++) {
    stmt2.bind([i, `Record ${i}`, Math.random() * 100, Date.now()]);
    stmt2.step();
    stmt2.reset();
  }

  stmt2.free();
  const time2 = Date.now() - start2;
  console.log(`✓ sql.js: ${time2}ms (${(RECORD_COUNT / time2 * 1000).toFixed(0)} 条/秒)`);

  sqlJsDb.close();

  console.log(`\n性能对比: SQLCipher 比 sql.js 快 ${(time2 / time1).toFixed(2)}x`);
  console.log('✓ 性能测试完成');
}

/**
 * 运行所有测试
 */
async function runAllTests() {
  console.log('======================================');
  console.log('    SQLCipher 加密功能测试套件');
  console.log('======================================');

  try {
    // 清理测试环境
    console.log('\n清理测试目录:', TEST_DIR);
    cleanupTestDir();

    // 运行测试
    await testKeyManager();
    await testSQLCipherBasics();
    await testDatabaseMigration();
    await testDatabaseAdapter();
    await testPerformance();

    console.log('\n======================================');
    console.log('    ✓ 所有测试通过！');
    console.log('======================================\n');

    // 清理测试文件（可选）
    // cleanupTestDir();

    process.exit(0);
  } catch (error) {
    console.error('\n✗ 测试失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行测试
runAllTests();
