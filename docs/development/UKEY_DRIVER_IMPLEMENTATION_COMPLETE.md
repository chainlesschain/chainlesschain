# U盾驱动完善报告

## 📋 概述

本文档记录了 U盾（USB Key）驱动系统的完善情况，包括 FeiTian（飞天诚信）和 WatchData（握奇）驱动的实现状态。

**完成时间**: 2026-01-09
**版本**: v0.20.0
**状态**: ✅ 基础框架完成，模拟模式可用

---

## 🏗️ 架构设计

### 驱动层次结构

```
BaseUKeyDriver (基类)
    ↓
SKFDriver (SKF标准驱动基类)
    ↓
├── FeiTianDriver (飞天诚信驱动)
├── WatchDataDriver (握奇驱动)
├── HuaDaDriver (华大驱动)
├── TDRDriver (天地融驱动)
└── XinJinKeDriver (新进科驱动)
```

### 支持的U盾品牌

| 品牌 | 驱动类 | 状态 | DLL文件 | 支持产品 |
|------|--------|------|---------|----------|
| **飞天诚信** | FeiTianDriver | ✅ 完成 | FT_SKFAPI.dll, ft2k.dll | ePass1000/2000/3000, ePass NG |
| **握奇** | WatchDataDriver | ✅ 完成 | WDSKFAPI.dll, WatchData.dll | WatchKey系列, TimeCOS |
| **华大** | HuaDaDriver | ✅ 完成 | HDDLL.dll | 华大系列 |
| **天地融** | TDRDriver | ✅ 完成 | TDR_SKFAPI.dll | 天地融系列 |
| **新进科** | XinJinKeDriver | ✅ 完成 | XJKDLL.dll | 新进科系列 |

---

## ✅ FeiTian（飞天诚信）驱动

### 支持的产品系列

1. **ePass1000** - 基础型USB Key
2. **ePass2000** - 标准型USB Key
3. **ePass3000** - 高级型USB Key
4. **ePass NG系列** - 新一代产品

### DLL文件查找路径

驱动会按以下顺序查找DLL文件：

1. **项目资源目录**
   ```
   resources/native/feitian/FT_SKFAPI.dll
   resources/native/feitian/ft2k.dll
   resources/native/feitian/ShuttleCsp11_3003.dll
   ```

2. **系统目录**
   ```
   C:\Windows\System32\FT_SKFAPI.dll
   C:\Windows\System32\ft2k.dll
   C:\Windows\SysWOW64\FT_SKFAPI.dll
   ```

3. **程序安装目录**
   ```
   C:\Program Files\FeiTian\ePass\FT_SKFAPI.dll
   C:\Program Files (x86)\FeiTian\ePass\FT_SKFAPI.dll
   ```

### 实现的功能

#### 基础功能
- ✅ 设备检测和连接
- ✅ PIN码验证
- ✅ 设备信息读取
- ✅ 设备健康检查

#### 高级功能
- ✅ 设备序列号读取
- ✅ 设备证书获取
- ✅ 自动故障转移到模拟模式

### 使用示例

```javascript
const FeiTianDriver = require('./feitian-driver');

// 创建驱动实例
const driver = new FeiTianDriver({
  dllPath: 'C:\\Windows\\System32\\FT_SKFAPI.dll', // 可选
  applicationName: 'ChainlessChain',
  userPin: '123456'
});

// 初始化
await driver.initialize();

// 检测设备
const result = await driver.detect();
if (result.detected) {
  console.log('飞天诚信U盾已连接');
  console.log('制造商:', result.manufacturer);
  console.log('型号:', result.model);
}

// 解锁设备
await driver.unlock('123456');

// 获取设备信息
const info = await driver.getDeviceInfo();
console.log('设备信息:', info);

// 获取序列号
const serial = await driver.getDeviceSerial();
console.log('序列号:', serial);

// 检查健康状态
const health = await driver.checkDeviceHealth();
console.log('健康状态:', health);
```

---

## ✅ WatchData（握奇）驱动

### 支持的产品系列

1. **WatchKey系列** - 标准USB Key
2. **TimeCOS系列** - 金融级USB Key
3. **握奇金融USB Key** - 银行专用

### DLL文件查找路径

驱动会按以下顺序查找DLL文件：

1. **项目资源目录**
   ```
   resources/native/watchdata/WDSKFAPI.dll
   resources/native/watchdata/WatchData.dll
   resources/native/watchdata/TimeCOS.dll
   ```

2. **系统目录**
   ```
   C:\Windows\System32\WDSKFAPI.dll
   C:\Windows\System32\WatchData.dll
   C:\Windows\SysWOW64\WDSKFAPI.dll
   ```

3. **程序安装目录**
   ```
   C:\Program Files\WatchData\WDSKFAPI.dll
   C:\Program Files\WatchData\WatchKey\WDSKFAPI.dll
   C:\Program Files\WatchData\TimeCOS\TimeCOS.dll
   ```

### 实现的功能

#### 基础功能
- ✅ 设备检测和连接
- ✅ PIN码验证
- ✅ 设备信息读取
- ✅ 设备健康检查

#### 高级功能
- ✅ 设备序列号读取
- ✅ 设备证书获取
- ✅ 设备标签设置
- ✅ 自动故障转移到模拟模式

### 使用示例

```javascript
const WatchDataDriver = require('./watchdata-driver');

// 创建驱动实例
const driver = new WatchDataDriver({
  dllPath: 'C:\\Windows\\System32\\WDSKFAPI.dll', // 可选
  applicationName: 'ChainlessChain',
  userPin: '123456'
});

// 初始化
await driver.initialize();

// 检测设备
const result = await driver.detect();
if (result.detected) {
  console.log('握奇U盾已连接');
  console.log('制造商:', result.manufacturer);
  console.log('型号:', result.model);
}

// 解锁设备
await driver.unlock('123456');

// 获取设备信息
const info = await driver.getDeviceInfo();
console.log('设备信息:', info);

// 设置设备标签
await driver.setDeviceLabel('我的U盾');

// 获取序列号
const serial = await driver.getDeviceSerial();
console.log('序列号:', serial);
```

---

## 🔧 配置系统

### 配置文件位置

```
%APPDATA%/chainlesschain/ukey-config.json
```

### 默认配置

```json
{
  "driverType": "xinjinke",
  "dllPath": null,
  "timeout": 30000,
  "autoLock": true,
  "autoLockTimeout": 300,
  "monitorInterval": 5000,
  "debug": false,
  "simulationMode": false,
  "driverOptions": {
    "xinjinke": {
      "defaultPassword": "888888"
    },
    "feitian": {},
    "watchdata": {},
    "huada": {
      "supportSM": true
    },
    "tdr": {
      "paymentMode": false
    }
  }
}
```

### 配置管理

```javascript
const { getUKeyConfig } = require('./config');

// 获取配置实例
const config = getUKeyConfig();

// 读取配置
const driverType = config.getDriverType();
const timeout = config.getTimeout();

// 修改配置
config.setDriverType('feitian');
config.setTimeout(60000);
config.setAutoLock(true, 600);

// 保存配置
config.save();

// 获取驱动特定选项
const options = config.getDriverOptions('feitian');

// 设置驱动特定选项
config.setDriverOptions('feitian', {
  customOption: 'value'
});
```

---

## 🎭 模拟模式

### 模拟模式特性

当无法找到实际的U盾DLL文件时，驱动会自动切换到模拟模式，用于开发和测试。

#### 模拟功能

1. **设备检测** - 返回模拟的检测结果
2. **PIN验证** - 接受任何PIN码
3. **数据加密/解密** - 使用Node.js crypto模块模拟
4. **签名/验签** - 使用模拟的密钥对
5. **设备信息** - 返回模拟的设备信息

#### 启用模拟模式

```javascript
// 方法1: 配置文件
config.setSimulationMode(true);

// 方法2: 驱动初始化时
const driver = new FeiTianDriver({
  simulationMode: true
});

// 方法3: 自动启用（DLL不存在时）
// 驱动会自动检测并启用模拟模式
```

#### 模拟模式标识

```javascript
// 检查是否在模拟模式
if (driver.simulationMode) {
  console.log('当前运行在模拟模式');
}

// 获取设备信息时会包含模拟标识
const info = await driver.getDeviceInfo();
console.log('模拟模式:', info.simulationMode);
```

---

## 🔐 安全特性

### PIN码管理

1. **PIN码验证**
   - 支持用户PIN和管理员PIN
   - 自动重试机制
   - 锁定保护（默认6次失败后锁定）

2. **自动锁定**
   - 可配置的超时时间（默认5分钟）
   - 空闲自动锁定
   - 手动锁定支持

3. **PIN码修改**
   - 支持用户PIN修改
   - 支持管理员PIN修改
   - 需要旧PIN验证

### 数据加密

1. **对称加密**
   - 支持SM4（国密）
   - 支持AES
   - 支持3DES

2. **非对称加密**
   - 支持SM2（国密）
   - 支持RSA
   - 支持ECC

3. **数字签名**
   - 支持SM2签名
   - 支持RSA签名
   - 支持ECDSA签名

---

## 📊 技术指标

### 支持的功能

| 功能类别 | FeiTian | WatchData | 其他品牌 |
|---------|---------|-----------|----------|
| 设备检测 | ✅ | ✅ | ✅ |
| PIN验证 | ✅ | ✅ | ✅ |
| 数据加密 | ✅ | ✅ | ✅ |
| 数字签名 | ✅ | ✅ | ✅ |
| 证书管理 | ✅ | ✅ | ✅ |
| 序列号读取 | ✅ | ✅ | ⚠️ |
| 设备标签 | ⚠️ | ✅ | ⚠️ |
| 健康检查 | ✅ | ✅ | ✅ |
| 模拟模式 | ✅ | ✅ | ✅ |

### 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| Windows | ✅ 完全支持 | 通过Koffi FFI调用DLL |
| macOS | ⚠️ 模拟模式 | 硬件支持待实现 |
| Linux | ⚠️ 模拟模式 | 硬件支持待实现 |

---

## 🐛 已知问题

### 1. Windows平台限制

**问题**: 仅支持Windows平台的硬件U盾
**原因**: 使用Koffi FFI调用Windows DLL
**解决方案**:
- macOS/Linux使用模拟模式
- 未来可能支持PKCS#11标准（跨平台）

### 2. DLL版本兼容性

**问题**: 不同版本的DLL可能有API差异
**影响**: 某些功能可能不可用
**解决方案**:
- 提供多个DLL路径选项
- 自动检测DLL版本
- 降级到基础功能

### 3. 设备热插拔

**问题**: 设备拔出后需要重新初始化
**影响**: 用户体验
**解决方案**:
- 实现设备监控（已有基础）
- 自动重连机制
- 状态通知

### 4. 并发访问

**问题**: 多个进程同时访问U盾可能冲突
**影响**: 操作失败
**解决方案**:
- 实现设备锁机制
- 队列化请求
- 错误重试

---

## 📝 使用指南

### 安装U盾驱动

#### FeiTian（飞天诚信）

1. 下载驱动: https://www.ftsafe.com/support/download
2. 安装驱动程序
3. 插入U盾
4. 验证安装: 检查 `C:\Windows\System32\FT_SKFAPI.dll`

#### WatchData（握奇）

1. 下载驱动: https://www.watchdata.com/download
2. 安装驱动程序
3. 插入U盾
4. 验证安装: 检查 `C:\Windows\System32\WDSKFAPI.dll`

### 集成到应用

```javascript
const { UKeyManager } = require('./ukey-manager');

// 创建管理器
const manager = new UKeyManager();

// 初始化（自动检测品牌）
await manager.initialize();

// 检测设备
const detected = await manager.detect();
if (detected) {
  console.log('U盾已连接');
  console.log('品牌:', manager.getCurrentDriver().getManufacturerName());
}

// 解锁
await manager.unlock('123456');

// 加密数据
const encrypted = await manager.encrypt('Hello World');

// 解密数据
const decrypted = await manager.decrypt(encrypted);

// 签名
const signature = await manager.sign('Message to sign');

// 验签
const valid = await manager.verify('Message to sign', signature);
```

### 切换驱动

```javascript
// 手动指定驱动类型
await manager.switchDriver('feitian');

// 或
await manager.switchDriver('watchdata');

// 获取当前驱动
const currentDriver = manager.getCurrentDriver();
console.log('当前驱动:', currentDriver.getDriverName());
```

---

## 🔄 下一步计划

### 短期计划

1. ✅ 完善FeiTian驱动
2. ✅ 完善WatchData驱动
3. ⏳ 添加完整的单元测试
4. ⏳ 实现设备热插拔监控
5. ⏳ 优化错误处理和重试机制

### 中期计划

1. ⏳ 支持PKCS#11标准（跨平台）
2. ⏳ macOS平台硬件支持
3. ⏳ Linux平台硬件支持
4. ⏳ 添加更多品牌支持
5. ⏳ 性能优化

### 长期计划

1. ⏳ 支持蓝牙U盾
2. ⏳ 支持NFC U盾
3. ⏳ 云端密钥管理
4. ⏳ 多因素认证集成
5. ⏳ 企业级密钥管理

---

## 📚 相关文档

- [U盾管理器源码](./desktop-app-vue/src/main/ukey/ukey-manager.js)
- [FeiTian驱动源码](./desktop-app-vue/src/main/ukey/feitian-driver.js)
- [WatchData驱动源码](./desktop-app-vue/src/main/ukey/watchdata-driver.js)
- [SKF驱动基类](./desktop-app-vue/src/main/ukey/skf-driver.js)
- [配置管理](./desktop-app-vue/src/main/ukey/config.js)
- [系统设计文档](./docs/design/系统设计_个人移动AI管理系统.md)

---

## 🎯 测试指南

### 单元测试

```bash
cd desktop-app-vue
npm run test:ukey
```

### 手动测试

1. **测试设备检测**
   ```javascript
   const result = await driver.detect();
   console.log('检测结果:', result);
   ```

2. **测试PIN验证**
   ```javascript
   try {
     await driver.unlock('123456');
     console.log('解锁成功');
   } catch (error) {
     console.error('解锁失败:', error.message);
   }
   ```

3. **测试加密解密**
   ```javascript
   const plaintext = 'Hello World';
   const encrypted = await driver.encrypt(plaintext);
   const decrypted = await driver.decrypt(encrypted);
   console.log('原文:', plaintext);
   console.log('密文:', encrypted);
   console.log('解密:', decrypted);
   ```

4. **测试模拟模式**
   ```javascript
   config.setSimulationMode(true);
   const driver = new FeiTianDriver();
   await driver.initialize();
   console.log('模拟模式:', driver.simulationMode);
   ```

---

## 💡 最佳实践

### 1. 错误处理

```javascript
try {
  await driver.unlock(pin);
} catch (error) {
  if (error.code === 'PIN_INCORRECT') {
    console.error('PIN码错误');
  } else if (error.code === 'PIN_LOCKED') {
    console.error('PIN码已锁定');
  } else if (error.code === 'DEVICE_NOT_FOUND') {
    console.error('设备未连接');
  } else {
    console.error('未知错误:', error.message);
  }
}
```

### 2. 资源管理

```javascript
// 使用完毕后清理资源
try {
  await driver.unlock(pin);
  // ... 执行操作
} finally {
  await driver.lock();
  await driver.cleanup();
}
```

### 3. 配置管理

```javascript
// 加载配置
const config = getUKeyConfig();
config.load();

// 使用配置
const driverType = config.getDriverType();
const driver = createDriver(driverType);

// 保存配置
config.setDriverType('feitian');
config.save();
```

### 4. 日志记录

```javascript
// 启用调试模式
config.setDebug(true);

// 驱动会输出详细日志
await driver.initialize();
// [FeiTian] Initializing FeiTian driver...
// [FeiTian] Found DLL: C:\Windows\System32\FT_SKFAPI.dll
// [FeiTian] Library loaded successfully
```

---

**最后更新**: 2026-01-09
**维护者**: ChainlessChain 开发团队

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：U盾驱动完善报告。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
