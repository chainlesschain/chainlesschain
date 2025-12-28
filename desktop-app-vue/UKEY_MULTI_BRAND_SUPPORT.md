# U盾多品牌自动识别支持文档

## 概述

ChainlessChain 已升级U盾驱动系统，现在支持多种主流U盾品牌的自动识别和切换。

## 支持的U盾品牌

| 品牌 | 驱动类型 | 制造商 | 主要产品系列 | 特色功能 |
|------|---------|--------|-------------|---------|
| 鑫金科 | `xinjinke` | 北京鑫金科技有限公司 | SIMKey系列 | 基础密码学功能 |
| 飞天诚信 | `feitian` | 飞天诚信科技股份有限公司 | ePass系列 | 广泛兼容性 |
| 握奇（卫士通） | `watchdata` | 北京握奇数据股份有限公司 | WatchKey系列 | 企业级安全 |
| 华大 | `huada` | 中国华大集成电路设计集团 | HD系列 | **国密算法支持 (SM2/SM3/SM4)** |
| 天地融 | `tdr` | 深圳市天地融科技股份有限公司 | SecureKey系列 | **支付密码器模式** |
| 模拟驱动 | `simulated` | - | 开发测试用 | 无需硬件 |

## 核心功能

### 1. 自动检测

系统会按优先级顺序自动检测已插入的U盾：

```javascript
const { UKeyManager } = require('./ukey/ukey-manager');

const manager = new UKeyManager();
await manager.initialize();

// 自动检测U盾品牌
const result = await manager.autoDetect();

if (result.detected) {
  console.log('检测到U盾:', result.driverType);
  console.log('制造商:', result.status.manufacturer);
  console.log('型号:', result.status.model);
}
```

**检测优先级**：
1. 鑫金科 (xinjinke)
2. 飞天诚信 (feitian)
3. 握奇 (watchdata)
4. 华大 (huada)
5. 天地融 (tdr)

### 2. 手动指定驱动

如果知道U盾品牌，可以直接指定：

```javascript
const manager = new UKeyManager({
  driverType: 'huada', // 直接使用华大驱动
});

await manager.initialize();
```

### 3. 动态切换驱动

运行时切换到不同的驱动：

```javascript
// 初始使用飞天驱动
const manager = new UKeyManager({ driverType: 'feitian' });
await manager.initialize();

// 切换到华大驱动
await manager.switchDriver('huada');
console.log('当前驱动:', manager.getDriverType());
```

## 品牌特定功能

### 华大 (Huada) - 国密算法支持

华大U盾支持中国国家密码算法（国密）：

```javascript
const HuadaDriver = require('./ukey/huada-driver');
const driver = new HuadaDriver();
await driver.initialize();

// 检查国密算法支持
const smSupport = driver.supportsSM();
console.log('SM2支持:', smSupport.SM2); // true - 非对称加密
console.log('SM3支持:', smSupport.SM3); // true - 哈希算法
console.log('SM4支持:', smSupport.SM4); // true - 对称加密

// 获取芯片信息
const chipInfo = await driver.getChipInfo();
console.log('芯片类型:', chipInfo.chipType); // HD-SM2
console.log('支持算法:', chipInfo.supportedAlgorithms); // ['SM2', 'SM3', 'SM4']
```

**应用场景**：
- 金融行业（需要符合国密标准）
- 政府机构
- 涉密信息系统
- 电子政务

### 天地融 (TDR) - 支付密码器模式

天地融U盾专为支付场景优化：

```javascript
const TDRDriver = require('./ukey/tdr-driver');
const driver = new TDRDriver();
await driver.initialize();

// 启用支付模式（增强PIN保护）
await driver.enablePaymentMode();

// 获取交易计数器
const counter = await driver.getTransactionCounter();
console.log('交易次数:', counter.counter);
console.log('最大交易次数:', counter.maxCount);

// 重置计数器（需要管理员权限）
await driver.resetTransactionCounter();
```

**应用场景**：
- 在线支付
- POS终端
- 银行交易
- 电子商务

## 配置选项

### 全局配置 (`desktop-app-vue/src/main/ukey/config.js`)

```javascript
const DEFAULT_CONFIG = {
  // 默认驱动类型
  driverType: 'xinjinke',

  // 自动锁定
  autoLock: true,
  autoLockTimeout: 300, // 5分钟

  // 设备监听间隔
  monitorInterval: 5000, // 5秒

  // 驱动特定选项
  driverOptions: {
    huada: {
      supportSM: true, // 启用国密算法
    },
    tdr: {
      paymentMode: false, // 是否启用支付模式
    },
  },
};
```

### 用户配置文件

配置保存在：`%APPDATA%/ChainlessChain/ukey-config.json`

```json
{
  "driverType": "huada",
  "autoLock": true,
  "autoLockTimeout": 300,
  "driverOptions": {
    "huada": {
      "supportSM": true
    }
  }
}
```

## 使用示例

### 示例1：基本使用

```javascript
const { UKeyManager } = require('./ukey/ukey-manager');

async function main() {
  const manager = new UKeyManager();

  // 初始化
  await manager.initialize();

  // 自动检测
  const result = await manager.autoDetect();

  if (result.detected) {
    console.log('找到U盾:', result.driverType);

    // 验证PIN码
    const verified = await manager.verifyPIN('123456');

    if (verified.success) {
      // 数字签名
      const signature = await manager.sign('Hello World');
      console.log('签名:', signature);

      // 加密数据
      const encrypted = await manager.encrypt('Secret Data');
      console.log('加密:', encrypted);
    }
  }

  // 关闭
  await manager.close();
}
```

### 示例2：热插拔监听

```javascript
const manager = new UKeyManager();
await manager.initialize();

// 监听设备事件
manager.on('device-connected', (status) => {
  console.log('U盾已插入:', status);
});

manager.on('device-disconnected', () => {
  console.log('U盾已拔出');
});

manager.on('unlocked', () => {
  console.log('U盾已解锁');
});

// 启动监听（每5秒检测一次）
manager.startDeviceMonitor(5000);
```

### 示例3：多设备支持

```javascript
// 同时管理多个U盾
const managers = {
  huada: new UKeyManager({ driverType: 'huada' }),
  tdr: new UKeyManager({ driverType: 'tdr' }),
  feitian: new UKeyManager({ driverType: 'feitian' }),
};

// 初始化所有管理器
for (const [brand, manager] of Object.entries(managers)) {
  await manager.initialize();
  const status = await manager.detect();
  if (status.detected) {
    console.log(`检测到${brand}设备`);
  }
}
```

## DLL文件位置

各品牌驱动DLL的搜索路径（按优先级）：

### 华大 (Huada)
- `resources/native/huada/HDSKFAPI.dll`
- `C:\Windows\System32\HDSKFAPI.dll`
- `C:\Program Files\ChinaHuada\UKey\HDSKFAPI.dll`

### 天地融 (TDR)
- `resources/native/tdr/TDRSKFAPI.dll`
- `C:\Windows\System32\TDRSKFAPI.dll`
- `C:\Program Files\TDR\SecureKey\TDRSKFAPI.dll`

### 飞天诚信 (FeiTian)
- `resources/native/feitian/FT_SKFAPI.dll`
- `C:\Windows\System32\FT_SKFAPI.dll`
- `C:\Program Files\FeiTian\ePass\FT_SKFAPI.dll`

### 握奇 (WatchData)
- `resources/native/watchdata/WDSKFAPI.dll`
- `C:\Windows\System32\WDSKFAPI.dll`
- `C:\Program Files\WatchData\WatchKey\WDSKFAPI.dll`

## 测试

运行多品牌测试套件：

```bash
cd desktop-app-vue
node src/main/ukey/multi-brand-test.js
```

测试内容：
- ✓ 所有驱动初始化
- ✓ 自动检测功能
- ✓ 手动切换驱动
- ✓ 品牌特定功能（华大国密、天地融支付）

## 故障排除

### 问题1：未检测到U盾

**可能原因**：
1. U盾未插入
2. 驱动DLL未安装
3. USB端口问题

**解决方案**：
```bash
# 1. 确认U盾已插入
# 2. 安装对应品牌的驱动程序
# 3. 检查设备管理器中是否识别

# 4. 使用模拟模式测试
const manager = new UKeyManager({
  driverType: 'simulated',
  simulationMode: true,
});
```

### 问题2：DLL加载失败

**错误信息**：`Failed to load shared library: 找不到指定的模块`

**解决方案**：
1. 下载并安装对应品牌的驱动程序
2. 手动指定DLL路径：
```javascript
const manager = new UKeyManager({
  driverType: 'huada',
  dllPath: 'C:\\path\\to\\HDSKFAPI.dll',
});
```

### 问题3：PIN码验证失败

**可能原因**：
- PIN码错误
- 设备已锁定
- 剩余尝试次数为0

**解决方案**：
```javascript
const result = await manager.verifyPIN(pin);
if (!result.success) {
  console.log('剩余尝试次数:', result.remainingAttempts);
  if (result.remainingAttempts === 0) {
    console.error('设备已锁定，请联系管理员');
  }
}
```

## API参考

### UKeyManager

#### 方法

- `initialize()` - 初始化管理器
- `autoDetect()` - 自动检测U盾品牌
- `switchDriver(driverType)` - 切换驱动
- `detect()` - 检测设备
- `verifyPIN(pin)` - 验证PIN码
- `sign(data)` - 数字签名
- `encrypt(data)` - 加密数据
- `decrypt(encryptedData)` - 解密数据
- `getDeviceInfo()` - 获取设备信息
- `startDeviceMonitor(interval)` - 启动设备监听
- `close()` - 关闭管理器

#### 事件

- `initialized` - 初始化完成
- `device-detected` - 检测到设备
- `device-connected` - 设备连接
- `device-disconnected` - 设备断开
- `unlocked` - 设备解锁
- `locked` - 设备锁定

## 兼容性

- **平台**：Windows（必需）
  - macOS/Linux：仅支持模拟模式
- **Electron**: 39.2.6+
- **Node.js**: 16+
- **SKF API**: GM/T 0016-2012 标准

## 更新日志

### v1.0.0 (2025-12-28)

新增功能：
- ✨ 添加华大（Huada）U盾支持
- ✨ 添加天地融（TDR）U盾支持
- ✨ 完善握奇（WatchData）驱动实现
- ✨ 升级自动检测逻辑，支持5种主流品牌
- ✨ 华大国密算法支持（SM2/SM3/SM4）
- ✨ 天地融支付密码器模式
- ✨ 多品牌测试套件

## 贡献

如需添加新的U盾品牌支持：

1. 继承 `SKFDriver` 基类
2. 实现 `findDllPath()` 方法
3. 在 `UKeyManager` 中注册新驱动
4. 添加测试用例
5. 更新文档

参考示例：`src/main/ukey/huada-driver.js`

## 许可证

MIT License

## 联系方式

- 项目主页：https://github.com/chainlesschain/chainlesschain
- 问题反馈：https://github.com/chainlesschain/chainlesschain/issues
