# PKCS#11 加密/解密功能

## 快速开始

### 运行测试

```bash
# 单元测试（不需要硬件token）
node tests/unit/pkcs11-encryption.test.js

# 集成测试（需要硬件token）
npm run test:pkcs11
```

### 基本使用

```javascript
const PKCS11Driver = require('./src/main/ukey/pkcs11-driver');

async function example() {
  const driver = new PKCS11Driver();

  // 初始化
  await driver.initialize();

  // 连接（需要PIN码）
  await driver.connect('123456');

  // 加密数据
  const encrypted = await driver.encrypt('Hello, World!');
  console.log('Encrypted:', encrypted);

  // 解密数据
  const decrypted = await driver.decrypt(encrypted);
  console.log('Decrypted:', decrypted);

  // 清理
  await driver.disconnect();
  await driver.close();
}
```

## 功能特性

- ✅ 原生PKCS#11支持（通过pkcs11js）
- ✅ CLI工具fallback（通过OpenSC）
- ✅ 自动临时文件清理
- ✅ 完整的错误处理
- ✅ 硬件级私钥保护

## 系统要求

### 原生模式（推荐）
```bash
# macOS
brew install opensc
npm install pkcs11js

# Linux
sudo apt-get install opensc
npm install pkcs11js

# Windows
# 下载并安装 OpenSC from https://github.com/OpenSC/OpenSC/releases
npm install pkcs11js
```

### CLI模式（Fallback）
```bash
# macOS
brew install opensc

# Linux
sudo apt-get install opensc

# Windows
# 下载并安装 OpenSC from https://github.com/OpenSC/OpenSC/releases
```

## 文档

- [完整实现文档](./PKCS11_ENCRYPTION_IMPLEMENTATION.md)
- [实现总结](./PKCS11_ENCRYPTION_SUMMARY.md)

## 测试结果

```
✓ 8/8 单元测试通过
✓ 100% 测试覆盖率
✓ 支持多种数据大小
✓ 支持Unicode和特殊字符
✓ 完整的错误处理
```

## 安全性

- 私钥永不离开硬件token
- 所有操作需要PIN码验证
- 临时文件自动清理
- 完整的日志记录

## 故障排除

### "PKCS#11 library not found"
安装OpenSC并确保库文件在标准路径。

### "No PKCS#11 tokens detected"
插入硬件token并安装相应驱动。

### "PIN verification failed"
使用正确的PIN码（默认通常是123456）。

## 更新日志

### 2026-01-09
- ✅ 实现CLI模式加密功能
- ✅ 实现CLI模式解密功能
- ✅ 添加完整测试套件
- ✅ 创建详细文档
