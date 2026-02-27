# BLE U-Key 蓝牙设备管理

> **Phase 47 | v1.1.0-alpha | 4 IPC 处理器 | 扩展现有驱动注册**

## 概述

Phase 47 为 ChainlessChain U-Key 系统扩展低功耗蓝牙 (BLE) 传输通道，支持通过 BLE GATT 协议与硬件安全设备通信。

**核心目标**:

- 📡 **BLE GATT 发现**: 自动扫描和连接 BLE 安全设备
- 🔄 **自动重连**: 断线自动重连，保持持久连接
- 🔌 **多传输支持**: USB + BLE 双通道无缝切换
- 📊 **设备状态监控**: 实时电量、信号强度、连接状态

---

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

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
