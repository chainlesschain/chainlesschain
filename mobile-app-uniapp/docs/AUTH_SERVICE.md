# AUTH认证服务 - 技术文档

**文件：** `services/auth.js`
**版本：** v1.0
**创建日期：** 2025-12-20

---

## 📋 概述

AUTH服务提供了完整的PIN码管理和生物识别认证功能，是ChainlessChain移动端的核心安全模块。

### 核心功能
- ✅ PIN码设置、验证、修改、重置
- ✅ 生物识别（指纹、面容）
- ✅ PBKDF2密钥派生（100000次迭代）
- ✅ 主密钥缓存和会话管理
- ✅ 数据加密/解密

---

## 🔐 安全特性

### 1. PIN码存储
```
用户输入PIN（6位数字）
    ↓
生成随机盐值（256位）
    ↓
PBKDF2 (100000次迭代)
    ↓
存储PIN哈希 (不存储明文)
```

**存储内容：**
- `chainlesschain_pin_hash` - PIN的PBKDF2哈希
- `chainlesschain_pin_salt` - 随机盐值

### 2. 主密钥派生
```
PIN + Salt
    ↓
PBKDF2 (100000次迭代 + 特殊前缀)
    ↓
主密钥（用于加密数据）
```

**特性：**
- 主密钥与PIN哈希使用不同的派生参数
- 主密钥缓存在内存中（会话级别）
- 30分钟无操作自动超时
- 退出应用自动清除缓存

### 3. 生物识别
- 支持指纹识别（fingerprint）
- 支持面容识别（facial）
- 需要先用PIN登录一次
- 生物识别成功后使用缓存的主密钥

---

## 🚀 快速开始

### 基本使用

```javascript
import authService from '@/services/auth.js'

// 1. 设置PIN码（首次）
const result = await authService.setupPIN('123456')
console.log('主密钥:', result.masterKey)

// 2. 验证PIN码
const verified = await authService.verifyPIN('123456')
if (verified.success) {
  console.log('验证成功，主密钥:', verified.masterKey)
}

// 3. 获取缓存的主密钥
const masterKey = authService.getMasterKey()
if (masterKey) {
  // 可以使用主密钥加密数据
}
```

---

## 📚 API文档

### PIN码管理

#### `hasPIN()`
检查是否已设置PIN码。

**返回：** `Promise<boolean>`

**示例：**
```javascript
const hasPin = await authService.hasPIN()
if (!hasPin) {
  // 引导用户设置PIN
}
```

---

#### `setupPIN(pin)`
设置PIN码（首次设置）。

**参数：**
- `pin` (string) - 6位数字PIN码

**返回：** `Promise<Object>`
```javascript
{
  success: true,
  masterKey: "base64编码的主密钥"
}
```

**示例：**
```javascript
try {
  const result = await authService.setupPIN('123456')
  // 保存masterKey到database
  await database.init(result.masterKey)
} catch (error) {
  console.error('设置失败:', error.message)
}
```

---

#### `verifyPIN(pin)`
验证PIN码。

**参数：**
- `pin` (string) - 输入的PIN码

**返回：** `Promise<Object>`
```javascript
{
  success: boolean,
  masterKey: string | null
}
```

**示例：**
```javascript
const result = await authService.verifyPIN('123456')
if (result.success) {
  // 验证成功，可以访问应用
  console.log('主密钥:', result.masterKey)
} else {
  // PIN错误
  uni.showToast({ title: 'PIN码错误', icon: 'none' })
}
```

---

#### `changePIN(oldPIN, newPIN)`
修改PIN码。

**参数：**
- `oldPIN` (string) - 旧PIN码
- `newPIN` (string) - 新PIN码

**返回：** `Promise<Object>`
```javascript
{
  success: true,
  masterKey: "新的主密钥",
  message: "PIN码修改成功，请使用新PIN码重新加密您的数据"
}
```

**重要：** 修改PIN后主密钥会改变，需要重新加密所有数据！

**示例：**
```javascript
try {
  const result = await authService.changePIN('123456', '654321')
  // ⚠️ 重新加密数据
  await reEncryptAllData(result.masterKey)
} catch (error) {
  console.error('修改失败:', error.message)
}
```

---

#### `resetPIN(mnemonic, newPIN)`
重置PIN码（需要助记词）。

**参数：**
- `mnemonic` (string) - 助记词（当前未实现验证）
- `newPIN` (string) - 新PIN码

**返回：** `Promise<boolean>`

**注意：** 助记词验证功能尚未实现，当前仅用于测试。

---

#### `clearPIN()`
清除PIN码（危险操作，仅用于测试）。

**返回：** `Promise<boolean>`

**警告：** 生产环境不应使用此方法！

---

### 会话管理

#### `getMasterKey(checkSession = true)`
获取缓存的主密钥。

**参数：**
- `checkSession` (boolean) - 是否检查会话超时，默认true

**返回：** `string | null`

**示例：**
```javascript
// 检查会话并获取主密钥
const masterKey = authService.getMasterKey()
if (!masterKey) {
  // 会话超时，需要重新验证PIN
  uni.navigateTo({ url: '/pages/login/login' })
}

// 不检查会话超时（用于生物识别）
const key = authService.getMasterKey(false)
```

---

#### `clearSession()`
清除会话缓存。

**示例：**
```javascript
// 用户退出登录时
authService.clearSession()
```

---

### 生物识别

#### `checkBiometricSupport()`
检查设备是否支持生物识别。

**返回：** `Promise<Object>`
```javascript
{
  supported: boolean,
  types: ['fingerprint', 'facial']  // 支持的类型
}
```

**示例：**
```javascript
const support = await authService.checkBiometricSupport()
if (support.supported) {
  console.log('支持的生物识别类型:', support.types)
  // 显示启用生物识别的选项
}
```

---

#### `isBiometricEnabled()`
检查是否已启用生物识别。

**返回：** `boolean`

**示例：**
```javascript
if (authService.isBiometricEnabled()) {
  // 显示生物识别登录按钮
}
```

---

#### `enableBiometric(pin)`
启用生物识别。

**参数：**
- `pin` (string) - PIN码（用于验证身份）

**返回：** `Promise<boolean>`

**示例：**
```javascript
try {
  await authService.enableBiometric('123456')
  uni.showToast({ title: '生物识别已启用', icon: 'success' })
} catch (error) {
  // 可能是设备不支持或PIN错误
  console.error('启用失败:', error.message)
}
```

---

#### `disableBiometric()`
禁用生物识别。

**返回：** `Promise<boolean>`

---

#### `verifyBiometric(challenge = '请验证身份')`
使用生物识别验证。

**参数：**
- `challenge` (string) - 认证提示文字

**返回：** `Promise<Object>`
```javascript
{
  success: boolean,
  masterKey: string | null
}
```

**示例：**
```javascript
const result = await authService.verifyBiometric('请验证以登录')
if (result.success) {
  // 生物识别成功
  console.log('主密钥:', result.masterKey)
} else {
  // 验证失败，降级到PIN输入
}
```

---

### 加密/解密

#### `encrypt(data, masterKey = null)`
使用主密钥加密数据。

**参数：**
- `data` (string) - 明文数据
- `masterKey` (string, 可选) - 主密钥，不提供则从缓存获取

**返回：** `string` - 加密后的数据

**示例：**
```javascript
const encrypted = authService.encrypt('敏感信息')
// 存储到数据库
await database.save({ content: encrypted })
```

---

#### `decrypt(encryptedData, masterKey = null)`
使用主密钥解密数据。

**参数：**
- `encryptedData` (string) - 密文数据
- `masterKey` (string, 可选) - 主密钥

**返回：** `string` - 解密后的数据

**示例：**
```javascript
const encrypted = await database.get('content')
const decrypted = authService.decrypt(encrypted)
console.log('解密后:', decrypted)
```

---

## 🎯 使用场景

### 场景1：应用首次启动

```javascript
// App.vue onLaunch
import authService from '@/services/auth.js'

export default {
  async onLaunch() {
    const hasPin = await authService.hasPIN()

    if (!hasPin) {
      // 首次使用，跳转到设置PIN页面
      uni.redirectTo({ url: '/pages/setup/pin' })
    } else {
      // 已设置PIN，跳转到登录页
      uni.redirectTo({ url: '/pages/login/login' })
    }
  }
}
```

---

### 场景2：登录页面

```vue
<template>
  <view>
    <!-- PIN输入 -->
    <input v-model="pin" type="number" maxlength="6" />
    <button @tap="login">登录</button>

    <!-- 生物识别登录（如果已启用） -->
    <button v-if="biometricEnabled" @tap="loginWithBiometric">
      使用生物识别登录
    </button>
  </view>
</template>

<script>
import authService from '@/services/auth.js'

export default {
  data() {
    return {
      pin: '',
      biometricEnabled: false
    }
  },

  onLoad() {
    this.biometricEnabled = authService.isBiometricEnabled()
  },

  methods: {
    async login() {
      const result = await authService.verifyPIN(this.pin)

      if (result.success) {
        // 登录成功，跳转到首页
        uni.switchTab({ url: '/pages/index/index' })
      } else {
        uni.showToast({ title: 'PIN码错误', icon: 'none' })
      }
    },

    async loginWithBiometric() {
      try {
        const result = await authService.verifyBiometric()

        if (result.success) {
          uni.switchTab({ url: '/pages/index/index' })
        }
      } catch (error) {
        // 失败，显示PIN输入
        uni.showToast({ title: '请使用PIN登录', icon: 'none' })
      }
    }
  }
}
</script>
```

---

### 场景3：设置页面

```vue
<template>
  <view>
    <view class="setting-item" @tap="changePINModal = true">
      <text>修改PIN码</text>
    </view>

    <view class="setting-item">
      <text>生物识别登录</text>
      <switch :checked="biometricEnabled" @change="toggleBiometric" />
    </view>
  </view>
</template>

<script>
import authService from '@/services/auth.js'

export default {
  data() {
    return {
      biometricEnabled: false,
      changePINModal: false
    }
  },

  onLoad() {
    this.biometricEnabled = authService.isBiometricEnabled()
  },

  methods: {
    async toggleBiometric(e) {
      const enabled = e.detail.value

      if (enabled) {
        // 启用生物识别
        const pin = await this.promptPIN()
        await authService.enableBiometric(pin)
        this.biometricEnabled = true
      } else {
        // 禁用生物识别
        await authService.disableBiometric()
        this.biometricEnabled = false
      }
    }
  }
}
</script>
```

---

### 场景4：会话超时检查

```javascript
// 在需要安全操作的页面
export default {
  methods: {
    async performSecureAction() {
      const masterKey = authService.getMasterKey()

      if (!masterKey) {
        // 会话已超时，需要重新验证
        uni.showModal({
          title: '会话已超时',
          content: '请重新验证身份',
          success: (res) => {
            if (res.confirm) {
              uni.navigateTo({ url: '/pages/login/login' })
            }
          }
        })
        return
      }

      // 继续执行安全操作
      const encrypted = authService.encrypt(sensitiveData, masterKey)
      // ...
    }
  }
}
```

---

## 🔬 安全分析

### 密码学强度

| 组件 | 算法 | 参数 | 安全性 |
|------|------|------|--------|
| PIN哈希 | PBKDF2-SHA256 | 100000次迭代 | ⭐⭐⭐⭐⭐ |
| 主密钥派生 | PBKDF2-SHA256 | 100000次迭代 | ⭐⭐⭐⭐⭐ |
| 盐值 | 随机生成 | 256位 | ⭐⭐⭐⭐⭐ |
| 数据加密 | AES | 256位密钥 | ⭐⭐⭐⭐⭐ |

### 攻击防护

| 攻击类型 | 防护措施 | 状态 |
|---------|---------|------|
| 暴力破解 | 100000次PBKDF2迭代 | ✅ |
| 彩虹表 | 随机盐值 | ✅ |
| 时序攻击 | 哈希比较无分支 | ✅ |
| 重放攻击 | 会话超时 | ✅ |
| 内存泄漏 | 自动清除缓存 | ✅ |
| 中间人 | 端到端加密 | ✅ |

---

## ⚠️ 注意事项

### 1. PIN码修改影响
修改PIN码后，主密钥会改变！需要：
- 重新加密所有使用旧主密钥加密的数据
- 或者提供数据迁移工具

### 2. 生物识别限制
- 生物识别需要用户先用PIN登录一次
- 小程序不支持生物识别API
- 不同设备支持的生物识别类型不同

### 3. 会话管理
- 主密钥仅缓存在内存中
- 30分钟无操作自动超时
- 应用重启需要重新验证

### 4. 助记词功能
当前助记词功能未实现，仅为占位符。

---

## 📊 性能指标

### PBKDF2性能
- 100000次迭代约需： 300-500ms（移动设备）
- 内存占用：< 1MB
- CPU占用：单核100%（计算期间）

### 优化建议
- 可在后台线程执行PBKDF2
- 使用Web Worker（H5模式）
- 显示加载动画避免阻塞UI

---

## 🧪 测试

### 单元测试示例

```javascript
describe('AUTH服务测试', () => {
  test('设置PIN', async () => {
    await authService.clearPIN()  // 清除旧PIN
    const result = await authService.setupPIN('123456')
    expect(result.success).toBe(true)
    expect(result.masterKey).toBeDefined()
  })

  test('验证PIN', async () => {
    const result = await authService.verifyPIN('123456')
    expect(result.success).toBe(true)
  })

  test('错误PIN', async () => {
    const result = await authService.verifyPIN('000000')
    expect(result.success).toBe(false)
  })

  test('加密解密', () => {
    const data = '测试数据'
    const encrypted = authService.encrypt(data)
    const decrypted = authService.decrypt(encrypted)
    expect(decrypted).toBe(data)
  })
})
```

---

## 🔄 版本历史

### v1.0 (2025-12-20)
- ✅ 初始版本发布
- ✅ PIN码管理完整实现
- ✅ 生物识别集成
- ✅ PBKDF2密钥派生（100000次迭代）
- ✅ 会话管理和超时控制
- ✅ 数据加密/解密

---

## 📚 相关文档

- [DID服务文档](./DID_QUICKSTART.md)
- [数据库服务文档](../services/database.js)
- [Week 1-2实施计划](./WEEK_1-2_PLAN.md)

---

**文档维护者：** ChainlessChain Team
**最后更新：** 2025-12-20
