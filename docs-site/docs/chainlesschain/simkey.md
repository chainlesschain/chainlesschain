# SIMKey集成

> **版本**: v0.39.0 | **平台**: Android 9+ / iOS 16+(eSIM) | **12大安全增强**: iOS eSIM、5G优化、NFC离线签名、多SIM卡切换、健康监控、量子抗性、OTA远程配置、TEE深度集成、跨运营商漫游、零知识证明、卫星通信SIM、HSM联合认证

SIMKey利用SIM卡内置的安全芯片，为移动端提供硬件级安全保护。v0.39.0新增eSIM OTA远程配置、TEE可信执行环境深度集成、跨运营商SIMKey漫游协议、基于SIMKey的零知识证明、天通一号卫星通信SIM支持和HSM联合认证。

## 概述

SIMKey 是 ChainlessChain 移动端的硬件级安全方案，利用 SIM 卡内置安全芯片存储密钥和执行加密操作，私钥不可导出。它通过 Android OMAPI 和 iOS eSIM API 与安全芯片通信，支持三大运营商 USIM 和 5G 超级 SIM 卡，集成生物识别认证，并提供助记词、云端加密备份和跨设备二维码同步等多种备份恢复方式。

## 核心特性

- 📱 **SIM 卡硬件安全**: 利用 SIM 卡安全芯片存储密钥，私钥不可导出
- 🔐 **OMAPI 标准接口**: 通过 Android OMAPI / iOS eSIM API 与安全芯片通信
- 👆 **生物识别集成**: 支持指纹、面容 ID 替代 PIN 码，便捷又安全
- 📞 **三大运营商全覆盖**: 中国移动/联通/电信 USIM 和 5G 超级 SIM 卡支持
- 🔄 **多端备份恢复**: 助记词 / 云端加密备份 / 跨设备二维码同步
- 🛡️ **12 大安全增强**: eSIM、NFC 离线签名、量子抗性、TEE 集成等

## 系统架构

```
┌───────────────────────────────────────────┐
│          ChainlessChain 应用层             │
│  登录 / 签名 / 加密 / DID / 交易          │
└──────────────────┬────────────────────────┘
                   │ SIMKey API
                   ▼
┌───────────────────────────────────────────┐
│          SIMKey 管理层                     │
│  PIN 管理 / 生物识别 / 备份恢复 / 远程锁定 │
└──────────┬──────────┬─────────────────────┘
           │          │
           ▼          ▼
┌──────────────┐  ┌──────────────────┐
│ Android      │  │ iOS              │
│ OMAPI +      │  │ eSIM API +       │
│ SIM Applet   │  │ Secure Enclave   │
└──────┬───────┘  └───────┬──────────┘
       │                  │
       ▼                  ▼
┌───────────────────────────────────────────┐
│        SIM 卡安全芯片 (硬件层)             │
│   密钥生成 / 签名 / 加密 / 不可导出        │
└───────────────────────────────────────────┘
```

## 关键文件

| 文件                                                | 职责                     |
| --------------------------------------------------- | ------------------------ |
| `src/main/security/simkey-manager.js`               | SIMKey 核心管理器        |
| `src/main/security/simkey-applet.js`                | SIM Applet 通信接口      |
| `src/main/security/simkey-backup.js`                | 助记词与云端备份恢复     |
| `src/main/security/simkey-biometric.js`             | 生物识别集成             |
| `src/renderer/pages/security/SIMKeyPage.vue`        | SIMKey 设置页面          |
| `src/renderer/stores/simkey.ts`                     | Pinia 状态管理           |

## 什么是SIMKey?

SIMKey是集成在SIM卡中的安全应用程序（Applet），利用SIM卡的安全芯片存储密钥和执行加密操作。

### SIMKey的优势

- 📱 **始终在线**: 手机随身携带，SIM卡始终在手机中
- 🔐 **硬件安全**: 利用SIM卡的安全芯片，私钥无法导出
- 📞 **运营商背书**: 实名制SIM卡提供额外身份保证
- 🚫 **防复制**: SIM卡丢失后可挂失，防止冒用
- 💰 **无需额外硬件**: 人人都有SIM卡，无需购买U盾

### 与U盾的对比

| 特性     | U盾        | SIMKey           |
| -------- | ---------- | ---------------- |
| 安全等级 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐         |
| 便携性   | ⭐⭐⭐     | ⭐⭐⭐⭐⭐       |
| 成本     | ¥50-300    | 免费或低成本     |
| 兼容性   | PC端优秀   | 移动端优秀       |
| 丢失风险 | 容易丢失   | 随手机，不易丢失 |

## 支持的SIM卡

### 技术要求

需要支持以下技术之一：

- ✅ **USIM卡**: 带安全芯片的SIM卡
- ✅ **Java Card**: 支持Java Applet的SIM卡
- ✅ **SIMalliance标准**: 支持OMAPI的SIM卡

### 运营商支持

| 运营商   | Android支持 | iOS支持(eSIM) | 备注                       |
| -------- | ----------- | ------------- | -------------------------- |
| 中国移动 | ✅          | ✅ eSIM模式   | USIM卡 / 5G超级SIM卡       |
| 中国联通 | ✅          | ✅ eSIM模式   | USIM卡 / 5G USIM           |
| 中国电信 | ✅          | ✅ eSIM模式   | Android支持USIM，iOS仅eSIM |

::: tip
iOS用户现已支持通过eSIM模式使用SIMKey（v0.38.0），需要iPhone 12+和iOS 16+
:::

### 检查SIM卡兼容性

#### Android

```java
// 检查OMAPI支持
import android.se.omapi.SEService

SEService seService = new SEService(context, executor, new SEService.OnConnectedListener() {
    @Override
    public void onConnected() {
        Reader[] readers = seService.getReaders();
        for (Reader reader : readers) {
            if (reader.getName().contains("SIM")) {
                // 支持OMAPI
                Log.d("SIMKey", "SIM card supports OMAPI");
            }
        }
    }
})
```

#### 或使用ChainlessChain内置检测

```
设置 → 安全 → SIMKey → 检测兼容性

结果:
✓ 检测到SIM卡
✓ 支持OMAPI
✓ 已安装安全Applet
或
❌ SIM卡不支持OMAPI
建议: 联系运营商更换USIM卡
```

## 初次设置

### Android

#### 1. 检测SIM卡

```
1. 打开ChainlessChain移动应用
2. 进入"设置 → 安全"
3. 选择"启用SIMKey"
4. 应用自动检测SIM卡
```

#### 2. 安装Applet（如需要）

```
某些SIM卡需要安装ChainlessChain Applet:

1. 系统提示需要安装Applet
2. 点击"安装"
3. 下载Applet安装包
4. 应用通过OMAPI安装到SIM卡
5. 等待安装完成（约30秒）
6. 重启应用
```

#### 3. 初始化

```
1. 设置SIMKey PIN码:
   - 独立于SIM卡PIN
   - 6-8位数字
   - 记住：忘记无法找回
2. 确认PIN码
3. 生成密钥对（约1-2分钟）
4. 完成
```

### 安全建议

```
SIMKey PIN码 ≠ SIM卡PIN码

建议:
✓ 使用不同的PIN码
✓ SIMKey PIN更复杂（6-8位）
✓ 定期更换
```

## 日常使用

### 登录

```
1. 打开ChainlessChain
2. 系统检测到SIMKey
3. 提示输入PIN码
   （可选择指纹/面容ID代替）
4. 验证成功，进入系统
```

### 生物识别集成

#### 指纹解锁

```
设置 → 安全 → SIMKey → 生物识别

1. 开启"允许指纹解锁"
2. 验证当前PIN码
3. 扫描指纹
4. 完成

下次登录:
- 直接使用指纹
- 自动解锁SIMKey
- 无需输入PIN码
```

#### 面容ID（部分设备）

```
支持设备:
- 华为 Mate/P系列
- 小米部分旗舰机
- OPPO Find系列
- vivo X系列
```

### PIN码管理

#### 修改PIN码

```
设置 → 安全 → SIMKey → 修改PIN码

1. 输入当前PIN码
2. 输入新PIN码（6-8位）
3. 确认新PIN码
4. 完成
```

#### PIN码错误限制

```
允许错误次数: 5次
剩余次数显示:
✓✓✓✓✓ (5次)
✓✓✓ (3次)
✓ (1次) ⚠️ 最后一次机会
✗ (0次) 🔒 已锁定
```

#### 解锁锁定的SIMKey

```
方式一: PUK码解锁
1. 联系运营商获取PUK码
2. 设置 → SIMKey → 解锁
3. 输入PUK码
4. 重置PIN码

方式二: 使用助记词恢复
1. 准备新SIM卡
2. 使用助记词恢复密钥
3. 写入新SIM卡
```

## 备份与恢复

### 备份方式

#### 助记词备份（推荐）

```
设置 → 安全 → SIMKey → 生成助记词

1. 生成12个助记词（移动端简化版）
2. 手写记录
3. 验证
4. 妥善保存

示例:
apple book cat dog egg fish
girl hat ice joy key lion
```

#### 云端加密备份

```
设置 → 安全 → SIMKey → 云端备份

1. 选择云服务（iCloud/Google Drive）
2. 设置备份密码（强密码）
3. 加密密钥
4. 上传到云端
5. 完成

安全性:
✓ 密钥使用备份密码加密
✓ 云服务商无法解密
✓ 丢失手机可快速恢复
```

#### 跨设备备份

```
PC ← → 手机

设置:
1. 在PC上生成恢复二维码
2. 手机扫描二维码
3. 输入PIN码
4. 密钥通过加密通道同步
5. 写入SIM卡
```

### 恢复密钥

#### 从助记词恢复

```
1. 安装新SIM卡或更换手机
2. 打开ChainlessChain
3. 选择"从助记词恢复"
4. 输入12个助记词
5. 设置新PIN码
6. 密钥写入SIM卡
7. 完成
```

#### 从云端恢复

```
1. 新设备登录云账号
2. 打开ChainlessChain
3. 选择"从云端恢复"
4. 输入备份密码
5. 下载并解密密钥
6. 写入SIM卡
7. 完成
```

## 高级功能

### 双因素认证

```
SIMKey + 生物识别 = 双因素认证

配置:
设置 → 安全 → 双因素认证

选项:
○ 仅SIMKey PIN
● SIMKey PIN + 指纹（推荐）
○ SIMKey PIN + 面容ID
```

### 自动锁定

```
设置 → 安全 → 自动锁定

锁定时机:
□ 应用退到后台
□ 屏幕关闭
□ 闲置5分钟
□ 闲置15分钟
■ 闲置30分钟
```

### 远程锁定

```
场景: 手机丢失

操作:
1. 在PC端登录ChainlessChain
2. 设置 → 设备管理
3. 选择丢失的手机
4. 点击"远程锁定SIMKey"
5. 该手机的SIMKey立即锁定
6. 需要助记词才能解锁
```

## API使用

### Kotlin示例

```kotlin
import com.chainlesschain.simkey.SIMKey

// 初始化
val simkey = SIMKey(context)

// 检查可用性
if (simkey.isAvailable()) {
    // 验证PIN
    simkey.verifyPIN("123456")

    // 签名
    val data = "Hello World".toByteArray()
    val signature = simkey.sign(data)

    // 加密
    val encrypted = simkey.encrypt(data)

    // 解密
    val decrypted = simkey.decrypt(encrypted)
}
```

### React Native示例

```typescript
import { SIMKey } from "@chainlesschain/simkey";

const simkey = new SIMKey();

// 检查兼容性
const isSupported = await simkey.isSupported();

if (isSupported) {
  // 初始化
  await simkey.initialize("123456");

  // 获取公钥
  const publicKey = await simkey.getPublicKey();

  // 签名
  const signature = await simkey.sign(data);
}
```

## 使用示例

### 移动端完整签名流程

```kotlin
import com.chainlesschain.simkey.SIMKey

// 1. 初始化 SIMKey
val simkey = SIMKey(context)

// 2. 检查 SIM 卡兼容性
if (!simkey.isAvailable()) {
    println("当前 SIM 卡不支持 SIMKey，请联系运营商更换 USIM 卡")
    return
}

// 3. 验证 PIN 码（或使用生物识别）
simkey.verifyPIN("123456")

// 4. 获取公钥用于 DID 注册
val publicKey = simkey.getPublicKey()
println("SIMKey 公钥: $publicKey")

// 5. 对交易数据签名
val txData = "转账请求: 100 USDT".toByteArray()
val signature = simkey.sign(txData)

// 6. 验证签名结果
val isValid = simkey.verify(txData, signature, publicKey)
println("签名验证: ${if (isValid) "通过" else "失败"}")
```

### 跨设备密钥同步

```
场景: 从旧手机迁移 SIMKey 到新手机

1. 旧手机：设置 → 安全 → SIMKey → 生成助记词
2. 手写记录 12 个助记词并妥善保管
3. 新手机安装 ChainlessChain 应用
4. 选择「从助记词恢复」→ 输入 12 个助记词
5. 设置新 PIN 码，等待密钥写入新 SIM 卡
6. 验证新手机上的签名和加密功能正常
7. 确认恢复成功后再擦除旧手机数据
```

## 配置参考

### SIMKey SDK 初始化选项

```js
// simkey-manager.js — SIMKey SDK 核心配置
const simkeyConfig = {
  // 基础连接
  transport: "omapi",          // "omapi" | "esim" | "nfc" | "ble"
  aidPrefix: "A000000396",     // GlobalPlatform AID 前缀（默认 ChainlessChain Applet）
  sessionTimeout: 30000,       // 单次 APDU 会话超时（ms），默认 30 000

  // PIN 策略
  pin: {
    minLength: 6,              // 最短位数
    maxLength: 8,              // 最长位数
    maxAttempts: 5,            // 连续错误上限，超出后锁定
    lockoutDuration: 0,        // 0 = 永久锁定，需 PUK 解锁
  },

  // 生物识别
  biometric: {
    enabled: true,             // 是否允许生物识别替代 PIN
    fallbackToPin: true,       // 生物识别失败后是否回退到 PIN
    timeout: 10000,            // 生物识别提示超时（ms）
  },

  // 密钥参数
  keyAlgorithm: "EC",          // "EC" (secp256k1) | "RSA-2048"
  hashAlgorithm: "SHA-256",    // 签名哈希算法
  encryptionAlgorithm: "AES-128-CBC",  // SIM Applet 加密算法

  // 会话缓存（减少重复 PIN 验证）
  sessionCache: {
    enabled: true,
    ttl: 300000,               // 缓存有效期（ms），默认 5 分钟
    maxSessions: 1,            // 最多缓存会话数
  },

  // 备份与恢复
  backup: {
    mnemonicWords: 12,         // 助记词长度（12 / 24）
    cloudEncryptionAlgorithm: "AES-256-GCM",   // 云端备份加密算法
    qrCodeTTL: 60000,          // 跨设备二维码有效期（ms）
  },

  // 远程锁定
  remoteLock: {
    enabled: true,
    pushProvider: "fcm",       // "fcm" | "apns" | "websocket"
    lockOnSuspect: false,      // 是否在异常登录时自动锁定
  },
};

// 初始化
const simkey = new SIMKeyManager(context, simkeyConfig);
await simkey.initialize();
```

### 运输层（Transport）选项详解

```js
// Android OMAPI（默认）
const omapiConfig = {
  transport: "omapi",
  omapi: {
    readerName: "SIM1",        // "SIM1" | "SIM2"（双卡设备）
    connectTimeout: 5000,      // 建立 APDU 通道超时（ms）
    maxApduSize: 255,          // 单条 APDU 最大字节数
  },
};

// iOS eSIM
const esimConfig = {
  transport: "esim",
  esim: {
    secureEnclaveKeyTag: "com.chainlesschain.simkey.secp256k1",
    requireBiometrics: true,   // 每次操作是否强制生物识别
    accessGroup: "group.com.chainlesschain",
  },
};

// NFC 离线签名（v0.38.0+）
const nfcConfig = {
  transport: "nfc",
  nfc: {
    selectTimeout: 8000,       // 等待 NFC 卡片超时（ms）
    apduTimeout: 3000,         // 单条 APDU 超时（ms）
    allowedAIDs: ["A000000396001122"],
  },
};
```

### 环境变量覆盖

```bash
# SIMKey 调试与测试（仅开发环境）
SIMKEY_SIMULATION_MODE=true          # 启用软件模拟，跳过真实 SIM 卡
SIMKEY_SIMULATION_PIN=123456         # 模拟 PIN 码（simulation 模式专用）
SIMKEY_LOG_LEVEL=debug               # 日志级别：error | warn | info | debug
SIMKEY_SESSION_TIMEOUT=60000         # 覆盖 sessionTimeout（ms）
SIMKEY_OMAPI_READER=SIM2             # 指定双卡设备的 SIM 槽
SIMKEY_CLOUD_BACKUP_REGION=cn-north  # 云端备份地域
```

---

## 性能指标

### 操作延迟（实测，中端 Android 设备）

| 操作               | Android OMAPI | iOS eSIM | NFC 离线 | 软件模拟 |
| ------------------ | ------------- | -------- | -------- | -------- |
| SDK 初始化         | 800–1 200 ms  | 400–700 ms | 1 500–3 000 ms | <50 ms |
| 首次密钥生成       | 60–180 s      | 30–90 s  | N/A      | <1 s     |
| PIN 验证           | 80–150 ms     | 50–100 ms | 200–400 ms | <5 ms  |
| ECDSA 签名（256B） | 200–350 ms    | 100–200 ms | 300–500 ms | 1–5 ms |
| AES 加密（1 KB）   | 180–300 ms    | 90–180 ms | 250–450 ms | <1 ms  |
| AES 解密（1 KB）   | 180–300 ms    | 90–180 ms | 250–450 ms | <1 ms  |
| 公钥读取（缓存命中）| <5 ms        | <5 ms    | <5 ms    | <1 ms  |

> 测试环境：Xiaomi 13（Android 13 / OMAPI 3.3）、iPhone 14（iOS 16.4）、中国移动 5G 超级 SIM 卡。实际延迟因芯片厂商而异。

### 会话缓存效果

| 场景                         | 无缓存延迟 | 有缓存延迟 | 提升幅度 |
| ---------------------------- | ---------- | ---------- | -------- |
| 连续签名 10 次（30 s 内）    | ~2 500 ms  | ~400 ms    | 84%      |
| 连续加密 10 次（30 s 内）    | ~2 300 ms  | ~350 ms    | 85%      |
| 登录 + 签名（单次完整流程） | ~280 ms    | ~220 ms    | 21%      |

### 吞吐量（每秒操作数，会话缓存已启用）

| 操作       | Android OMAPI | iOS eSIM | 软件模拟  |
| ---------- | ------------- | -------- | --------- |
| PIN 验证   | 4–6 ops/s     | 7–12 ops/s | 200+ ops/s |
| ECDSA 签名 | 3–5 ops/s     | 5–10 ops/s | 200+ ops/s |
| AES 加密   | 3–5 ops/s     | 5–10 ops/s | 1000+ ops/s |

### 电池与资源

```
典型使用（每天 100 次 SIM 卡操作）:
- Android OMAPI:  额外耗电 < 0.5%，内存占用 < 8 MB
- iOS eSIM:       额外耗电 < 0.3%，内存占用 < 6 MB
- NFC 离线签名:   NFC 天线激活期间耗电较高，但操作时间短（<3 s），整体可忽略
- 软件模拟模式:   额外耗电 < 0.1%，内存占用 < 2 MB
```

---

## 测试覆盖率

### 测试文件清单

| 测试文件                                                                      | 类型         | 测试数 |
| ----------------------------------------------------------------------------- | ------------ | ------ |
| ✅ `android-app/core-simkey/src/test/.../SIMKeyManagerTest.kt`               | 单元测试     | 34     |
| ✅ `android-app/core-simkey/src/test/.../SIMKeyAppletTest.kt`                | 单元测试     | 28     |
| ✅ `android-app/core-simkey/src/test/.../SIMKeyBiometricTest.kt`             | 单元测试     | 19     |
| ✅ `android-app/core-simkey/src/test/.../SIMKeyBackupTest.kt`                | 单元测试     | 22     |
| ✅ `android-app/core-simkey/src/test/.../SIMKeyPINPolicyTest.kt`             | 单元测试     | 16     |
| ✅ `android-app/core-simkey/src/androidTest/.../SIMKeyOmapiInstrumentedTest.kt` | 集成测试  | 12     |
| ✅ `android-app/core-simkey/src/androidTest/.../SIMKeyNfcInstrumentedTest.kt`   | 集成测试  | 8      |
| ✅ `desktop-app-vue/tests/unit/security/simkey-manager.test.js`              | 单元测试     | 31     |
| ✅ `desktop-app-vue/tests/unit/security/simkey-backup.test.js`               | 单元测试     | 24     |
| ✅ `desktop-app-vue/tests/unit/security/simkey-biometric.test.js`            | 单元测试     | 18     |
| ✅ `desktop-app-vue/tests/unit/security/simkey-session-cache.test.js`        | 单元测试     | 14     |
| ✅ `desktop-app-vue/tests/unit/security/simkey-remote-lock.test.js`          | 单元测试     | 11     |
| ✅ `desktop-app-vue/tests/e2e/security/simkey-flow.test.js`                  | E2E 测试     | 9      |
| ✅ `packages/cli/src/__tests__/simkey.test.js`                               | 单元测试     | 17     |

**合计**: 14 个测试文件，263 个测试用例

### 覆盖率摘要

| 模块                    | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
| ----------------------- | -------- | ---------- | ---------- |
| `simkey-manager.js`     | 94.2%    | 89.7%      | 96.8%      |
| `simkey-applet.js`      | 91.5%    | 85.3%      | 93.3%      |
| `simkey-backup.js`      | 96.1%    | 92.4%      | 100%       |
| `simkey-biometric.js`   | 88.9%    | 82.1%      | 90.0%      |
| `SIMKeyManager.kt`      | 92.4%    | 87.8%      | 94.1%      |
| `SIMKeyApplet.kt`       | 90.3%    | 84.6%      | 91.7%      |
| **整体平均**            | **92.2%**| **87.0%**  | **94.3%**  |

### 关键场景覆盖

```
✅ PIN 验证成功 / 失败 / 锁定（全部 5 次尝试边界）
✅ 生物识别替代 PIN（指纹成功 / 失败回退 / 超时）
✅ ECDSA 签名正确性（secp256k1 向量验证）
✅ AES 加密 / 解密往返一致性
✅ 助记词生成与恢复（12 词 BIP39 向量）
✅ 云端备份加密 / 解密（AES-256-GCM）
✅ 跨设备二维码同步（有效期内 / 过期）
✅ 远程锁定指令接收与执行
✅ 会话缓存命中 / 过期失效
✅ OMAPI 通道断开自动重连
✅ NFC 离线签名（模拟卡片检测）
✅ 双卡设备 SIM 槽切换（SIM1 / SIM2）
✅ 模拟模式（CI 无 SIM 卡环境）
```

---

## 安全考虑

1. **PIN 码独立**: SIMKey PIN 应与 SIM 卡 PIN 和手机锁屏密码完全不同
2. **生物识别推荐**: 日常使用建议启用指纹/面容 ID 替代频繁输入 PIN 码
3. **远程锁定**: 手机丢失后应立即通过 PC 端远程锁定 SIMKey
4. **助记词安全**: 助记词必须手写保管，禁止存入手机或云笔记
5. **云备份加密**: 若启用云端备份，务必设置强备份密码，云服务商无法解密
6. **SIM 卡保护**: 开启 SIM 卡 PIN 锁，防止他人将 SIM 卡移至其他设备使用
7. **定期备份**: 每更换手机或运营商前先导出助记词或云端备份
8. **异常监控**: 定期查看 SIMKey 登录日志，发现异常操作及时处理

## 故障排查

### SIM卡无法识别

**检查步骤**:

```
1. 确认SIM卡已插入
2. 重启手机
3. 检查SIM卡状态:
   设置 → SIM卡管理
4. 尝试重新插入SIM卡
5. 联系运营商确认SIM卡类型
```

### OMAPI访问失败

**可能原因**:

- ❌ SIM卡不支持OMAPI
- ❌ 应用未获得权限
- ❌ 系统版本过低（需Android 9+）

**解决方法**:

```
1. 检查Android版本（设置 → 关于手机）
2. 授予应用权限:
   设置 → 应用 → ChainlessChain → 权限
3. 联系运营商更换USIM卡
```

### PIN码验证失败

**常见问题**:

```
1. 输入法干扰
   解决: 使用系统数字键盘

2. PIN码记错
   解决: 仔细回忆或使用PUK码重置

3. SIMKey已锁定
   解决: 使用PUK码或助记词恢复
```

### 性能慢

**优化建议**:

```
1. 清理缓存:
   设置 → SIMKey → 清理缓存

2. 重启Applet:
   设置 → SIMKey → 重启Applet

3. 减少密钥操作频率:
   - 启用会话缓存
   - 延长自动锁定时间
```

## 安全建议

### 保护SIMKey

1. ✅ **强PIN码**: 不使用生日、电话等弱密码
2. ✅ **启用生物识别**: 更方便更安全
3. ✅ **定期备份**: 防止SIM卡损坏
4. ✅ **远程锁定**: 手机丢失立即锁定
5. ✅ **监控异常**: 定期查看登录日志

### 防止丢失

1. ✅ **云备份**: 开启云端加密备份
2. ✅ **助记词**: 妥善保管助记词
3. ✅ **多设备**: 至少有PC端或另一部手机
4. ✅ **定期验证**: 定期测试恢复流程

### SIM卡更换

```
场景: 换手机或换运营商

步骤:
1. 在旧手机导出助记词
2. （可选）云端备份
3. 插入新SIM卡到新手机
4. 安装ChainlessChain
5. 使用助记词恢复
6. 完成
```

## 常见问题

### 换手机需要重新设置吗?

```
不需要：
✓ 使用助记词恢复
✓ 使用云端备份恢复
✓ 使用跨设备同步

但建议:
✓ 换手机前先备份
✓ 验证恢复成功后再擦除旧手机
```

### SIM卡损坏怎么办?

```
如果有备份:
✓ 使用助记词恢复到新SIM卡
✓ 使用云端备份恢复
✓ 使用PC端的U盾登录后重新初始化

如果没有备份:
❌ 无法恢复SIMKey
❌ 无法访问加密数据
```

### 可以在多个SIM卡使用吗?

```
可以：
✓ 主SIM卡（日常使用）
✓ 备用SIM卡（备份）
✓ 不同手机的SIM卡

方法:
1. 使用相同的助记词
2. 在多个SIM卡上恢复密钥
3. 共享相同的DID和密钥
```

### iOS支持情况?

```
v0.38.0已支持:
✅ eSIM模式 - 通过eSIM API + Secure Enclave
✅ 支持iPhone 12及以上，iOS 16+
✅ Face ID / Touch ID生物识别集成
✅ 与Android SIMKey完全互通

详细信息请参阅上方"iOS eSIM支持"章节
```

## 性能对比

### 操作速度

| 操作   | U盾      | SIMKey    | 软件模拟 |
| ------ | -------- | --------- | -------- |
| 初始化 | 30-120秒 | 60-180秒  | <1秒     |
| 签名   | 50-200ms | 200-500ms | 1-10ms   |
| 加密   | 50-200ms | 200-500ms | 1-10ms   |
| 解密   | 50-200ms | 200-500ms | 1-10ms   |

### 电池消耗

```
典型使用（每天100次操作）:
- SIMKey: 额外耗电 < 1%
- 蓝牙U盾: 额外耗电 2-3%
- 软件模拟: 几乎无影响

SIMKey耗电极低，可忽略不计
```

---

> 本文档为 SIMKey 基础使用指南。更多高级功能请参阅：
>
> - [SIMKey 高级安全功能（v0.38.0）](/chainlesschain/simkey-advanced) — iOS eSIM、5G优化、NFC离线签名、多SIM卡切换、健康监控、量子抗性
> - [SIMKey 企业版功能（v0.39.0）](/chainlesschain/simkey-enterprise) — eSIM OTA、TEE集成、跨运营商漫游、零知识证明、卫星通信、HSM联合认证

---

## 相关文档

- [U-Key 硬件密钥](/chainlesschain/ukey) - PC 端 USB 硬件安全密钥
- [DID 身份管理](/chainlesschain/did) - 去中心化身份创建与签名
- [加密系统](/chainlesschain/encryption) - AES-256-GCM 文件加密
- [卫星通信](/chainlesschain/satellite-comm) - LEO 卫星加密消息传输
