# device-manager

**Source**: `src/main/p2p/device-manager.js`

**Generated**: 2026-02-21T22:04:25.808Z

---

## const

```javascript
const
```

* 设备管理器
 *
 * 负责多设备支持的核心功能:
 * - 设备身份生成和管理
 * - 设备注册和发现
 * - 设备列表同步
 * - 设备间消息路由

---

## class DeviceManager extends EventEmitter

```javascript
class DeviceManager extends EventEmitter
```

* 设备管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化设备管理器

---

## generateDeviceName()

```javascript
generateDeviceName()
```

* 生成设备名称

---

## async loadOrGenerateDevice()

```javascript
async loadOrGenerateDevice()
```

* 加载或生成设备信息

---

## generateDevice()

```javascript
generateDevice()
```

* 生成新设备

---

## generateDeviceId()

```javascript
generateDeviceId()
```

* 生成设备 ID

---

## async loadDeviceList()

```javascript
async loadDeviceList()
```

* 加载已知设备列表

---

## async saveDeviceList()

```javascript
async saveDeviceList()
```

* 保存设备列表

---

## async registerDevice(userId, device)

```javascript
async registerDevice(userId, device)
```

* 注册设备
   * @param {string} userId - 用户 ID
   * @param {Object} device - 设备信息

---

## async unregisterDevice(userId, deviceId)

```javascript
async unregisterDevice(userId, deviceId)
```

* 注销设备
   * @param {string} userId - 用户 ID
   * @param {string} deviceId - 设备 ID

---

## getUserDevices(userId)

```javascript
getUserDevices(userId)
```

* 获取用户的所有设备
   * @param {string} userId - 用户 ID

---

## getCurrentDevice()

```javascript
getCurrentDevice()
```

* 获取当前设备信息

---

## async updateDeviceActivity(userId, deviceId)

```javascript
async updateDeviceActivity(userId, deviceId)
```

* 更新设备活跃时间
   * @param {string} userId - 用户 ID
   * @param {string} deviceId - 设备 ID

---

## getDeviceBroadcast()

```javascript
getDeviceBroadcast()
```

* 获取设备广播信息
   * 用于在网络中广播当前设备信息

---

## async handleDeviceBroadcast(peerId, broadcast)

```javascript
async handleDeviceBroadcast(peerId, broadcast)
```

* 处理设备广播
   * @param {string} peerId - 对等节点 ID
   * @param {Object} broadcast - 广播数据

---

## async cleanupInactiveDevices(maxAge = 7 * 24 * 60 * 60 * 1000)

```javascript
async cleanupInactiveDevices(maxAge = 7 * 24 * 60 * 60 * 1000)
```

* 清理不活跃的设备
   * @param {number} maxAge - 最大不活跃时间 (毫秒)

---

## getStatistics()

```javascript
getStatistics()
```

* 获取所有设备统计

---

## async close()

```javascript
async close()
```

* 关闭设备管理器

---

