# U盾硬件集成文档

## 概述

ChainlessChain 桌面应用集成了U盾（USB加密狗）硬件支持，用于提供高安全性的身份验证和数据加密功能。

## 支持的U盾类型

### 当前支持

- **芯劲科（XinJinKe）U盾加密狗** ✅
  - 制造商：深圳市芯劲科信息技术有限公司
  - 密码加密：增强型MD5 + AES 256位
  - 数据加密：AES 256位
  - 存储单位：扇区（512字节）、簇（4096字节）
  - 默认密码：888888

### 计划支持

- 飞天诚信（Feitian）U盾 🔜
- 握奇（WatchData）U盾 🔜

## 架构设计

```
┌─────────────────────────────────────────────┐
│           渲染进程 (Vue 应用)                │
│                                             │
│  LoginPage.vue  →  electronAPI.ukey.*      │
└──────────────────┬──────────────────────────┘
                   │ IPC通信
┌──────────────────▼──────────────────────────┐
│              主进程 (Electron)               │
│                                             │
│  ┌─────────────────────────────────────┐  │
│  │       UKeyManager (管理器)          │  │
│  │  - 统一API接口                       │  │
│  │  - 驱动切换                          │  │
│  │  - 事件管理                          │  │
│  │  - 设备监听                          │  │
│  └──────────┬──────────────────────────┘  │
│             │                              │
│  ┌──────────▼──────────────────────────┐  │
│  │   XinJinKeDriver (芯劲科驱动)       │  │
│  │   FeiTianDriver (飞天驱动)          │  │
│  │   WatchDataDriver (握奇驱动)        │  │
│  └──────────┬──────────────────────────┘  │
│             │                              │
│  ┌──────────▼──────────────────────────┐  │
│  │  XinJinKeNativeBinding (FFI绑定)   │  │
│  │  - ffi-napi 调用DLL                 │  │
│  │  - 函数映射                          │  │
│  └──────────┬──────────────────────────┘  │
└─────────────┼──────────────────────────────┘
              │
┌─────────────▼──────────────────────────────┐
│          xjk.dll (原生DLL)                  │
│      芯劲科U盾硬件驱动库                     │
└─────────────────────────────────────────────┘
```

## 项目结构

```
desktop-app-vue/
├── src/
│   ├── main/
│   │   ├── ukey/
│   │   │   ├── types.js              # 类型定义
│   │   │   ├── base-driver.js        # 驱动基类
│   │   │   ├── xinjinke-driver.js    # 芯劲科驱动实现
│   │   │   ├── native-binding.js     # 原生DLL绑定（FFI）
│   │   │   ├── ukey-manager.js       # U盾管理器
│   │   │   └── config.js             # 配置管理
│   │   └── index.js                  # 主进程（集成U盾）
│   ├── preload/
│   │   └── index.js                  # 暴露U盾API
│   └── renderer/
│       └── pages/
│           └── LoginPage.vue         # 登录页面（使用U盾）
├── scripts/
│   └── test-ukey.js                  # U盾测试脚本
├── resources/
│   └── xjk.dll                       # 芯劲科DLL（需要放置）
├── package.json
└── UKEY_INTEGRATION.md               # 本文档
```

## 依赖安装

### 必需依赖

```json
{
  "dependencies": {
    "ffi-napi": "^4.0.3",      // FFI接口调用DLL
    "ref-napi": "^3.0.3"       // C类型支持
  }
}
```

### 安装步骤

```bash
cd desktop-app-vue
npm install
```

> **注意**: `ffi-napi` 是原生模块，需要编译环境：
> - **Windows**: Visual Studio Build Tools 或 Visual Studio
> - **macOS**: Xcode Command Line Tools
> - **Linux**: build-essential

## 配置

### 配置文件位置

- **Windows**: `%APPDATA%\chainlesschain-desktop-vue\ukey-config.json`
- **macOS**: `~/Library/Application Support/chainlesschain-desktop-vue/ukey-config.json`
- **Linux**: `~/.config/chainlesschain-desktop-vue/ukey-config.json`

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
    }
  }
}
```

### 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `driverType` | 驱动类型 | `xinjinke` |
| `dllPath` | DLL路径（null=自动查找） | `null` |
| `timeout` | 操作超时（毫秒） | `30000` |
| `autoLock` | 是否自动锁定 | `true` |
| `autoLockTimeout` | 自动锁定超时（秒） | `300` |
| `monitorInterval` | 设备监听间隔（毫秒） | `5000` |
| `debug` | 调试模式 | `false` |
| `simulationMode` | 模拟模式（开发用） | `false` |

## API文档

### 主进程 API

#### UKeyManager

```javascript
const { UKeyManager, DriverTypes } = require('./ukey/ukey-manager');

// 创建管理器
const manager = new UKeyManager({
  driverType: DriverTypes.XINJINKE
});

// 初始化
await manager.initialize();

// 检测设备
const status = await manager.detect();
// { detected: true, unlocked: false, deviceId: '...' }

// 验证PIN
const result = await manager.verifyPIN('888888');
// { success: true, remainingAttempts: null }

// 加密数据
const encrypted = await manager.encrypt('Hello World');

// 解密数据
const decrypted = await manager.decrypt(encrypted);

// 数字签名
const signature = await manager.sign('data to sign');

// 获取公钥
const publicKey = await manager.getPublicKey();

// 锁定
manager.lock();

// 关闭
await manager.close();
```

#### 事件监听

```javascript
manager.on('device-connected', (status) => {
  console.log('设备已连接');
});

manager.on('device-disconnected', () => {
  console.log('设备已断开');
});

manager.on('unlocked', (result) => {
  console.log('已解锁');
});

manager.on('locked', () => {
  console.log('已锁定');
});
```

### IPC API

#### 渲染进程调用

```javascript
// 检测设备
const status = await window.electronAPI.ukey.detect();

// 验证PIN
const result = await window.electronAPI.ukey.verifyPin('888888');

// 获取设备信息
const info = await window.electronAPI.ukey.getDeviceInfo();

// 签名
const signature = await window.electronAPI.ukey.sign('data');

// 加密
const encrypted = await window.electronAPI.ukey.encrypt('data');

// 解密
const decrypted = await window.electronAPI.ukey.decrypt(encrypted);

// 锁定
await window.electronAPI.ukey.lock();

// 获取公钥
const publicKey = await window.electronAPI.ukey.getPublicKey();
```

#### 渲染进程事件监听

```javascript
// 监听设备连接
window.electronAPI.on('ukey:device-connected', (status) => {
  console.log('设备已连接', status);
});

// 监听设备断开
window.electronAPI.on('ukey:device-disconnected', () => {
  console.log('设备已断开');
});

// 监听解锁
window.electronAPI.on('ukey:unlocked', (result) => {
  console.log('已解锁', result);
});

// 监听锁定
window.electronAPI.on('ukey:locked', () => {
  console.log('已锁定');
});
```

## DLL驱动安装

### 芯劲科 U盾

#### 1. 获取DLL

从芯劲科官方获取 `xjk.dll` 文件。

#### 2. 放置DLL

将 `xjk.dll` 放置到以下任一位置：

- `desktop-app-vue/resources/xjk.dll` （推荐）
- `C:\Program Files\XinJinKe\xjk.dll`
- `C:\Windows\System32\xjk.dll`

#### 3. 自动查找顺序

程序会按以下顺序查找DLL：

1. `resources/xjk.dll`
2. `C:\Program Files\XinJinKe\xjk.dll`
3. `C:\Program Files (x86)\XinJinKe\xjk.dll`
4. `C:\Windows\System32\xjk.dll`

#### 4. 手动指定路径

如果DLL在其他位置，可以在配置文件中指定：

```json
{
  "dllPath": "D:\\MyDrivers\\xjk.dll"
}
```

## 开发和测试

### 运行测试脚本

```bash
npm run test:ukey
```

测试内容：
1. ✓ 配置管理
2. ✓ U盾管理器初始化
3. ✓ 设备检测
4. ✓ PIN验证
5. ✓ 获取设备信息
6. ✓ 加密解密
7. ✓ 数字签名
8. ✓ 锁定功能
9. ✓ 事件监听
10. ✓ 配置更新

### 模拟模式

如果没有真实硬件，程序会自动进入模拟模式：

- 模拟设备检测
- 模拟PIN验证（默认：888888）
- 模拟加密解密
- 模拟签名

启用模拟模式：

```javascript
const manager = new UKeyManager({
  driverType: DriverTypes.XINJINKE,
  simulationMode: true  // 强制模拟模式
});
```

### 调试模式

启用调试输出：

```json
{
  "debug": true
}
```

或者在代码中：

```javascript
const config = getUKeyConfig();
config.setDebug(true);
```

## 使用示例

### 登录验证

```vue
<template>
  <div class="login">
    <a-input-password
      v-model:value="pin"
      placeholder="请输入U盾PIN码"
      @pressEnter="handleLogin"
    />
    <a-button @click="handleLogin" :loading="loading">
      登录
    </a-button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { message } from 'ant-design-vue';

const pin = ref('');
const loading = ref(false);

async function handleLogin() {
  if (!pin.value) {
    message.error('请输入PIN码');
    return;
  }

  loading.value = true;

  try {
    // 验证PIN
    const result = await window.electronAPI.ukey.verifyPin(pin.value);

    if (result.success) {
      message.success('登录成功');
      // 跳转到主页面
      router.push('/');
    } else {
      message.error(result.error || 'PIN码错误');
    }
  } catch (error) {
    message.error('登录失败: ' + error.message);
  } finally {
    loading.value = false;
  }
}
</script>
```

### 数据加密存储

```javascript
// 加密敏感数据
async function saveSecureData(data) {
  try {
    const encrypted = await window.electronAPI.ukey.encrypt(
      JSON.stringify(data)
    );

    // 保存加密后的数据
    localStorage.setItem('secure_data', encrypted);

    return true;
  } catch (error) {
    console.error('加密失败:', error);
    return false;
  }
}

// 解密读取数据
async function loadSecureData() {
  try {
    const encrypted = localStorage.getItem('secure_data');

    if (!encrypted) {
      return null;
    }

    const decrypted = await window.electronAPI.ukey.decrypt(encrypted);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('解密失败:', error);
    return null;
  }
}
```

### 数字签名验证

```javascript
// 签名交易
async function signTransaction(transaction) {
  try {
    const dataToSign = JSON.stringify(transaction);
    const signature = await window.electronAPI.ukey.sign(dataToSign);

    return {
      transaction,
      signature,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('签名失败:', error);
    throw error;
  }
}

// 验证签名
async function verifyTransaction(signedTx) {
  try {
    const dataToVerify = JSON.stringify(signedTx.transaction);
    const isValid = await window.electronAPI.ukey.verifySignature(
      dataToVerify,
      signedTx.signature
    );

    return isValid;
  } catch (error) {
    console.error('验证失败:', error);
    return false;
  }
}
```

## 故障排除

### 问题 1: DLL加载失败

**错误**:
```
[XinJinKe] 未找到DLL，使用模拟模式
```

**解决方案**:
1. 检查DLL文件是否存在
2. 确认DLL路径配置正确
3. 检查DLL文件权限
4. 确认系统架构匹配（x86/x64）

### 问题 2: ffi-napi 安装失败

**错误**:
```
Error: Could not locate the bindings file
```

**解决方案**:
```bash
# 重新构建原生模块
npm rebuild ffi-napi

# 或清理后重新安装
rm -rf node_modules
npm install
```

### 问题 3: 设备检测失败

**错误**:
```
{ detected: false }
```

**解决方案**:
1. 确认U盾已插入USB端口
2. 检查U盾驱动是否已安装
3. 尝试重新插拔U盾
4. 检查系统设备管理器

### 问题 4: PIN验证失败

**错误**:
```
{ success: false, error: 'PIN码错误' }
```

**解决方案**:
1. 确认PIN码正确（默认：888888）
2. 检查U盾是否已锁定
3. 尝试使用默认密码
4. 联系U盾提供商重置密码

### 问题 5: 加密解密失败

**解决方案**:
1. 确保U盾已解锁
2. 检查数据格式正确
3. 验证U盾存储空间
4. 尝试重新验证PIN

## 安全建议

### 1. PIN码管理

- ❌ 不要硬编码PIN码
- ❌ 不要在日志中记录PIN码
- ✅ 使用安全输入组件
- ✅ 限制PIN验证尝试次数
- ✅ 定期更改PIN码

### 2. 数据保护

- ✅ 敏感数据必须加密存储
- ✅ 使用U盾进行数字签名
- ✅ 验证所有签名数据
- ✅ 定期备份加密数据

### 3. 设备管理

- ✅ 启用自动锁定
- ✅ 监听设备拔出事件
- ✅ 设备拔出时清除敏感数据
- ✅ 记录U盾操作日志

### 4. 错误处理

- ✅ 捕获所有U盾操作异常
- ✅ 提供友好的错误提示
- ✅ 不要在错误消息中泄露敏感信息
- ✅ 记录错误日志用于排查

## 性能优化

### 1. 操作缓存

```javascript
// 缓存公钥
let cachedPublicKey = null;

async function getPublicKey() {
  if (!cachedPublicKey) {
    cachedPublicKey = await window.electronAPI.ukey.getPublicKey();
  }
  return cachedPublicKey;
}
```

### 2. 批量操作

```javascript
// 批量加密
async function encryptMultiple(dataArray) {
  return Promise.all(
    dataArray.map(data => window.electronAPI.ukey.encrypt(data))
  );
}
```

### 3. 异步处理

```javascript
// 不阻塞UI
async function processWithUKey(data) {
  // 显示加载状态
  loading.value = true;

  try {
    // 在后台处理
    const result = await window.electronAPI.ukey.encrypt(data);
    return result;
  } finally {
    loading.value = false;
  }
}
```

## 扩展开发

### 添加新的U盾驱动

1. 创建驱动类继承 `BaseUKeyDriver`：

```javascript
// src/main/ukey/custom-driver.js
const BaseUKeyDriver = require('./base-driver');

class CustomDriver extends BaseUKeyDriver {
  async initialize() {
    // 实现初始化
  }

  async detect() {
    // 实现设备检测
  }

  async verifyPIN(pin) {
    // 实现PIN验证
  }

  // 实现其他必需方法...
}

module.exports = CustomDriver;
```

2. 在 `UKeyManager` 中注册：

```javascript
// src/main/ukey/ukey-manager.js
const CustomDriver = require('./custom-driver');

const DriverTypes = {
  XINJINKE: 'xinjinke',
  CUSTOM: 'custom',  // 添加新类型
};

async createDriver(driverType) {
  switch (driverType) {
    case DriverTypes.CUSTOM:
      driver = new CustomDriver(this.config);
      break;
    // ...
  }
}
```

## 常见问题（FAQ）

### Q: 支持哪些操作系统？

A: 当前仅支持 Windows。芯劲科U盾驱动只提供Windows版本的DLL。

### Q: 可以同时使用多个U盾吗？

A: 当前版本不支持。一次只能使用一个U盾设备。

### Q: 如何更改默认PIN码？

A:
```javascript
// 更改密码（需要先解锁）
const result = await manager.changePassword('888888', 'newpassword');
```

⚠️ **警告**: 密码丢失无法恢复！

### Q: 模拟模式和真实模式有什么区别？

A:
- **模拟模式**: 不需要硬件，用于开发测试
- **真实模式**: 需要插入U盾硬件，提供真实加密

### Q: 如何知道当前是哪种模式？

A:
```javascript
const info = await window.electronAPI.ukey.getDeviceInfo();
console.log('模拟模式:', info.isSimulated);
```

## 参考资料

- [芯劲科官方文档](doc/U盾加密狗开发文档.pdf)
- [ffi-napi 文档](https://github.com/node-ffi-napi/node-ffi-napi)
- [Electron IPC 文档](https://www.electronjs.org/docs/latest/tutorial/ipc)

## 更新日志

### v1.0.0 (2024-01-XX)

- ✅ 芯劲科U盾驱动实现
- ✅ FFI原生绑定
- ✅ U盾管理器
- ✅ 配置管理
- ✅ 主进程集成
- ✅ IPC API
- ✅ 测试脚本
- ✅ 完整文档

## 许可证

MIT License

---

**完成时间**: 2024-01-XX
**版本**: 1.0.0
**状态**: ✅ 已完成
