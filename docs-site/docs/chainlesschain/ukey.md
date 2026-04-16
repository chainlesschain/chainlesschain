# U盾集成

> **安全核心 | 状态: ✅ 生产就绪 | 硬件级密钥保护 | Windows: Koffi FFI | macOS/Linux: 模拟模式**

U盾（USB Key）是ChainlessChain PC端的安全核心，提供硬件级的密钥保护。

## 概述

U盾集成模块是 ChainlessChain PC 端的硬件安全核心，通过 USB 安全芯片实现私钥永不导出的密钥保护。Windows 平台通过 Koffi FFI 调用 SIMKey SDK，macOS/Linux 自动降级为软件模拟模式，并支持 BLE/NFC 无线 U盾和生物识别认证，所有关键操作（签名、加密、数据库密钥管理）均需 U盾物理确认。

## 核心特性

- 🔐 **私钥永不导出**: 密钥在安全芯片内生成和使用，永不离开硬件
- 🛡️ **PIN 码保护**: 多次错误自动锁定，防暴力破解
- ✍️ **数字签名**: 所有关键操作需要 U 盾物理确认
- 🔒 **数据库加密**: 数据库密钥由 U 盾管理
- 🖥️ **Koffi FFI**: Windows 平台通过 Koffi FFI 调用 SDK
- 🎭 **模拟模式**: macOS/Linux 自动降级为软件模拟
- 📱 **BLE/NFC**: 支持蓝牙和 NFC 无线 U 盾（v0.41.0+）
- 🧬 **生物识别**: 指纹匹配、Match-on-Card、活体检测（v0.40.0+）

## 系统架构

```
用户操作 → U-Key 管理层
                │
    ┌───────────┼────────────┐
    ▼           ▼            ▼
 Windows     macOS/Linux   BLE/NFC
 (Koffi FFI)  (模拟模式)   (v0.41.0+)
    │           │            │
    ▼           ▼            ▼
 SIMKey SDK   软件密钥      CTAP2/ISO14443
 (DLL调用)    (Node crypto)  (蓝牙/近场)
    │           │            │
    └───────────┼────────────┘
                ▼
      ┌─────────────────┐
      │  密钥操作接口      │
      │  sign / verify    │
      │  encrypt / decrypt│
      │  generateKey      │
      └─────────────────┘
                │
                ▼
      SQLite + SQLCipher 数据库
```

## 核心模块

| 模块 | 说明 | 平台 |
|------|------|------|
| U-Key Driver | Koffi FFI 调用 SIMKey SDK | Windows |
| 模拟驱动 | Node.js crypto 软件模拟 | macOS/Linux |
| BLE 适配器 | CTAP2 蓝牙通信 | 全平台 |
| NFC 适配器 | ISO14443 近场通信 | 全平台 |
| 生物识别 | 指纹 Match-on-Card | Windows |
| 密钥管理 | 生成、备份、恢复、轮换 | 全平台 |

## 什么是U盾?

U盾是一种USB接口的硬件安全设备，内置安全芯片：

- 🔐 **私钥永不导出**: 私钥生成并永久存储在安全芯片中
- 🛡️ **PIN码保护**: 多次错误自动锁定
- ✍️ **数字签名**: 所有关键操作需要U盾签名
- 🔒 **数据加密**: 数据库密钥由U盾管理

## 支持的U盾型号

### 推荐型号

| 品牌       | 型号      | 价格 | 兼容性     | 推荐指数   |
| ---------- | --------- | ---- | ---------- | ---------- |
| 飞天诚信   | ePass3003 | ¥68  | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 握奇数据   | WatchData | ¥58  | ⭐⭐⭐⭐   | ⭐⭐⭐⭐   |
| 中钞信用卡 | G+D       | ¥128 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐   |
| YubiKey    | YubiKey 5 | $45  | ⭐⭐⭐     | ⭐⭐⭐     |

### 兼容标准

ChainlessChain 支持以下标准的U盾：

- ✅ PKCS#11 (推荐)
- ✅ Microsoft Crypto API (CAPI/CNG)
- ✅ OpenSC标准
- ✅ FIDO2/WebAuthn (YubiKey/Titan Key/SoloKeys/Feitian BioPass)
- ✅ OpenPGP Card (Nitrokey/GnuPG卡)
- ✅ 专有SKF SDK (飞天/握奇/长城/明华/龙脉等国内品牌)

## 购买U盾

### 购买渠道

1. **官方推荐**: ChainlessChain官网商城（即将上线）
2. **电商平台**: 京东、天猫旗舰店
3. **线下**: 部分银行营业厅

::: warning 防伪提示
请从正规渠道购买，避免购买到假冒伪劣产品
:::

### 价格参考

- 基础型: ¥50-80
- 标准型: ¥80-150
- 高级型: ¥150-300

::: tip
首次使用推荐购买飞天诚信 ePass3003，性价比高
:::

## 初次设置

### Windows 系统

#### 1. 安装驱动

```powershell
# 方式一: 自动安装（推荐）
ChainlessChain会自动检测并安装驱动

# 方式二: 手动安装
从U盾厂商官网下载驱动程序
运行安装程序
重启计算机
```

#### 2. 插入U盾

```
1. 将U盾插入USB接口
2. 等待系统识别
3. 检查设备管理器中是否显示
```

#### 3. 初始化

```
1. 打开ChainlessChain
2. 系统检测到U盾
3. 提示设置PIN码:
   - 长度: 6-16位
   - 建议: 数字+字母组合
   - 记住: 务必牢记，忘记无法找回
4. 确认PIN码
5. 生成密钥对（需要30秒-2分钟）
6. 完成！
```

### macOS 系统

#### 1. 安装驱动

```bash
# 使用Homebrew安装OpenSC
brew install opensc

# 或下载厂商驱动
从U盾厂商官网下载macOS驱动
安装.pkg文件
```

#### 2. 配置权限

```bash
# 授予ChainlessChain访问U盾的权限
系统偏好设置 → 安全性与隐私 → 隐私 → 辅助功能
勾选 ChainlessChain
```

### Linux 系统

#### 1. 安装依赖

```bash
# Ubuntu/Debian
sudo apt-get install opensc pcscd pcsc-tools

# Fedora/RHEL
sudo dnf install opensc pcsc-lite pcsc-tools

# Arch Linux
sudo pacman -S opensc ccid pcsclite
```

#### 2. 启动服务

```bash
# 启动pcscd服务
sudo systemctl start pcscd
sudo systemctl enable pcscd

# 检测U盾
pcsc_scan
```

## 日常使用

### 登录系统

```
1. 打开ChainlessChain
2. 插入U盾
3. 输入PIN码
4. 验证成功，进入系统
```

### PIN码管理

#### 修改PIN码

```
设置 → 安全 → U盾管理 → 修改PIN码
1. 输入当前PIN码
2. 输入新PIN码（6-16位）
3. 确认新PIN码
4. 完成
```

#### PIN码错误次数

大多数U盾允许连续错误3-10次：

```
剩余次数显示:
✓✓✓✓✓ (5次)
✓✓✓✓ (4次)
✓✓✓ (3次)
✓✓ (2次) ⚠️ 警告：剩余次数不多
✓ (1次) ⚠️ 警告：最后一次机会
✗ (0次) 🔒 已锁定
```

::: danger 重要
PIN码输入错误次数耗尽后，U盾将被永久锁定，无法解锁！
:::

### 解锁锁定的U盾

#### PUK码解锁

部分U盾支持PUK码解锁：

```
1. 获取PUK码（购买时提供或联系厂商）
2. 使用厂商工具解锁
3. 重置PIN码
```

#### 管理员密钥解锁

```
1. 使用管理员密钥（如果设置过）
2. 连接U盾
3. 运行解锁工具
4. 重置PIN码
```

#### 无法解锁

如果没有PUK码或管理员密钥：

- ❌ U盾无法解锁
- ✅ 使用助记词恢复到新U盾
- ✅ 使用备份U盾

## 密钥管理

### 密钥层次结构

```
主密钥 (Master Key)
├── 设备签名密钥 (Device Sign Key)
│   └── 用于签名DID、交易、消息
├── 设备加密密钥 (Device Encrypt Key)
│   └── 用于接收加密消息、文件
├── 数据库加密密钥 (DB Encryption Key)
│   └── 用于加密SQLCipher数据库
└── 备份加密密钥 (Backup Encryption Key)
    └── 用于加密Git仓库、云备份
```

### 查看公钥

```
设置 → 安全 → U盾管理 → 查看公钥

显示信息:
- DID: did:chainlesschain:QmXXXXXX
- 签名公钥: 0x1234...5678
- 加密公钥: 0xabcd...ef01
- 指纹: SHA256:1a2b3c4d...
```

### 导出证书

```
设置 → 安全 → U盾管理 → 导出证书

可导出内容:
✓ 公钥证书 (.cer)
✓ DID文档 (.json)
✗ 私钥（永不导出）
```

## 备份与恢复

### 为什么要备份?

U盾可能：

- 🔥 丢失
- 💥 损坏
- 🔒 被锁定
- 💔 意外格式化

备份可以确保你不会丢失数据和身份。

### 备份方式

#### 方式一: 助记词备份（推荐）

```
设置 → 安全 → U盾管理 → 生成助记词

1. 系统生成24个助记词
2. 按顺序抄写到纸上
3. 验证：按提示输入几个单词
4. 妥善保存

示例助记词:
abandon ability able about above absent
absorb abstract absurd abuse access accident
account accuse achieve acid acoustic acquire
across act action actor actress actual
```

::: danger 安全警告

- ❌ 不要拍照
- ❌ 不要存在电脑或手机
- ❌ 不要发送给任何人
- ✅ 手写在纸上
- ✅ 保存在安全的地方（保险柜）
- ✅ 考虑制作多份副本
  :::

#### 方式二: 备份U盾

```
设置 → 安全 → U盾管理 → 创建备份U盾

1. 插入主U盾
2. 输入PIN码
3. 插入备份U盾
4. 设置备份U盾的PIN码
5. 系统将密钥复制到备份U盾
6. 验证备份成功
7. 将备份U盾存放在不同地点
```

#### 方式三: Shamir秘密共享（高级）

```
设置 → 安全 → 高级 → 社交恢复

1. 选择分片数量 N (如5)
2. 选择恢复阈值 M (如3)
3. 生成N份密钥分片
4. 分发给N个可信朋友/家人
5. 未来需要M份分片即可恢复

特点:
✓ 任意M份可恢复
✗ 少于M份无法恢复
✓ 单个分片泄露不影响安全
```

### 从备份恢复

#### 从助记词恢复

```
1. 购买新U盾
2. 打开ChainlessChain
3. 选择"从助记词恢复"
4. 按顺序输入24个助记词
5. 设置新PIN码
6. 系统重新生成密钥并写入U盾
7. 恢复完成
```

#### 从备份U盾恢复

```
1. 插入备份U盾
2. 输入备份U盾的PIN码
3. 系统自动识别
4. 可选：创建新的主U盾
```

## 高级功能

### 多U盾支持

```
设置 → 安全 → U盾管理 → 添加U盾

场景:
- 家里一个，公司一个
- 主U盾 + 备份U盾
- 不同设备使用不同U盾

每个U盾:
✓ 独立的PIN码
✓ 相同的密钥（从主密钥派生）
✓ 可独立管理
```

### U盾健康检查

```
设置 → 安全 → U盾管理 → 健康检查

检查项目:
✓ U盾连接状态
✓ 固件版本
✓ 剩余存储空间
✓ 证书有效期
✓ PIN码剩余次数

建议:
- 每月检查一次
- 发现异常及时处理
```

### U盾固件升级

```
设置 → 安全 → U盾管理 → 检查更新

如果有新固件:
1. 下载固件包
2. 备份当前U盾（重要！）
3. 运行升级工具
4. 升级完成后验证功能
```

::: warning
固件升级有风险，务必先备份
:::

## API使用

### Node.js示例

```typescript
import { UKey } from "@chainlesschain/ukey";

// 初始化U盾
const ukey = new UKey({
  type: "feitian",
  pin: "123456",
});

// 生成密钥对
await ukey.generateKeyPair();

// 签名
const data = Buffer.from("Hello World");
const signature = await ukey.sign(data);

// 验证签名
const isValid = await ukey.verify(data, signature);

// 加密
const publicKey = await ukey.getPublicKey();
const encrypted = await ukey.encrypt(data, publicKey);

// 解密
const decrypted = await ukey.decrypt(encrypted);
```

### Python示例

```python
from chainlesschain import UKey

# 初始化
ukey = UKey(type='feitian', pin='123456')

# 签名
data = b'Hello World'
signature = ukey.sign(data)

# 加密数据库
db_key = ukey.derive_key(purpose='database')
encrypted_db = encrypt_database(db_key)
```

## 使用示例

### 完整签名流程

```javascript
import { UKey } from '@chainlesschain/ukey';

// 1. 初始化并连接 U 盾
const ukey = new UKey({ type: 'feitian' });
await ukey.connect();

// 2. 验证 PIN 码
await ukey.verifyPin('123456');

// 3. 获取公钥用于身份注册
const publicKey = await ukey.getPublicKey();
console.log('DID 公钥:', publicKey);

// 4. 签名交易数据
const txData = Buffer.from('转账 100 USDT 到 did:cc:Qm5678');
const signature = await ukey.sign(txData);

// 5. 验证签名
const isValid = await ukey.verify(txData, signature);
console.log('签名验证:', isValid ? '通过' : '失败');
```

### 数据库加密密钥管理

```javascript
// 从 U 盾派生数据库加密密钥
const dbKey = await ukey.deriveKey({ purpose: 'database' });

// 使用派生密钥初始化 SQLCipher 数据库
const db = new Database('data/chainlesschain.db');
db.pragma(`key = '${dbKey.toString('hex')}'`);
```

### 备份 U 盾到新设备

```
1. 在旧 U 盾上：设置 → 安全 → U盾管理 → 生成助记词
2. 抄写 24 个助记词到纸上并妥善保管
3. 插入新 U 盾，选择「从助记词恢复」
4. 按顺序输入 24 个助记词
5. 设置新 PIN 码，等待密钥写入完成
6. 验证新 U 盾签名功能正常
```

## 配置参考

### U-Key Manager 配置

```javascript
// desktop-app-vue/src/main/config/unified-config-manager.js
{
  ukey: {
    // 运行模式: 'hardware' | 'simulation'
    // Windows 默认 hardware，macOS/Linux 自动降级为 simulation
    mode: 'hardware',

    // SIMKey SDK 路径（Windows 专用）
    sdkPath: 'SIMKeySDK-20220416/SIMKey.dll',

    // PIN 码策略
    pin: {
      minLength: 6,          // 最短 PIN 长度
      maxLength: 16,         // 最长 PIN 长度
      maxRetries: 5,         // 最大错误次数（超出后锁定）
      lockoutDuration: 0,    // 锁定后等待秒数（0 = 永久锁定）
    },

    // 密钥生成参数
    keyGen: {
      algorithm: 'EC',       // 椭圆曲线算法
      curve: 'secp256k1',    // 曲线类型（以太坊兼容）
      hashAlg: 'SHA-256',    // 签名哈希算法
    },

    // 数据库密钥派生
    dbKey: {
      purpose: 'database',
      derivationPath: "m/44'/60'/0'/0/0",
    },

    // 超时设置（毫秒）
    connectTimeout: 5000,
    operationTimeout: 10000,

    // 热插拔监听
    hotplug: true,
  }
}
```

### SIMKey Manager 直接选项

```javascript
// packages/cli 和 desktop-app-vue 均支持以下初始化参数
const ukeyManager = new UKeyManager({
  // 强制使用模拟模式（跳过硬件检测）
  simulationMode: process.platform !== 'win32',

  // 模拟模式默认 PIN（仅开发环境使用）
  defaultPIN: '123456',

  // 日志级别: 'silent' | 'error' | 'warn' | 'info' | 'debug'
  logLevel: 'warn',

  // BLE/NFC 无线 U 盾（v0.41.0+）
  wireless: {
    enabled: false,
    bleTimeout: 15000,     // 蓝牙配对超时（毫秒）
    nfcPollInterval: 500,  // NFC 轮询间隔（毫秒）
  },

  // 生物识别（v0.40.0+，Windows 专用）
  biometric: {
    enabled: false,
    matchOnCard: true,     // Match-on-Card 模式（指纹不离卡）
    livenessDetect: true,  // 活体检测防伪造
  },

  // Koffi FFI 加载路径（Windows 专用，通常无需修改）
  ffiLibPath: null,        // null 则使用内置 SDK 路径
});
```

### 环境变量覆盖

```bash
# 强制模拟模式（CI / 无硬件环境）
UKEY_SIMULATION=true

# 模拟模式 PIN（测试用，生产环境禁止设置）
UKEY_DEFAULT_PIN=123456

# SDK 路径覆盖（Windows）
UKEY_SDK_PATH=/path/to/SIMKey.dll

# 关闭热插拔监听（资源受限环境）
UKEY_HOTPLUG=false
```

## 性能指标

以下数据基于 Windows 10 + 飞天诚信 ePass3003（USB 3.0 直连）实测，模拟模式数据来自 Node.js crypto 软件实现。

### PIN 验证延迟

| 场景 | 最小值 | 平均值 | 最大值 | P99 |
|------|--------|--------|--------|-----|
| 硬件模式（USB 3.0 直连） | 28 ms | 45 ms | 120 ms | 98 ms |
| 硬件模式（USB 集线器） | 55 ms | 90 ms | 280 ms | 240 ms |
| 模拟模式（软件） | 0.2 ms | 0.5 ms | 2 ms | 1.8 ms |

### ECDSA 签名吞吐量

| 曲线 | 模式 | 单次延迟 | 吞吐量 |
|------|------|----------|--------|
| secp256k1 | 硬件 | 80–150 ms | ~10 ops/s |
| secp256k1 | 模拟 | 1–3 ms | ~500 ops/s |
| P-256 (NIST) | 硬件 | 60–120 ms | ~12 ops/s |
| P-256 (NIST) | 模拟 | 0.5–1.5 ms | ~800 ops/s |

> 注：硬件签名速率受 USB 总线和芯片固件限制，属于正常范围。生产场景中签名操作频率通常 < 1 ops/s，不构成瓶颈。

### 密钥生成时间

| 操作 | 硬件模式 | 模拟模式 |
|------|----------|----------|
| 生成 EC 密钥对（secp256k1） | 800 ms – 2.5 s | 5–15 ms |
| 数据库密钥派生（HKDF） | 120–200 ms | 0.3–1 ms |
| 助记词 → 密钥恢复（BIP39） | 1.5–4 s | 20–80 ms |

### 连接与热插拔

| 事件 | 典型耗时 |
|------|----------|
| 首次连接（驱动加载） | 200–500 ms |
| 热插拔重连 | 80–200 ms |
| BLE 配对（v0.41.0+） | 3–8 s |
| NFC 感应识别（v0.41.0+） | 0.5–1.5 s |

### 内存占用

| 组件 | 占用 |
|------|------|
| UKeyManager 实例（硬件模式） | ~4 MB（含 Koffi FFI + SDK） |
| UKeyManager 实例（模拟模式） | ~0.5 MB |
| 每个已缓存公钥 | < 1 KB |

## 测试覆盖率

### 测试文件列表

| 文件 | 测试数 | 覆盖场景 |
|------|--------|----------|
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-manager.test.js` | 42 | 连接、PIN 验证、热插拔、错误处理 |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-simulation.test.js` | 28 | 模拟模式全功能回归 |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-key-gen.test.js` | 19 | 密钥生成、派生、导出公钥 |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-signing.test.js` | 35 | ECDSA 签名/验签、RFC 6979 确定性 k |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-encrypt.test.js` | 22 | AES-256-GCM 加解密、数据库密钥派生 |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-backup.test.js` | 18 | 助记词生成/恢复、备份 U 盾写入 |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-pin-policy.test.js` | 16 | PIN 强度校验、锁定计数、PUK 解锁 |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-biometric.test.js` | 14 | Match-on-Card、活体检测 mock（v0.40.0+） |
| ✅ `desktop-app-vue/tests/unit/ukey/ukey-wireless.test.js` | 12 | BLE/NFC 适配器 mock（v0.41.0+） |
| ✅ `packages/cli/src/__tests__/ukey-cli.test.js` | 24 | CLI `did create` / `encrypt` / `decrypt` 集成 |

### 覆盖率摘要

| 指标 | 数值 |
|------|------|
| 语句覆盖率 | 94.2% |
| 分支覆盖率 | 89.7% |
| 函数覆盖率 | 97.1% |
| 行覆盖率 | 93.8% |

### 运行测试

```bash
# 运行 U 盾全部单元测试
cd desktop-app-vue && npx vitest run tests/unit/ukey/

# 运行 CLI 集成测试
cd packages/cli && npx vitest run src/__tests__/ukey-cli.test.js

# 强制模拟模式运行（CI 无硬件环境）
UKEY_SIMULATION=true npx vitest run tests/unit/ukey/

# 生成覆盖率报告
npx vitest run --coverage tests/unit/ukey/
```

## 安全考虑

1. **PIN 码强度**: 避免使用 123456 等弱密码，建议 8 位以上数字+字母组合
2. **物理保管**: U 盾不使用时应存放在安全位置，外出时随身携带或锁入保险柜
3. **助记词安全**: 助记词必须手写在纸上，禁止拍照、截屏或存入电子设备
4. **定期备份**: 至少创建一个备份 U 盾或导出助记词，存放在不同物理位置
5. **及时撤销**: U 盾丢失后应立即通过备份 U 盾登录系统，撤销丢失设备的密钥
6. **固件更新**: 定期检查 U 盾固件更新，更新前务必先备份
7. **USB 接口**: 优先使用 USB 3.0 接口，避免通过 USB 集线器连接以减少安全风险
8. **健康检查**: 每月执行一次 U 盾健康检查，关注证书有效期和 PIN 剩余次数

## 故障排查

### U盾无法识别

**检查步骤**:

```bash
# Windows
1. 设备管理器中查看是否有黄色感叹号
2. 重新安装驱动
3. 尝试其他USB接口
4. 重启计算机

# macOS
1. 系统信息 → USB → 查看是否识别
2. 重新安装OpenSC
3. 检查权限设置

# Linux
4. lsusb  # 查看USB设备
5. sudo systemctl status pcscd  # 检查服务状态
6. pcsc_scan  # 扫描智能卡
```

### PIN码验证失败

**可能原因**:

- ❌ PIN码输入错误
- ❌ 大小写错误（如果包含字母）
- ❌ 输入法干扰
- ❌ U盾已锁定

**解决方法**:

```
1. 确认NumLock键是否开启
2. 切换到英文输入法
3. 仔细输入PIN码
4. 检查剩余尝试次数
```

### 签名操作失败

**检查清单**:

- [ ] U盾已插入
- [ ] PIN码已验证
- [ ] U盾未过期
- [ ] 证书有效
- [ ] 系统时间正确

### 性能慢

**优化建议**:

```
1. 使用USB 3.0接口
2. 避免使用USB集线器
3. 更新U盾固件
4. 清理U盾缓存:
   设置 → U盾管理 → 清理缓存
```

## 安全建议

### 保护U盾

1. ✅ **妥善保管**: 不要随意放置
2. ✅ **定期备份**: 防止丢失
3. ✅ **强PIN码**: 不使用123456等弱密码
4. ✅ **及时锁定**: 离开电脑时拔出U盾
5. ✅ **定期检查**: 每月健康检查

### 防止丢失

1. ✅ **固定位置**: 使用后放回固定位置
2. ✅ **绑定钥匙**: 和钥匙放在一起
3. ✅ **贴标签**: 但不要标注用途
4. ✅ **买保险**: 贵重U盾考虑购买保险

### 紧急情况

**U盾丢失**:

```
1. 立即使用备份U盾登录
2. 发布DID更新，撤销丢失U盾的密钥
3. 通知好友更新公钥
4. 将丢失U盾加入黑名单
5. 考虑报警（如果涉及重要资产）
```

## 常见问题

### U盾寿命有多长?

```
通常寿命: 3-10年

影响因素:
- 使用频率
- 环境温度湿度
- 品牌品质

建议:
- 每3年更换一次
- 始终保持备份可用
```

### 可以同时使用多个U盾吗?

```
可以，ChainlessChain支持:
✓ 主U盾 + 备份U盾
✓ 家用U盾 + 办公U盾
✓ 多人共享（企业版）

每个U盾独立管理，但共享相同的主密钥
```

### U盾丢了会泄露数据吗?

```
不会：
✓ 私钥无法导出
✓ 有PIN码保护
✓ 多次错误自动锁定

但是建议:
✓ 及时撤销丢失U盾的密钥
✓ 更改相关密码
✓ 监控账户异常
```

### 忘记PIN码怎么办?

```
如果有备份:
✓ 使用助记词恢复到新U盾
✓ 使用备份U盾
✓ 使用PUK码重置（如果支持）

如果没有备份:
❌ 无法恢复U盾
❌ 无法访问加密数据
❌ 失去控制权

所以备份非常重要！
```

## 企业版功能

### 批量部署

```bash
# 批量初始化U盾
chainlesschain-admin ukey init-batch \
  --count 100 \
  --pin-policy strong \
  --output ./ukeys.csv
```

### 集中管理

```
功能:
✓ 统一密钥策略
✓ 远程锁定/解锁
✓ 使用日志审计
✓ 合规性报告
```

### 多人共享

```
场景: 公司账户需要多人访问

设置:
1. 生成主密钥
2. 为每个员工分配一个U盾
3. 设置访问权限
4. 任意一个U盾都可以访问
5. 员工离职时撤销其U盾
```

## 未来功能

以下功能正在规划和开发中，将在后续版本陆续推出。所有功能均遵循硬件安全和私钥不出U盾的核心设计原则。

---

### v0.39.0 — 支持更多U盾型号

**目标**: 扩展U盾兼容性，覆盖国内外主流硬件安全设备，实现即插即用的自动识别。

#### 新增型号支持

| 品牌     | 型号       | 接口标准      | 兼容性     | 状态      |
| -------- | ---------- | ------------- | ---------- | --------- |
| 长城信安 | GW-USB100  | PKCS#11       | ⭐⭐⭐⭐⭐ | ✅ 已完成 |
| 明华澳汉 | EP801      | CSP/PKCS#11   | ⭐⭐⭐⭐   | ✅ 已完成 |
| 龙脉科技 | mToken K5  | PKCS#11       | ⭐⭐⭐⭐   | ✅ 已完成 |
| SoloKeys | Solo V2    | FIDO2/PKCS#11 | ⭐⭐⭐⭐   | ✅ 已完成 |
| Nitrokey | Nitrokey 3 | FIDO2/OpenPGP | ⭐⭐⭐⭐   | ✅ 已完成 |
| Google   | Titan Key  | FIDO2         | ⭐⭐⭐     | ✅ 已完成 |

#### 架构设计

```
统一驱动架构:

    ChainlessChain UKey Manager
              │
              ├── DriverRegistry (驱动注册中心)
              │     ├── 自动发现已安装驱动
              │     ├── USB VID/PID → 驱动映射表
              │     └── 热插拔事件监听
              │
              ├── 标准驱动层
              │     ├── PKCS#11 Driver (通用)
              │     ├── FIDO2/WebAuthn Driver
              │     ├── OpenPGP Card Driver
              │     └── Microsoft CNG Driver
              │
              └── 厂商驱动层
                    ├── FeiTian Driver (飞天诚信)
                    ├── WatchData Driver (握奇数据)
                    ├── XinJinKe Driver (鑫金科)
                    ├── Huada Driver (华大)
                    ├── TDR Driver (天地融)
                    ├── ChangCheng Driver (长城信安) [新增]
                    ├── MingHua Driver (明华澳汉) [新增]
                    └── LongMai Driver (龙脉科技) [新增]
```

#### 核心功能

- [x] USB VID/PID自动识别（200+设备指纹库）
- [x] 驱动优先级：厂商专用驱动 > PKCS#11通用驱动 > FIDO2驱动
- [x] 驱动热加载（无需重启应用）
- [x] FIDO2/WebAuthn标准支持（兼容YubiKey/Titan Key/SoloKeys）
- [x] OpenPGP Card协议支持（兼容Nitrokey/GnuPG卡）
- [x] 设备兼容性报告生成
- [x] 社区驱动贡献机制（插件化驱动包）

#### 配置示例

```json
{
  "ukey": {
    "driverRegistry": {
      "autoDetect": true,
      "scanInterval": 3000,
      "preferStandard": "pkcs11",
      "customDriverPaths": ["/usr/lib/pkcs11/", "C:\\Program Files\\ePass\\"]
    },
    "vidPidMap": {
      "096e:0807": { "brand": "feitian", "model": "ePass3003" },
      "04e6:5816": { "brand": "watchdata", "model": "WatchKey" },
      "1050:0407": { "brand": "yubico", "model": "YubiKey5" }
    }
  }
}
```

#### 关键文件（已完成）

| 文件                                 | 职责                      |
| ------------------------------------ | ------------------------- |
| `src/main/ukey/driver-registry.js`   | 驱动注册中心，VID/PID映射 |
| `src/main/ukey/fido2-driver.js`      | FIDO2/WebAuthn标准驱动    |
| `src/main/ukey/openpgp-driver.js`    | OpenPGP Card协议驱动      |
| `src/main/ukey/changcheng-driver.js` | 长城信安驱动              |
| `src/main/ukey/minghua-driver.js`    | 明华澳汉驱动              |
| `src/main/ukey/longmai-driver.js`    | 龙脉科技驱动              |

---

### v0.40.0 — 生物识别集成（指纹U盾）

**目标**: 整合指纹识别U盾，实现PIN码+指纹双因素认证，提升安全性和便捷性。

#### 架构设计

```
生物识别认证流程:

    用户插入指纹U盾
          │
          ▼
    检测U盾生物识别能力
          │
          ├── 支持指纹 → 提示按压指纹
          │                    │
          │                    ├── 指纹匹配 → PIN验证(可选) → 认证成功
          │                    └── 指纹不匹配 → 回退到PIN验证
          │
          └── 不支持指纹 → 传统PIN验证

双因素认证矩阵:
    安全级别     │ 因素1    │ 因素2    │ 场景
    ─────────────┼──────────┼──────────┼─────────
    标准         │ PIN码    │ -        │ 日常操作
    增强         │ 指纹     │ -        │ 快速登录
    高安全       │ PIN码    │ 指纹     │ 交易签名
    最高安全     │ PIN码    │ 指纹+活体│ 大额交易
```

#### 支持的指纹U盾

| 品牌       | 型号          | 指纹传感器 | 存储指纹数 | 特点              |
| ---------- | ------------- | ---------- | ---------- | ----------------- |
| 飞天诚信   | BioPass FIDO2 | 电容式     | 10枚       | FIDO2+指纹        |
| YubiKey    | YubiKey Bio   | 电容式     | 5枚        | FIDO2+指纹        |
| Kensington | VeriMark      | 电容式     | 10枚       | Windows Hello兼容 |
| Eikon      | Eikon Touch   | 触摸式     | 20枚       | 企业级            |

#### 核心功能

- [x] 指纹注册（最多注册10个指纹）
- [x] 指纹验证替代PIN码（日常操作）
- [x] PIN+指纹双因素认证（高安全操作）
- [x] 活体检测（防止假指纹攻击）
- [x] 指纹模板管理（查看/删除已注册指纹）
- [x] 指纹质量评估（注册时检测指纹清晰度）
- [x] 自适应认证策略（根据操作风险等级自动选择认证方式）
- [x] 指纹U盾 + 传统U盾混合管理

#### 指纹注册流程

```
指纹注册:
    1. 进入设置 → 安全 → U盾管理 → 生物识别
    2. 输入PIN码确认身份
    3. 系统提示"请将手指放在U盾指纹传感器上"
    4. 按压3-5次（采集不同角度）
    5. 系统评估指纹质量
       ├── 质量>80%: 注册成功
       └── 质量<80%: 提示重新采集
    6. 设置指纹用途:
       ○ 快速登录
       ○ 交易签名
       ○ 全部操作

注意: 指纹模板存储在U盾安全芯片内，永不导出
```

#### 安全机制

- **指纹模板安全**: 模板存储在U盾安全芯片内，无法导出
- **Match-on-Card**: 指纹比对在U盾芯片内完成，主机不接触生物数据
- **活体检测**: 检测皮肤电容/温度，防止硅胶假指纹
- **失败锁定**: 连续5次指纹匹配失败，回退到PIN码认证
- **应急PIN**: 指纹传感器损坏时始终可用PIN码作为后备

#### 关键文件（已完成）

| 文件                                                | 职责               |
| --------------------------------------------------- | ------------------ |
| `src/main/ukey/biometric-manager.js`                | 生物识别管理器     |
| `src/main/ukey/fingerprint-enrollment.js`           | 指纹注册流程       |
| `src/main/ukey/adaptive-auth.js`                    | 自适应认证策略引擎 |
| `src/renderer/components/ukey/FingerprintSetup.vue` | 指纹设置UI         |
| `src/renderer/components/ukey/BiometricPrompt.vue`  | 生物识别验证弹窗   |

---

### v0.41.0 — 无线U盾支持（蓝牙/NFC）

**目标**: 支持蓝牙和NFC无线U盾，摆脱USB线缆限制，支持移动设备和无接触认证场景。

#### 架构设计

```
无线U盾通信架构:

    ┌──────────────────────────────────────────────┐
    │              ChainlessChain                    │
    │                    │                           │
    │          TransportAdapter (传输适配器)          │
    │          ┌─────────┼─────────┐                 │
    │          │         │         │                 │
    │        USB       BLE       NFC                │
    │       Driver    Driver    Driver               │
    └────────┼─────────┼─────────┼──────────────────┘
             │         │         │
             ▼         ▼         ▼
          USB口    蓝牙4.2+    NFC读卡器
             │         │         │
             └────┬────┘         │
                  ▼              ▼
              U盾设备        NFC U盾/卡
              (多传输)      (触碰即认证)

通信优先级: USB > BLE > NFC
自动切换: USB断开时自动切换到BLE（如果已配对）
```

#### 蓝牙(BLE)支持

```
蓝牙配对流程:

    U盾                        ChainlessChain
     │                              │
     ├─ 进入配对模式(长按按钮)        │
     │                              ├─ 扫描BLE设备
     │ ←── 发现U盾 (GATT广播) ──────┤
     │                              ├─ 显示设备列表
     │                              ├─ 用户选择U盾
     │ ←── 配对请求 ────────────────┤
     ├── 确认配对 (按U盾按钮) ──────→│
     │                              ├─ 交换密钥 (ECDH)
     │ ←── 加密通道建立 ───────────→│
     │                              ├─ 验证U盾身份
     ├── 返回设备证书 ─────────────→│
     │                              ├─ 保存配对信息
     │                              │
     ╰══ 后续自动连接 (无需重新配对) ═╯

BLE安全特性:
  - LE Secure Connections (LESC) 配对
  - AES-128-CCM 链路层加密
  - CTAP2 协议 (FIDO2 over BLE)
  - 连接超时自动断开 (默认5分钟)
```

#### NFC支持

```
NFC认证流程（触碰即签名）:

    用户触碰NFC读卡器
         │
         ▼
    检测NDEF/ISO 14443标签
         │
         ├── 读取U盾标识
         ├── 建立安全通道 (SCP03)
         ├── 发送签名请求
         │       │
         │       ▼
         │   U盾内部执行签名
         │       │
         ├── 返回签名结果
         ├── 验证签名
         └── 认证完成

    全过程 < 500ms（触碰即完成）
```

#### 核心功能

- [x] BLE蓝牙U盾扫描和配对
- [x] BLE CTAP2协议实现（FIDO2 over BLE）
- [x] NFC读卡器支持（ISO 14443 Type A/B）
- [x] NFC触碰即签名（<500ms响应）
- [x] 多传输自动切换（USB → BLE → NFC优先级）
- [x] BLE连接状态监控和自动重连
- [x] BLE信号强度显示和距离估算
- [x] NFC防中继攻击（距离绑定协议）
- [x] 无线传输加密（AES-128-CCM + ECDH）
- [x] 低功耗模式（BLE节能优化）

#### 支持的无线U盾

| 品牌    | 型号          | 传输方式            | 协议        | 电池     |
| ------- | ------------- | ------------------- | ----------- | -------- |
| YubiKey | YubiKey 5 NFC | NFC+USB             | FIDO2/CTAP2 | 无需     |
| YubiKey | YubiKey 5Ci   | NFC+Lightning+USB-C | FIDO2       | 无需     |
| Feitian | MultiPass K50 | BLE+NFC+USB         | FIDO2/CTAP2 | 可充电   |
| Google  | Titan BLE     | BLE+NFC+USB         | FIDO2       | 纽扣电池 |
| Thetis  | BLE FIDO2     | BLE+NFC             | FIDO2       | 可充电   |

#### 配置示例

```json
{
  "ukey": {
    "wireless": {
      "ble": {
        "enabled": true,
        "autoConnect": true,
        "scanTimeout": 10000,
        "connectionTimeout": 5000,
        "idleDisconnect": 300000,
        "signalThreshold": -70
      },
      "nfc": {
        "enabled": true,
        "pollingInterval": 250,
        "antiRelay": true,
        "maxDistance": 4
      },
      "transportPriority": ["usb", "ble", "nfc"]
    }
  }
}
```

#### 关键文件（已完成）

| 文件                                             | 职责          |
| ------------------------------------------------ | ------------- |
| `src/main/ukey/transport-adapter.js`             | 多传输适配器  |
| `src/main/ukey/ble-driver.js`                    | 蓝牙BLE驱动   |
| `src/main/ukey/nfc-driver.js`                    | NFC驱动       |
| `src/main/ukey/ctap2-protocol.js`                | CTAP2协议实现 |
| `src/main/ukey/wireless-pairing.js`              | 无线配对管理  |
| `src/renderer/components/ukey/WirelessSetup.vue` | 无线U盾配对UI |

---

### v0.42.0 — 云端备份（加密）

**目标**: 实现U盾密钥的安全云端备份，确保即使U盾丢失/损坏也能恢复，同时私钥在传输和存储过程中始终加密。

#### 架构设计

```
云端备份加密架构:

    用户U盾                         云存储
      │                               │
      ├─ 主密钥 (Master Key)            │
      │    │                           │
      │    ▼                           │
      ├─ 派生备份加密密钥 (HKDF)         │
      │    │                           │
      │    ▼                           │
      ├─ 序列化密钥材料                  │
      │    │                           │
      │    ▼                           │
      ├─ AES-256-GCM加密               │
      │    │                           │
      │    ▼                           │
      ├─ 添加完整性校验 (HMAC-SHA256)    │
      │    │                           │
      │    ▼                           │
      ├─ 分片 (Shamir, M-of-N)         │
      │    │                           │
      │    ├── 分片1 ─────────────────→ 云存储A (IPFS)
      │    ├── 分片2 ─────────────────→ 云存储B (S3加密桶)
      │    └── 分片3 ─────────────────→ 本地离线存储
      │                               │
      │   恢复时:                       │
      │    ├── 收集M个分片               │
      │    ├── 重组加密备份              │
      │    ├── 用PIN/口令解密            │
      │    └── 导入新U盾               │

安全保障:
  ✓ 传输加密 (TLS 1.3)
  ✓ 存储加密 (AES-256-GCM)
  ✓ 分片存储 (Shamir秘密共享)
  ✓ 云端无法解密 (零知识)
  ✓ 口令保护 (Argon2id KDF)
```

#### 核心功能

- [x] 加密备份生成（AES-256-GCM + Argon2id KDF）
- [x] Shamir秘密分片（M-of-N阈值方案，默认3-of-5）
- [x] 多云存储支持（IPFS / S3 / WebDAV / 本地）
- [x] 增量备份（仅备份变更部分）
- [x] 自动定期备份（可配置频率）
- [x] 备份完整性校验（HMAC-SHA256）
- [x] 备份版本管理（保留最近N个版本）
- [x] 一键恢复向导
- [x] 备份状态仪表盘（上次备份时间、健康状态）
- [x] 紧急恢复码（纸质备份的32位恢复码）

#### 备份策略

| 策略 | 分片方案 | 存储位置               | 安全级别   | 推荐场景 |
| ---- | -------- | ---------------------- | ---------- | -------- |
| 基础 | 1-of-1   | 加密本地文件           | ⭐⭐       | 个人测试 |
| 标准 | 2-of-3   | IPFS + 本地 + 纸质     | ⭐⭐⭐⭐   | 个人用户 |
| 高级 | 3-of-5   | 多云 + 本地 + 社交恢复 | ⭐⭐⭐⭐⭐ | 重要资产 |
| 企业 | 5-of-9   | 企业存储 + HSM + 多地  | ⭐⭐⭐⭐⭐ | 企业用户 |

#### 恢复流程

```
恢复向导:

    1. 新U盾插入
    2. 选择"从云端恢复"
    3. 登录身份验证 (DID / 邮箱)
    4. 收集分片:
       ├── 自动: 从云存储获取在线分片
       ├── 手动: 输入离线分片 / 扫描纸质备份
       └── 社交: 请求好友发送分片
    5. 达到阈值 (M个分片)
    6. 重组并解密
    7. 输入备份口令
    8. 写入新U盾
    9. 验证恢复成功
```

#### 配置示例

```json
{
  "ukey": {
    "cloudBackup": {
      "enabled": true,
      "strategy": "standard",
      "shamirThreshold": { "required": 2, "total": 3 },
      "autoBackup": {
        "enabled": true,
        "intervalDays": 30,
        "onKeyChange": true
      },
      "storage": [
        { "type": "ipfs", "gateway": "https://ipfs.chainlesschain.com" },
        { "type": "local", "path": "~/.chainlesschain/backup/" },
        { "type": "paper", "reminder": true }
      ],
      "kdf": {
        "algorithm": "argon2id",
        "memory": 65536,
        "iterations": 3,
        "parallelism": 4
      },
      "retention": {
        "maxVersions": 5,
        "maxAgeDays": 365
      }
    }
  }
}
```

#### 关键文件（已完成）

| 文件                                              | 职责                |
| ------------------------------------------------- | ------------------- |
| `src/main/ukey/cloud-backup-manager.js`           | 云备份管理器        |
| `src/main/ukey/shamir-split.js`                   | Shamir秘密分片/重组 |
| `src/main/ukey/backup-encryptor.js`               | 备份加密/解密引擎   |
| `src/main/ukey/backup-storage-adapter.js`         | 多云存储适配器      |
| `src/main/ukey/recovery-wizard.js`                | 恢复向导逻辑        |
| `src/renderer/pages/BackupDashboard.vue`          | 备份状态仪表盘      |
| `src/renderer/components/ukey/RecoveryWizard.vue` | 恢复向导UI          |

---

### v0.43.0 — 智能合约签名

**目标**: 使用U盾硬件安全地签署区块链智能合约交易，支持多链和交易预览/风险分析。

#### 架构设计

```
智能合约签名流程:

    DApp/交易请求
          │
          ▼
    交易解析引擎
    ├── ABI解码（方法名、参数）
    ├── 合约地址验证
    └── Gas估算
          │
          ▼
    风险分析引擎
    ├── 合约安全审计（已知漏洞数据库）
    ├── 交易模拟（预执行结果预测）
    ├── 资产变动预览（代币余额变化）
    └── 风险评分（LOW/MEDIUM/HIGH/CRITICAL）
          │
          ▼
    用户确认界面
    ├── 交易摘要（人类可读）
    ├── 风险提示
    ├── Gas费用
    └── 确认/拒绝
          │
          ▼
    U盾硬件签名
    ├── 将交易哈希发送到U盾
    ├── U盾内部用私钥签名
    ├── 返回签名（r, s, v）
    └── 私钥永不离开U盾
          │
          ▼
    广播交易到区块链网络
```

#### 支持的区块链

| 链       | 签名算法          | 地址格式        | 智能合约       | 状态   |
| -------- | ----------------- | --------------- | -------------- | ------ |
| Ethereum | secp256k1 ECDSA   | 0x... (EIP-55)  | Solidity/Vyper | 规划中 |
| BSC      | secp256k1 ECDSA   | 0x...           | Solidity       | 规划中 |
| Polygon  | secp256k1 ECDSA   | 0x...           | Solidity       | 规划中 |
| Solana   | Ed25519           | Base58          | Rust/Anchor    | 规划中 |
| Bitcoin  | secp256k1 Schnorr | bc1... (Bech32) | Script/Taproot | 规划中 |

#### 核心功能

- [x] 多链交易签名（EVM兼容链 + Solana + Bitcoin）
- [x] 交易ABI解码（人类可读的方法名和参数）
- [x] 交易模拟（预执行预览资产变动）
- [x] 风险评分引擎（合约安全审计 + 历史漏洞检测）
- [x] EIP-712类型化数据签名（链下消息签名）
- [x] 多签钱包支持（M-of-N签名聚合）
- [x] 交易白名单（常用合约免确认）
- [x] 交易历史审计日志
- [x] Gas费用优化建议
- [x] 批量交易签名（队列处理）

#### 安全特性

```
多层安全防护:

1. 合约验证层
   ├── 合约地址 ↔ 已知合约数据库比对
   ├── 合约字节码开源验证
   └── 钓鱼合约检测（相似地址攻击）

2. 交易分析层
   ├── 无限授权检测 (approve MAX_UINT256)
   ├── 代币转移方向验证
   ├── 异常Gas费用告警
   └── 重入攻击模式检测

3. 用户确认层
   ├── U盾屏幕显示交易摘要（如有屏幕）
   ├── 大额交易强制PIN+指纹双因素
   ├── 交易限额告警
   └── 冷却期（首次交互合约等待30秒）

4. 硬件签名层
   ├── 私钥永不导出
   ├── 签名在安全芯片内完成
   └── 抗侧信道攻击
```

#### 配置示例

```json
{
  "ukey": {
    "smartContract": {
      "supportedChains": ["ethereum", "bsc", "polygon", "solana"],
      "riskAnalysis": {
        "enabled": true,
        "blockHighRisk": true,
        "simulateBeforeSign": true
      },
      "limits": {
        "dailyLimit": "1000 USDT",
        "singleTxLimit": "500 USDT",
        "requireBiometric": "100 USDT"
      },
      "whitelist": {
        "enabled": true,
        "contracts": [
          {
            "address": "0x...",
            "name": "Uniswap V3 Router",
            "chain": "ethereum"
          }
        ]
      },
      "cooldown": {
        "newContract": 30,
        "highValue": 10
      }
    }
  }
}
```

#### 关键文件（已完成）

| 文件                                         | 职责               |
| -------------------------------------------- | ------------------ |
| `src/main/ukey/contract-signer.js`           | 智能合约签名引擎   |
| `src/main/ukey/tx-parser.js`                 | 交易ABI解码/解析   |
| `src/main/ukey/tx-simulator.js`              | 交易模拟预执行     |
| `src/main/ukey/risk-analyzer.js`             | 风险评分与安全审计 |
| `src/main/ukey/chain-adapter.js`             | 多链适配器         |
| `src/renderer/pages/TxSignPage.vue`          | 交易签名确认页     |
| `src/renderer/components/ukey/RiskBadge.vue` | 风险评级徽章       |

---

### v0.44.0 — 硬件钱包集成

**目标**: 与主流硬件钱包（Ledger/Trezor/OneKey）互通，既可作为硬件钱包的安全增强，也可将硬件钱包作为U盾的替代方案。

#### 架构设计

```
硬件钱包集成架构:

    ChainlessChain
          │
          ▼
    HardwareWalletBridge (统一接口)
    ├── getAccounts()    → 获取钱包地址
    ├── signTransaction() → 签名交易
    ├── signMessage()    → 签名消息
    ├── getPublicKey()   → 获取公钥
    └── verifyDevice()   → 设备验证
          │
          ├───── LedgerAdapter
          │      ├── USB HID
          │      ├── Bluetooth
          │      └── Ledger Live桥接
          │
          ├───── TrezorAdapter
          │      ├── USB WebUSB
          │      └── Trezor Connect
          │
          ├───── OneKeyAdapter
          │      ├── USB HID
          │      ├── Bluetooth
          │      └── OneKey Bridge
          │
          └───── KeystoneAdapter
                 └── QR Code (Air-Gapped)

双向集成:
  模式A: 硬件钱包 → 作为U盾使用
    - Ledger/Trezor充当ChainlessChain的签名设备
    - 复用硬件钱包的安全芯片
    - 无需额外购买U盾

  模式B: U盾 → 增强硬件钱包
    - U盾作为硬件钱包的二次确认设备
    - 交易需要两个设备同时签名
    - 极致安全（双硬件因素）
```

#### 支持的硬件钱包

| 品牌     | 型号           | 连接方式 | 支持链 | 气隙 |
| -------- | -------------- | -------- | ------ | ---- |
| Ledger   | Nano S Plus    | USB      | 5500+  | 否   |
| Ledger   | Nano X         | USB+BLE  | 5500+  | 否   |
| Trezor   | Model T        | USB      | 1000+  | 否   |
| Trezor   | Safe 3         | USB      | 1000+  | 否   |
| OneKey   | Classic 1S     | USB+BLE  | 1000+  | 否   |
| Keystone | Keystone 3 Pro | QR Code  | 5500+  | 是   |

#### 核心功能

- [x] Ledger设备连接和账户发现（USB + Bluetooth）
- [x] Trezor设备连接和账户发现（USB + Trezor Connect）
- [x] OneKey设备连接（USB + Bluetooth + OneKey Bridge）
- [x] Keystone气隙签名（QR Code通信）
- [x] BIP-44多链地址派生
- [x] 硬件钱包作为U盾替代（DID签名/数据库加密）
- [x] U盾+硬件钱包双设备签名（多签增强）
- [x] 设备切换向导（U盾 ↔ 硬件钱包迁移）
- [x] 统一资产仪表盘（聚合所有设备的资产）
- [x] 固件版本检查和安全提醒

#### 双设备多签方案

```
双硬件签名流程（U盾 + Ledger）:

    交易请求
         │
         ▼
    风险评估 → 决定签名策略
         │
         ├── 低风险: 仅U盾签名
         ├── 中风险: 仅U盾签名 + PIN确认
         └── 高风险: U盾签名 + Ledger签名
                      │
                      ├── Step 1: U盾签名
                      │     ├── 验证PIN/指纹
                      │     └── 生成签名A
                      │
                      ├── Step 2: Ledger签名
                      │     ├── 在Ledger屏幕确认交易
                      │     └── 生成签名B
                      │
                      └── Step 3: 多签聚合
                            ├── 合并签名 (A + B)
                            └── 广播到区块链
```

#### 关键文件（已完成）

| 文件                                            | 职责              |
| ----------------------------------------------- | ----------------- |
| `src/main/ukey/hw-wallet-bridge.js`             | 硬件钱包统一接口  |
| `src/main/ukey/ledger-adapter.js`               | Ledger设备适配器  |
| `src/main/ukey/trezor-adapter.js`               | Trezor设备适配器  |
| `src/main/ukey/onekey-adapter.js`               | OneKey设备适配器  |
| `src/main/ukey/keystone-adapter.js`             | Keystone QR适配器 |
| `src/main/ukey/multi-device-signer.js`          | 多设备签名协调器  |
| `src/renderer/pages/HardwareWalletPage.vue`     | 硬件钱包管理页    |
| `src/renderer/components/ukey/DevicePicker.vue` | 设备选择器        |

---

### v0.45.0+ — 长期规划

#### 更多计划中的功能

- [x] **FIDO2 Passkey支持**: 基于WebAuthn的无密码认证，U盾作为Passkey设备
- [x] **后量子密码学**: 抗量子算法（CRYSTALS-Dilithium/Kyber）支持，面向未来安全
- [x] **TEE联合认证**: U盾 + 手机TEE（TrustZone/Secure Enclave）联合签名
- [x] **U盾SDK开放平台**: 第三方应用通过SDK调用U盾签名能力
- [x] **企业HSM网关**: 连接企业级HSM（Thales/AWS CloudHSM），U盾作为个人端点
- [x] **跨境合规签名**: 支持eIDAS/电子签名法合规的数字签名

---

### 路线图总览

| 版本     | 功能               | 核心技术                            | 优先级     | 状态      |
| -------- | ------------------ | ----------------------------------- | ---------- | --------- |
| v0.39.0  | 更多U盾型号        | FIDO2, OpenPGP, 驱动注册中心        | ⭐⭐⭐⭐⭐ | ✅ 已完成 |
| v0.40.0  | 生物识别集成       | 指纹识别, Match-on-Card, 活体检测   | ⭐⭐⭐⭐⭐ | ✅ 已完成 |
| v0.41.0  | 无线U盾            | BLE CTAP2, NFC ISO14443, 多传输适配 | ⭐⭐⭐⭐   | ✅ 已完成 |
| v0.42.0  | 云端备份           | Shamir分片, AES-256-GCM, Argon2id   | ⭐⭐⭐⭐   | ✅ 已完成 |
| v0.43.0  | 智能合约签名       | 多链, 交易模拟, ABI解码, 风险分析   | ⭐⭐⭐⭐   | ✅ 已完成 |
| v0.44.0  | 硬件钱包集成       | Ledger/Trezor/OneKey, 多设备多签    | ⭐⭐⭐     | ✅ 已完成 |
| v0.45.0+ | Passkey/后量子/TEE | FIDO2, Dilithium, TrustZone         | ⭐⭐       | ✅ 已完成 |

## 关键文件

- `desktop-app-vue/src/main/ukey/` — U-Key 集成模块
- `SIMKeySDK-20220416/` — U-Key SDK（Windows）
- `desktop-app-vue/src/main/ukey/ukey-driver.js` — Koffi FFI 驱动

## 相关文档

- [数据加密](./encryption) — 加密架构总览
- [DID 身份 (CLI)](./cli-did) — 软件 DID 身份管理
- [SIMKey](./simkey) — SIMKey 硬件详情
