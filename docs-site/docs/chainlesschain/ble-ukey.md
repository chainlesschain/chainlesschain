# BLE U-Key 蓝牙设备管理

> **Phase 47 | v1.1.0-alpha | 4 IPC 处理器 | 扩展现有驱动注册**

## 概述

BLE U-Key 模块为 ChainlessChain 的硬件安全密钥提供蓝牙无线通信能力，扩展现有 USB U-Key 驱动。系统通过自定义 GATT 服务发送 APDU 命令，支持 USB/BLE 双通道自动切换、断线自动重连、BLE 4.2+ 安全配对加密，让用户无需 USB 线缆即可完成数字签名等安全操作。

## 核心特性

- 📡 **BLE GATT 通信**: 通过自定义 GATT 服务发送 APDU 命令，兼容现有 USB 接口
- 🔄 **断线自动重连**: 连接中断后自动重试，最多 5 次尝试，保持持久连接
- 🔌 **USB/BLE 双通道**: 支持 USB 与 BLE 双传输通道，自动选择最优连接方式
- 🔋 **设备状态监控**: 实时监控电量、信号强度（RSSI）、固件版本和通信统计
- 🔒 **安全配对**: BLE 4.2+ Secure Connection (ECDH P-256) + AES-CCM 链路加密
- 📱 **无线签名**: 摆脱 USB 线缆束缚，蓝牙无线完成数字签名操作

## 系统架构

```
┌──────────────────────────────────────────────┐
│              BLE U-Key 管理系统               │
├──────────────────────────────────────────────┤
│  前端 (Vue3)                                 │
│  ┌─────────────┐  ┌───────────────────────┐  │
│  │ BLE 设备页面 │  │ Pinia bleUkey Store  │  │
│  └──────┬──────┘  └──────────┬────────────┘  │
│         └────────┬───────────┘               │
│                  ↓ IPC                       │
├──────────────────────────────────────────────┤
│  主进程 (Electron)                           │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ BLE 扫描 │→│ GATT 连接 │→│ APDU 通信 │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│        ↕              ↕                      │
│  ┌──────────────────────────────────┐        │
│  │  统一驱动注册 (USB + BLE 双通道) │        │
│  └──────────────────────────────────┘        │
├──────────────────────────────────────────────┤
│  硬件层: ChainlessKey Pro (BLE 4.2+)        │
└──────────────────────────────────────────────┘
```

## BLE 通信架构

### GATT 服务结构

ChainlessChain BLE 通信使用自定义 GATT 服务：

| 服务/特征            | UUID           | 功能              |
| -------------------- | -------------- | ----------------- |
| **Security Service** | `0000FF01-...` | 主安全服务        |
| ├─ Command           | `0000FF02-...` | 发送 APDU 命令    |
| ├─ Response          | `0000FF03-...` | 接收响应 (Notify) |
| └─ Status            | `0000FF04-...` | 设备状态 (Read)   |
| **Battery Service**  | `0000180F-...` | 标准电量服务      |
| └─ Battery Level     | `00002A19-...` | 电量百分比        |

### 连接流程

```
1. 扫描 BLE 设备 (过滤 Service UUID)
2. 连接设备 (GATT Connect)
3. 发现服务和特征
4. 订阅 Response 通知
5. 通过 Command 特征发送 APDU
6. 通过 Response 特征接收结果
```

---

## 核心功能

### 1. 设备发现

```javascript
// 扫描 BLE 设备
const devices = await window.electronAPI.invoke("ukey:ble-scan", {
  duration: 10000, // 扫描 10 秒
  serviceUUIDs: ["0000FF01-0000-1000-8000-00805F9B34FB"],
});

console.log(devices);
// [
//   {
//     id: 'ble-device-001',
//     name: 'ChainlessKey Pro',
//     rssi: -45,
//     services: ['0000FF01-...'],
//     manufacturer: 'ChainlessChain',
//     batteryLevel: 85
//   }
// ]
```

### 2. 设备连接

```javascript
// 连接设备
const connection = await window.electronAPI.invoke("ukey:ble-connect", {
  deviceId: "ble-device-001",
  autoReconnect: true,
});

console.log(connection);
// {
//   connected: true,
//   deviceId: 'ble-device-001',
//   mtu: 512,
//   rssi: -45,
//   services: ['0000FF01-...', '0000180F-...']
// }

// 断开连接
await window.electronAPI.invoke("ukey:ble-disconnect", {
  deviceId: "ble-device-001",
});
```

### 3. BLE APDU 通信

BLE 模式下的 APDU 通信与 USB 模式 API 兼容：

```javascript
// 通过 BLE 发送 APDU 命令
const response = await window.electronAPI.invoke("ukey:ble-send-apdu", {
  deviceId: "ble-device-001",
  apdu: [
    0x00, 0xa4, 0x04, 0x00, 0x07, 0xd2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01,
  ],
});

console.log(response);
// { sw1: 0x90, sw2: 0x00, data: [...] }
```

### 4. 自动重连

```javascript
// 自动重连已在连接时启用
// 断开时会自动尝试重连

// 监听连接状态变化
// 在前端通过 store 获取实时状态
const bleStore = useBLEUkeyStore();
console.log(bleStore.connectionStatus);
// 'connected' | 'disconnected' | 'reconnecting'
```

---

## 驱动注册

BLE 传输已集成到统一驱动注册系统：

```javascript
// 查看传输状态
const transports = await window.electronAPI.invoke("ukey:list-drivers");
// [
//   { type: 'usb', name: 'USB Transport', status: 'available' },
//   { type: 'ble', name: 'BLE Transport', status: 'available' },
//   ...
// ]

// 切换默认传输
await window.electronAPI.invoke("ukey:set-default-transport", {
  transport: "ble", // 或 'usb'
});
```

---

## 前端集成

### Pinia Store

```typescript
import { useBLEUkeyStore } from "@/stores/bleUkey";

const ble = useBLEUkeyStore();

// 扫描设备
await ble.scanDevices();

// 连接设备
await ble.connectDevice(deviceId);

// 查看连接状态
console.log(ble.connectionStatus);
console.log(ble.connectedDevice);
console.log(ble.batteryLevel);
```

### 前端页面

**BLE 设备管理页面** (`/ble-devices`)

**功能模块**:

1. **设备扫描**
   - 实时扫描附近 BLE 设备
   - 信号强度排序
   - 设备过滤

2. **设备连接**
   - 一键连接/断开
   - 连接状态实时显示
   - 自动重连状态

3. **设备信息**
   - 电量显示
   - 信号强度
   - 固件版本
   - 通信统计

---

## 配置选项

```json
{
  "unifiedKey": {
    "ble": {
      "enabled": true,
      "scanDuration": 10000,
      "autoReconnect": true,
      "reconnectAttempts": 5,
      "reconnectDelay": 2000,
      "serviceUUIDs": ["0000FF01-0000-1000-8000-00805F9B34FB"],
      "mtuSize": 512
    }
  }
}
```

---

## 使用场景

### 场景 1: 无线签名

```javascript
// 1. 扫描并连接 BLE 设备
const devices = await window.electronAPI.invoke("ukey:ble-scan", {
  duration: 5000,
});
await window.electronAPI.invoke("ukey:ble-connect", {
  deviceId: devices[0].id,
  autoReconnect: true,
});

// 2. 通过 BLE 执行签名
const signature = await window.electronAPI.invoke("ukey:sign", {
  keyId: "signing-key-001",
  data: "transaction data",
  transport: "ble",
});
```

### 场景 2: USB/BLE 自动切换

```javascript
// 系统自动检测可用传输
// USB 优先，USB 不可用时切回 BLE
const sig = await window.electronAPI.invoke("ukey:sign", {
  keyId: "signing-key-001",
  data: "message",
  transport: "auto", // 自动选择最佳传输
});
```

---

## 使用示例

### BLE 扫描并连接签名

```javascript
// 1. 扫描附近 BLE U-Key 设备
const devices = await window.electronAPI.invoke('ukey:ble-scan', {
  duration: 5000
});
console.log('发现设备:', devices.map(d => d.name));

// 2. 连接信号最强的设备
const best = devices.sort((a, b) => b.rssi - a.rssi)[0];
await window.electronAPI.invoke('ukey:ble-connect', {
  deviceId: best.id,
  autoReconnect: true
});

// 3. 通过 BLE 执行数字签名
const signature = await window.electronAPI.invoke('ukey:sign', {
  keyId: 'signing-key-001',
  data: '待签名的交易数据',
  transport: 'ble'
});
console.log('签名结果:', signature);

// 4. 查看设备电量
const status = await window.electronAPI.invoke('ukey:ble-status', {
  deviceId: best.id
});
console.log('电量:', status.batteryLevel + '%');
```

### 前端 Pinia Store 集成

```typescript
import { useBLEUkeyStore } from '@/stores/bleUkey';

const ble = useBLEUkeyStore();

// 扫描设备列表
await ble.scanDevices();

// 选择并连接设备
await ble.connectDevice(ble.discoveredDevices[0].id);

// 实时监控连接状态和电量
watch(() => ble.connectionStatus, (status) => {
  if (status === 'disconnected') {
    console.warn('BLE 连接断开，正在自动重连...');
  }
});
```

## 故障排查

### BLE 扫描无法发现设备

**现象**: 扫描超时后返回空设备列表。

**排查步骤**:

1. 确认 U-Key 设备已开机且处于 BLE 广播状态（通常需长按设备按钮激活）
2. 检查电脑蓝牙是否已开启（设置 → 蓝牙 → 开启）
3. 确认 U-Key 电量充足（低电量时 BLE 广播可能关闭）
4. 增大 `scanDuration` 参数至 15000ms，某些设备广播间隔较长

### BLE 连接不稳定或频繁断开

**现象**: 连接建立后很快断开，自动重连反复失败。

**排查步骤**:

1. 检查 U-Key 与电脑的距离，建议保持在 3 米以内
2. 排除 WiFi 和其他蓝牙设备的 2.4GHz 频段干扰
3. 确认 U-Key 固件版本为最新（旧固件可能有 BLE 稳定性问题）
4. 尝试重启蓝牙适配器或重新配对设备

### BLE APDU 通信超时

**现象**: 发送 APDU 命令后长时间无响应。

**排查步骤**:

1. 检查 RSSI 信号强度，低于 -80dBm 时通信可能不稳定
2. 确认 MTU 协商成功（默认 512 字节，部分设备可能不支持）
3. 检查 U-Key 是否正在执行耗时操作（如密钥生成），等待完成后重试
4. 尝试断开并重新连接设备

## 配置参考

完整配置项说明（对应 `.chainlesschain/config.json` 中的 `unifiedKey.ble` 节点）：

```json
{
  "unifiedKey": {
    "ble": {
      "enabled": true,
      "scanDuration": 10000,
      "autoReconnect": true,
      "reconnectAttempts": 5,
      "reconnectDelay": 2000,
      "rssiThreshold": -80,
      "serviceUUIDs": ["0000FF01-0000-1000-8000-00805F9B34FB"],
      "mtuSize": 512,
      "apduTimeout": 5000,
      "pairingMode": "numeric-comparison",
      "whitelist": []
    },
    "transport": {
      "default": "auto",
      "fallbackOrder": ["usb", "ble"]
    }
  }
}
```

**配置项说明**:

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用 BLE 传输通道 |
| `scanDuration` | `10000` | 单次扫描持续时间（毫秒） |
| `autoReconnect` | `true` | 连接断开后是否自动重连 |
| `reconnectAttempts` | `5` | 自动重连最大尝试次数 |
| `reconnectDelay` | `2000` | 相邻重连尝试间隔（毫秒） |
| `rssiThreshold` | `-80` | 信号强度过滤阈值（dBm），低于此值的设备不显示 |
| `mtuSize` | `512` | BLE MTU 协商目标大小（字节） |
| `apduTimeout` | `5000` | 单条 APDU 命令最大等待时间（毫秒） |
| `pairingMode` | `numeric-comparison` | 配对模式：`numeric-comparison` \| `just-works` |
| `whitelist` | `[]` | 已信任设备 ID 白名单，为空时允许所有已配对设备 |
| `transport.default` | `auto` | 默认传输：`auto` \| `usb` \| `ble` |
| `transport.fallbackOrder` | `["usb","ble"]` | `auto` 模式下的传输优先级顺序 |

## 测试覆盖率

```
✅ ble-transport.test.js          - BLE 连接/断开/自动重连/MTU 协商测试
✅ ble-scanner.test.js            - 设备扫描、RSSI 过滤、UUID 过滤测试
✅ apdu-handler.test.js           - APDU 命令封装、分包、响应解析测试
✅ driver-registry.test.js        - USB/BLE 双通道注册、自动切换逻辑测试
✅ stores/bleUkey.test.ts         - Pinia Store 状态管理、IPC 调用测试
✅ e2e/ukey/ble-ukey.e2e.test.ts  - 端到端设备发现→连接→签名流程测试
```

**测试运行**:

```bash
# BLE 单元测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/

# Store 测试
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/bleUkey.test.ts

# 端到端测试（需要真实或模拟 BLE 设备）
cd desktop-app-vue && npx vitest run tests/e2e/ukey/
```

## 安全考虑

1. **BLE 配对**: 使用 BLE 4.2+ Secure Connection (ECDH P-256)
2. **MITM 防护**: 数字比较配对模式
3. **加密通信**: AES-CCM 链路层加密
4. **距离限制**: RSSI 阈值过滤远距离设备
5. **白名单**: 仅允许已配对设备重连

---

## 性能指标

| 指标          | 目标   | 实际   |
| ------------- | ------ | ------ |
| BLE 扫描延迟  | <5s    | ~3s    |
| BLE 连接延迟  | <2s    | ~1.5s  |
| BLE APDU 往返 | <200ms | ~150ms |
| 自动重连时间  | <5s    | ~3s    |

---

## 相关文档

- [统一密钥 + FIDO2](/chainlesschain/unified-key)
- [门限签名 + 生物特征](/chainlesschain/threshold-security)
- [U盾/SIMKey 基础](/chainlesschain/ukey)
- [产品路线图](/chainlesschain/product-roadmap)

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/ukey/ble-transport.js` | BLE 传输通道实现 |
| `desktop-app-vue/src/main/ukey/ble-scanner.js` | BLE 设备扫描与发现 |
| `desktop-app-vue/src/main/ukey/driver-registry.js` | 统一驱动注册（USB+BLE） |
| `desktop-app-vue/src/main/ukey/apdu-handler.js` | APDU 命令处理 |
| `desktop-app-vue/src/renderer/stores/bleUkey.ts` | BLE U-Key Pinia Store |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
