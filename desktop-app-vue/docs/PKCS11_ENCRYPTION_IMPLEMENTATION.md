# PKCS#11 加密/解密实现文档

## 概述

本文档描述了ChainlessChain桌面应用中PKCS#11驱动的加密/解密功能实现，包括原生pkcs11js模块支持和CLI工具fallback方案。

## 实现状态

✅ **已完成** - 2026-01-09

### 功能特性

1. **双模式支持**
   - 原生模式：使用pkcs11js Node.js模块直接调用PKCS#11 API
   - CLI模式：使用OpenSC工具链（pkcs11-tool + OpenSSL）作为fallback

2. **加密功能** (`encrypt`)
   - 原生模式：使用token上的公钥通过PKCS#11 API加密
   - CLI模式：导出公钥 → OpenSSL加密
   - 返回Base64编码的加密数据

3. **解密功能** (`decrypt`)
   - 原生模式：使用token上的私钥通过PKCS#11 API解密
   - CLI模式：使用pkcs11-tool直接在token上解密
   - 返回UTF-8解码的原始数据

4. **安全特性**
   - 私钥永不离开硬件token
   - 临时文件自动清理
   - PIN码保护
   - 完整的错误处理和日志记录

## 技术实现

### 文件位置

- 主实现：`desktop-app-vue/src/main/ukey/pkcs11-driver.js`
- 测试脚本：`desktop-app-vue/scripts/test-pkcs11-encryption.js`

### 核心方法

#### 1. encrypt(data)

加密数据的主方法。

**原生模式流程：**
```javascript
1. 查找token上的公钥对象 (CKO_PUBLIC_KEY)
2. 初始化加密操作 (C_EncryptInit)
3. 执行加密 (C_Encrypt)
4. 返回Base64编码结果
```

**CLI模式流程：**
```javascript
1. 使用pkcs11-tool导出公钥到临时文件
2. 将待加密数据写入临时文件
3. 使用OpenSSL pkeyutl加密
4. 读取加密结果并Base64编码
5. 清理所有临时文件
```

#### 2. decrypt(encryptedData)

解密数据的主方法。

**原生模式流程：**
```javascript
1. 查找token上的私钥对象 (CKO_PRIVATE_KEY)
2. 初始化解密操作 (C_DecryptInit)
3. 执行解密 (C_Decrypt)
4. 返回UTF-8解码结果
```

**CLI模式流程：**
```javascript
1. 将Base64加密数据解码并写入临时文件
2. 使用pkcs11-tool --decrypt在token上解密
3. 读取解密结果
4. 清理所有临时文件
```

### 辅助方法

#### encryptWithCLI(data)

CLI模式加密的具体实现。

**依赖工具：**
- `pkcs11-tool` - 从token导出公钥
- `openssl pkeyutl` - 使用公钥加密数据

**临时文件：**
- `pkcs11-pubkey-{timestamp}.pem` - 导出的公钥
- `pkcs11-data-{timestamp}.txt` - 待加密数据
- `pkcs11-enc-{timestamp}.bin` - 加密结果

#### decryptWithCLI(encryptedData)

CLI模式解密的具体实现。

**依赖工具：**
- `pkcs11-tool --decrypt` - 使用token上的私钥解密

**临时文件：**
- `pkcs11-enc-{timestamp}.bin` - 加密数据
- `pkcs11-dec-{timestamp}.txt` - 解密结果

## 使用方法

### 基本用法

```javascript
const PKCS11Driver = require('./src/main/ukey/pkcs11-driver');

async function example() {
  const driver = new PKCS11Driver();

  // 初始化
  await driver.initialize();

  // 连接（需要PIN码）
  await driver.connect('123456');

  // 加密
  const encrypted = await driver.encrypt('Hello, World!');
  console.log('Encrypted:', encrypted);

  // 解密
  const decrypted = await driver.decrypt(encrypted);
  console.log('Decrypted:', decrypted);

  // 断开连接
  await driver.disconnect();
  await driver.close();
}
```

### 运行测试

```bash
# 进入桌面应用目录
cd desktop-app-vue

# 运行PKCS#11加密测试
npm run test:pkcs11

# 或直接运行脚本
node scripts/test-pkcs11-encryption.js
```

## 系统要求

### 原生模式（推荐）

1. **pkcs11js模块**
   ```bash
   npm install pkcs11js
   ```
   注意：已在package.json的optionalDependencies中配置

2. **PKCS#11库**
   - macOS: OpenSC (`brew install opensc`)
   - Linux: OpenSC (`apt-get install opensc` 或 `yum install opensc`)
   - Windows: OpenSC (https://github.com/OpenSC/OpenSC/releases)

3. **硬件Token**
   - 支持PKCS#11标准的任何硬件token
   - YubiKey、智能卡、HSM等

### CLI模式（Fallback）

1. **OpenSC工具**
   - `pkcs11-tool` - token管理工具
   - 安装方式同上

2. **OpenSSL**
   - 大多数系统预装
   - macOS: 自带或通过Homebrew安装
   - Linux: 通常预装
   - Windows: 需要单独安装

3. **硬件Token**
   - 同原生模式

## 错误处理

### 常见错误及解决方案

1. **"PKCS#11 library not found"**
   - 原因：未安装OpenSC或路径不正确
   - 解决：安装OpenSC并确保库文件在标准路径

2. **"No PKCS#11 tokens detected"**
   - 原因：未插入硬件token或驱动未安装
   - 解决：插入token并安装相应驱动

3. **"Failed to connect: PIN verification failed"**
   - 原因：PIN码错误
   - 解决：使用正确的PIN码（默认通常是123456）

4. **"No public/private key found on token"**
   - 原因：Token未初始化或未生成密钥对
   - 解决：使用pkcs11-tool初始化token并生成密钥对

5. **"CLI encryption/decryption failed"**
   - 原因：OpenSC工具未安装或不在PATH中
   - 解决：安装OpenSC并确保工具可执行

## 安全考虑

### 优势

1. **私钥保护**
   - 私钥永不离开硬件token
   - 所有解密操作在token内部完成

2. **临时文件管理**
   - 所有临时文件在操作完成后立即删除
   - 使用时间戳确保文件名唯一性

3. **PIN码保护**
   - 所有操作需要PIN码验证
   - PIN码不会被记录到日志

### 注意事项

1. **CLI模式限制**
   - 公钥会临时导出到文件系统
   - 虽然会立即删除，但理论上存在被截获的风险
   - 建议优先使用原生模式

2. **数据大小限制**
   - RSA加密有数据大小限制（通常<245字节）
   - 对于大数据，建议使用混合加密方案：
     - 生成随机AES密钥
     - 用AES加密数据
     - 用RSA加密AES密钥

3. **性能考虑**
   - CLI模式比原生模式慢（需要进程调用和文件I/O）
   - 频繁加密/解密操作建议使用原生模式

## 测试覆盖

测试脚本 `test-pkcs11-encryption.js` 包含以下测试用例：

1. ✅ 驱动初始化
2. ✅ 设备信息获取
3. ✅ Token连接（PIN验证）
4. ✅ 数据加密
5. ✅ 数据解密
6. ✅ 数据完整性验证
7. ✅ 不同数据大小测试
8. ✅ 断开连接和清理

## 未来改进

### 计划中的功能

1. **混合加密支持**
   - 自动处理大数据加密
   - AES + RSA混合方案

2. **密钥管理**
   - 密钥生成功能
   - 密钥导入/导出
   - 证书管理

3. **多Token支持**
   - 同时管理多个token
   - Token选择界面

4. **性能优化**
   - 公钥缓存（CLI模式）
   - 批量操作支持

5. **更多加密算法**
   - ECC支持
   - 不同的padding方案

## 相关文档

- [U-Key集成文档](./UKEY_INTEGRATION.md)
- [安全架构文档](./SECURITY_ARCHITECTURE.md)
- [PKCS#11标准](https://docs.oasis-open.org/pkcs11/pkcs11-base/v2.40/pkcs11-base-v2.40.html)
- [OpenSC项目](https://github.com/OpenSC/OpenSC)

## 变更日志

### 2026-01-09
- ✅ 实现CLI模式加密功能（encryptWithCLI）
- ✅ 实现CLI模式解密功能（decryptWithCLI）
- ✅ 添加完整的错误处理和日志
- ✅ 实现临时文件自动清理
- ✅ 创建测试脚本和文档
- ✅ 添加npm测试命令

### 之前版本
- ✅ 原生pkcs11js模式实现
- ✅ 基础PKCS#11驱动框架
- ✅ 签名/验证功能

## 贡献者

- ChainlessChain Team
- Claude Code (AI Assistant)

## 许可证

MIT License - 详见项目根目录LICENSE文件
