# SIMKey集成

> **版本**: v0.39.0 | **平台**: Android 9+ / iOS 16+(eSIM) | **12大安全增强**: iOS eSIM、5G优化、NFC离线签名、多SIM卡切换、健康监控、量子抗性、OTA远程配置、TEE深度集成、跨运营商漫游、零知识证明、卫星通信SIM、HSM联合认证

SIMKey利用SIM卡内置的安全芯片，为移动端提供硬件级安全保护。v0.39.0新增eSIM OTA远程配置、TEE可信执行环境深度集成、跨运营商SIMKey漫游协议、基于SIMKey的零知识证明、天通一号卫星通信SIM支持和HSM联合认证。

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

## iOS eSIM支持

> **状态**: ✅ 已实现 v0.38.0 | **平台**: iOS 16+

### 概述

通过Apple的eSIM API和Secure Enclave集成，iOS用户现在可以使用eSIM作为SIMKey的安全载体，无需物理SIM卡即可获得硬件级安全保护。

### 技术原理

```
传统SIMKey:
  物理SIM卡 → OMAPI → 安全Applet → 密钥操作

eSIM SIMKey:
  eSIM Profile → Carrier API → Secure Enclave桥接 → 密钥操作

混合方案:
  eSIM认证 + Secure Enclave存储 = 双重硬件安全
```

### 支持设备

| 设备             | iOS版本    | eSIM类型        | 支持状态   |
| ---------------- | ---------- | --------------- | ---------- |
| iPhone 15/16系列 | iOS 17+    | 双eSIM          | ⭐⭐⭐⭐⭐ |
| iPhone 14系列    | iOS 16+    | eSIM + nano-SIM | ⭐⭐⭐⭐⭐ |
| iPhone 13/12系列 | iOS 16+    | eSIM + nano-SIM | ⭐⭐⭐⭐   |
| iPhone SE 3      | iOS 16+    | eSIM + nano-SIM | ⭐⭐⭐⭐   |
| iPad Pro (M系列) | iPadOS 16+ | eSIM            | ⭐⭐⭐     |

### 设置步骤

#### 1. 激活eSIM SIMKey

```
1. 打开ChainlessChain iOS应用
2. 设置 → 安全 → SIMKey
3. 选择"eSIM模式"
4. 系统检测eSIM配置文件
5. 请求运营商授权（自动完成）
6. 初始化安全通道
```

#### 2. 密钥生成

```
1. 选择安全级别:
   ○ 标准: eSIM + PIN（推荐大多数用户）
   ● 增强: eSIM + Secure Enclave + 生物识别（推荐）
   ○ 最高: eSIM + Secure Enclave + 生物识别 + Passkey

2. 设置PIN码（6-8位）
3. 启用Face ID/Touch ID
4. 生成密钥对（约15-30秒）
5. 完成
```

#### 3. 与Android SIMKey互通

```
场景: 已有Android SIMKey，需要在iOS设备上使用

1. 在Android设备上导出助记词
2. 在iOS设备上选择"从助记词恢复"
3. 输入12个助记词
4. 密钥自动写入eSIM安全区域
5. 两端共享相同DID身份
```

### API示例

```swift
import ChainlessChainSDK

// 初始化eSIM SIMKey
let simkey = try await SIMKey(mode: .eSIM)

// 检查可用性
guard simkey.isAvailable else {
    print("eSIM SIMKey不可用")
    return
}

// 使用Face ID验证
try await simkey.authenticate(biometric: .faceID)

// 签名
let data = "Hello World".data(using: .utf8)!
let signature = try await simkey.sign(data)

// 加密
let encrypted = try await simkey.encrypt(data)

// 获取公钥
let publicKey = try await simkey.getPublicKey()
```

### 与传统SIMKey对比

| 特性           | 物理SIM SIMKey | eSIM SIMKey   |
| -------------- | -------------- | ------------- |
| 平台支持       | Android        | iOS + Android |
| 安全等级       | ⭐⭐⭐⭐       | ⭐⭐⭐⭐⭐    |
| 便捷性         | 需插拔SIM卡    | 无需物理操作  |
| 多设备         | 需多张SIM卡    | 云端eSIM配置  |
| 运营商依赖     | 高             | 低            |
| Secure Enclave | ❌             | ✅ 可联合使用 |

::: tip
eSIM SIMKey结合了eSIM的便捷性和Secure Enclave的安全性，是iOS用户的最佳选择
:::

## 5G SIM卡优化

> **状态**: ✅ 已实现 v0.38.0 | **提升**: 签名速度3-5倍

### 概述

针对5G USIM卡的增强安全芯片进行专门优化，利用5G SIM卡更强的处理能力和更大的存储空间，显著提升加密操作性能。

### 5G SIM卡增强特性

```
4G USIM卡:
  处理器: 16-bit MCU
  存储: 64-256 KB
  加密: RSA-2048, ECC P-256
  速度: 签名 200-500ms

5G USIM卡:
  处理器: 32-bit ARM SecurCore
  存储: 512 KB - 1 MB
  加密: RSA-4096, ECC P-384, SM2/SM3/SM4
  速度: 签名 50-150ms ✨
```

### 性能提升

| 操作             | 4G SIM | 5G SIM | 提升倍数 |
| ---------------- | ------ | ------ | -------- |
| RSA-2048签名     | 350ms  | 80ms   | 4.4x     |
| ECC P-256签名    | 200ms  | 45ms   | 4.4x     |
| AES-256加密(1KB) | 150ms  | 35ms   | 4.3x     |
| 密钥生成         | 120s   | 30s    | 4.0x     |
| 批量签名(10次)   | 3.5s   | 0.6s   | 5.8x     |

### 国密算法支持

5G USIM卡原生支持中国国家商用密码标准：

```
支持的国密算法:
✅ SM2 - 椭圆曲线公钥密码（替代RSA/ECC）
✅ SM3 - 密码杂凑算法（替代SHA-256）
✅ SM4 - 分组密码算法（替代AES-128）
✅ SM9 - 标识密码算法（基于身份的加密）

启用方式:
设置 → 安全 → SIMKey → 加密算法
○ 国际标准（RSA/ECC/AES）
● 国密标准（SM2/SM3/SM4）（推荐国内用户）
○ 混合模式（同时支持国际+国密）
```

### 5G安全增强

```
5G SIM卡新增安全特性:
✅ SUPI/SUCI隐私保护 - 用户身份加密传输
✅ 5G-AKA认证 - 增强型双向认证
✅ 安全元件隔离 - 独立安全域
✅ 远程Applet管理 - OTA安全更新
✅ 防侧信道攻击 - 硬件级防护

ChainlessChain利用的增强:
✅ 利用SUCI进行匿名DID通信
✅ 5G-AKA作为额外认证因子
✅ 独立安全域隔离应用密钥
```

### 自动检测与优化

```
设置 → 安全 → SIMKey → 性能优化

检测结果:
✓ SIM卡类型: 5G USIM
✓ 芯片型号: ARM SecurCore SC300
✓ 存储空间: 768 KB (可用 512 KB)
✓ 支持算法: RSA, ECC, SM2, SM3, SM4
✓ 批量操作: 支持（最大并发 4）

自动优化:
✓ 已启用批量签名模式
✓ 已启用指令流水线
✓ 已切换到ECC P-384（更快更安全）
✓ 已启用安全域缓存
```

### 运营商5G USIM支持

| 运营商   | 5G USIM      | 国密支持       | 获取方式        |
| -------- | ------------ | -------------- | --------------- |
| 中国移动 | ✅ 超级SIM卡 | ✅ SM2/SM3/SM4 | 营业厅免费换卡  |
| 中国联通 | ✅ 5G USIM   | ✅ SM2/SM3/SM4 | 营业厅/线上申请 |
| 中国电信 | ✅ 白卡USIM  | ✅ SM2/SM3/SM4 | 营业厅换卡      |

::: tip
建议到运营商营业厅免费更换5G USIM卡，可获得显著的性能提升和国密算法支持
:::

## NFC离线签名

> **状态**: ✅ 已实现 v0.38.0 | **场景**: 离线交易、面对面验证

### 概述

通过NFC近场通信技术，两台设备可以在完全离线状态下完成签名验证和数据交换，适用于无网络环境下的身份认证和交易签名。

### 工作原理

```
设备A（发起方）          NFC通道          设备B（签名方）
    │                    │                    │
    ├─ 生成签名请求 ──────>│                    │
    │                    ├──── 传输请求 ──────>│
    │                    │                    ├─ 验证请求
    │                    │                    ├─ 输入PIN/生物识别
    │                    │                    ├─ SIMKey签名
    │                    │<──── 返回签名 ──────┤
    ├─ 验证签名 <─────────│                    │
    ├─ 完成              │                    │
```

### 应用场景

#### 场景一: 离线身份验证

```
场景: 在无网络环境下验证身份

1. 对方设备展示验证请求
2. 将手机靠近对方设备（NFC触碰）
3. 输入PIN码或使用指纹
4. SIMKey对挑战进行签名
5. 签名通过NFC返回
6. 对方设备本地验证签名
7. 身份验证完成 ✓

全程无需网络！
```

#### 场景二: 离线交易签名

```
场景: 面对面数字资产转账

1. 收款方生成收款请求（含金额、地址）
2. 两台手机NFC触碰
3. 付款方确认交易详情
4. 输入PIN码授权
5. SIMKey签名交易
6. 签名交易通过NFC传输
7. 任一方联网后广播交易

交易安全性:
✓ 签名在SIM卡安全芯片内完成
✓ 私钥不会离开SIM卡
✓ 交易数据经过加密传输
✓ 支持交易金额限制
```

#### 场景三: 离线文件签名

```
场景: 合同或文件签名

1. 发起方选择待签名文件
2. 生成文件哈希
3. NFC触碰传输签名请求
4. 签名方确认文件摘要
5. SIMKey签名文件哈希
6. 签名结果NFC返回
7. 附加签名到文件
```

### 安全机制

```
NFC签名安全保障:
✅ 距离限制: NFC通信距离 < 4cm，防止远程窃听
✅ 加密通道: NFC数据使用ECDH密钥协商加密
✅ 防重放: 每次签名包含时间戳和随机数
✅ 金额限制: 可设置单笔/日累计限额
✅ 白名单: 可限制只与已知设备交互
✅ 操作日志: 所有NFC签名操作记录到审计日志
```

### 配置

```
设置 → 安全 → SIMKey → NFC离线签名

开关:
■ 启用NFC签名

安全策略:
■ 每次签名需要PIN码/生物识别
□ 小额免验证（< ¥100）
■ 记录所有操作日志

限额设置:
  单笔限额: ¥ [10000]
  日累计限额: ¥ [50000]

设备白名单:
  ✓ 李明的手机 (did:cc:Qm1234...)
  ✓ 王芳的手机 (did:cc:Qm5678...)
  + 添加设备
```

### API示例

```kotlin
import com.chainlesschain.simkey.NfcSigner

// 发起方
val nfcSigner = NfcSigner(context)

// 创建签名请求
val request = SignRequest(
    type = SignType.TRANSACTION,
    data = transactionData,
    amount = 1000.0,
    recipient = "did:cc:QmXXXX"
)

// 通过NFC发送请求并等待签名
nfcSigner.requestSignature(request) { result ->
    when (result) {
        is SignResult.Success -> {
            val signature = result.signature
            // 验证签名并广播交易
        }
        is SignResult.Rejected -> {
            // 用户拒绝签名
        }
        is SignResult.Timeout -> {
            // NFC连接超时
        }
    }
}
```

## 多SIM卡自动切换

> **状态**: ✅ 已实现 v0.38.0 | **支持**: 双卡双待设备

### 概述

在双卡双待设备上，ChainlessChain可以自动管理多张SIM卡的SIMKey功能，根据网络状态、安全策略和用户偏好智能切换活跃的SIMKey。

### 切换策略

```
设置 → 安全 → SIMKey → 多卡管理

切换策略:
● 自动（推荐）- 根据网络和安全状态自动选择
○ 手动 - 每次操作手动选择SIM卡
○ 主卡优先 - 始终使用主卡，故障时切换
○ 轮换 - 交替使用，均衡磨损
```

### 自动切换规则

| 优先级 | 条件                  | 动作                        |
| ------ | --------------------- | --------------------------- |
| 1      | 当前SIM卡不可用       | 立即切换到备用卡            |
| 2      | 网络信号差 (<-100dBm) | 切换到信号更好的卡          |
| 3      | 安全Applet异常        | 切换到正常卡并报警          |
| 4      | 达到单卡操作上限      | 轮换到另一张卡              |
| 5      | 用户预设时间段        | 按时间段切换（如工作/个人） |

### 双卡配置

```
SIM卡槽 1 (主卡):
  运营商: 中国移动 5G
  SIMKey状态: ✅ 已激活
  密钥指纹: SHA256:1a2b...
  角色: 日常签名

SIM卡槽 2 (副卡):
  运营商: 中国联通 5G
  SIMKey状态: ✅ 已激活
  密钥指纹: SHA256:1a2b... (相同密钥)
  角色: 备份 / 国际漫游

同步状态: ✅ 两卡密钥一致
最后同步: 2026-02-21 10:30:00
```

### 场景示例

#### 场景一: 网络故障自动切换

```
时间线:
10:00 - 使用SIM1正常签名
10:15 - SIM1网络中断
10:15 - 系统检测到异常，自动切换到SIM2
10:15 - 通知: "已自动切换到SIM2（联通），原因：SIM1网络不可用"
10:30 - SIM1网络恢复
10:30 - 通知: "SIM1已恢复，是否切回？[是] [保持SIM2]"
```

#### 场景二: 工作/个人分离

```
设置 → SIMKey → 多卡管理 → 时间段规则

规则:
  工作时间 (09:00-18:00, 周一至周五):
    使用: SIM1 (公司号码)
    用途: 工作相关签名和加密

  个人时间 (其余时间):
    使用: SIM2 (个人号码)
    用途: 个人事务签名
```

### 密钥同步

```
多卡密钥同步方式:

方式一: 相同密钥（推荐）
  - 两张SIM卡写入相同密钥
  - 共享相同DID身份
  - 任意一张卡都可以操作
  - 设置 → SIMKey → 同步密钥到副卡

方式二: 独立密钥
  - 每张卡独立密钥
  - 不同DID身份
  - 适用于完全隔离的场景

方式三: 主从模式
  - 主卡持有主密钥
  - 副卡持有派生密钥
  - 副卡权限受限（如仅签名，不可加密）
```

## SIM卡健康监控

> **状态**: ✅ 已实现 v0.38.0 | **路径**: 设置 → 安全 → SIMKey → 健康监控

### 概述

实时监控SIM卡和SIMKey安全Applet的运行状态，提供健康评分、异常预警和维护建议，确保SIMKey始终处于最佳工作状态。

### 健康仪表盘

```
┌─────────────────────────────────────┐
│        SIMKey 健康监控               │
│                                     │
│  综合健康评分: 95/100  🟢 优秀      │
│                                     │
│  ┌─────────┐  ┌─────────┐          │
│  │ SIM硬件  │  │ Applet  │          │
│  │  98/100  │  │  96/100 │          │
│  │   🟢     │  │   🟢    │          │
│  └─────────┘  └─────────┘          │
│                                     │
│  ┌─────────┐  ┌─────────┐          │
│  │ 密钥状态 │  │ 性能指标 │          │
│  │  94/100  │  │  92/100 │          │
│  │   🟢     │  │   🟢    │          │
│  └─────────┘  └─────────┘          │
│                                     │
│  最近检查: 2026-02-21 10:00         │
│  下次检查: 2026-02-21 22:00         │
└─────────────────────────────────────┘
```

### 监控指标

| 类别   | 指标         | 正常范围 | 告警阈值 |
| ------ | ------------ | -------- | -------- |
| 硬件   | SIM卡温度    | 20-45°C  | >55°C    |
| 硬件   | 读写错误率   | <0.01%   | >1%      |
| 硬件   | 通信延迟     | <50ms    | >200ms   |
| Applet | 响应时间     | <100ms   | >500ms   |
| Applet | 可用存储     | >50%     | <20%     |
| Applet | 错误计数     | 0        | >5次/天  |
| 密钥   | PIN剩余次数  | 5        | ≤2       |
| 密钥   | 证书有效期   | >90天    | <30天    |
| 密钥   | 签名计数     | -        | >100万次 |
| 性能   | 平均签名耗时 | <300ms   | >1000ms  |
| 性能   | 日操作量     | -        | >1000次  |

### 智能告警

```
告警级别:

🟢 正常 - 所有指标正常
🟡 注意 - 部分指标接近阈值
🟠 警告 - 需要关注，建议维护
🔴 危险 - 立即处理，可能影响使用

告警示例:
⚠️ [警告] PIN剩余次数仅剩2次
   建议: 确认PIN码后重置错误计数

⚠️ [注意] SIM卡读写延迟升高 (180ms)
   建议: 清理SIM卡触点或重新插拔

⚠️ [警告] 证书将在25天后过期
   建议: 设置 → SIMKey → 续期证书
```

### 自动维护

```
设置 → 安全 → SIMKey → 健康监控 → 自动维护

■ 定期健康检查（每12小时）
■ 异常自动诊断
■ Applet缓存自动清理（每周）
■ 性能数据自动收集
□ 自动续期证书（到期前30天）
■ 健康报告推送通知

维护历史:
  2026-02-21 04:00 - 定期健康检查 ✓ 评分95
  2026-02-20 16:00 - 定期健康检查 ✓ 评分96
  2026-02-18 04:00 - 缓存自动清理 ✓ 释放32KB
  2026-02-15 09:23 - 异常诊断 ✓ 已自动修复通信延迟
```

### 健康报告导出

```
设置 → SIMKey → 健康监控 → 导出报告

导出格式:
○ PDF报告（适合存档）
● JSON数据（适合分析）
○ CSV表格（适合Excel查看）

报告内容:
✓ 综合健康评分趋势（30天）
✓ 各项指标详细数据
✓ 异常事件记录
✓ 维护操作历史
✓ 性能变化趋势图
✓ 建议和改进措施
```

## 量子抗性算法升级

> **状态**: ✅ 已实现 v0.38.0 | **标准**: NIST PQC 标准

### 概述

随着量子计算的发展，传统RSA和ECC加密算法面临被量子计算机破解的风险。ChainlessChain SIMKey现已支持后量子密码学（Post-Quantum Cryptography），确保在量子计算时代数据安全不受威胁。

### 量子威胁说明

```
传统算法的量子风险:

RSA-2048:
  经典计算机破解: ~10^23 年（安全）
  量子计算机破解: ~8小时（不安全！）

ECC P-256:
  经典计算机破解: ~10^17 年（安全）
  量子计算机破解: ~10分钟（不安全！）

"先收集，后破解"攻击:
  攻击者现在收集加密数据 → 未来量子计算机成熟后破解
  ⚠️ 敏感数据的保密期通常 > 10年
  ⚠️ 量子计算机预计 5-15年内实用化
```

### 支持的后量子算法

| 算法               | 类型     | NIST标准 | 安全级别  | SIMKey支持 |
| ------------------ | -------- | -------- | --------- | ---------- |
| ML-KEM (Kyber)     | 密钥封装 | FIPS 203 | Level 3/5 | ✅         |
| ML-DSA (Dilithium) | 数字签名 | FIPS 204 | Level 3/5 | ✅         |
| SLH-DSA (SPHINCS+) | 数字签名 | FIPS 205 | Level 3/5 | ✅         |
| XMSS               | 状态签名 | RFC 8391 | Level 5   | ✅         |

### 混合模式（推荐）

```
ChainlessChain采用混合加密策略:
  传统算法 + 后量子算法 = 双重保护

签名: ECC P-256 + ML-DSA Level 3
  → 即使一种算法被破解，另一种仍然保护

密钥交换: ECDH P-256 + ML-KEM-768
  → 同时对传统和量子攻击免疫

优势:
✅ 向后兼容: 旧版客户端仍可验证ECC签名
✅ 前向安全: 量子计算机无法破解ML-DSA/ML-KEM
✅ 平滑过渡: 无需一次性全面升级
```

### 配置

```
设置 → 安全 → SIMKey → 加密算法 → 量子抗性

模式选择:
○ 经典模式 - 仅使用传统算法（RSA/ECC）
● 混合模式 - 传统 + 后量子算法（推荐）
○ 纯后量子 - 仅使用后量子算法（实验性）

签名算法:
● ML-DSA-65 (Dilithium Level 3)（推荐）
○ ML-DSA-87 (Dilithium Level 5)
○ SLH-DSA-SHA2-192f (SPHINCS+)

密钥封装:
● ML-KEM-768 (Kyber Level 3)（推荐）
○ ML-KEM-1024 (Kyber Level 5)

⚠️ 注意: 后量子算法的签名和密钥尺寸较大
  ML-DSA-65签名: 3,293 字节 (vs ECC: 64字节)
  ML-KEM-768公钥: 1,184 字节 (vs ECC: 33字节)
```

### 密钥迁移

```
从传统算法迁移到量子抗性算法:

设置 → SIMKey → 量子抗性 → 密钥迁移

步骤:
1. 系统评估当前密钥状态
2. 生成后量子密钥对（在SIM安全芯片内）
3. 使用原密钥签名新公钥（信任链传递）
4. 发布DID文档更新（包含新公钥）
5. 旧密钥保留为备用（6个月过渡期）
6. 过渡期结束后可选择停用旧密钥

迁移状态:
  传统密钥: ✅ 活跃（过渡期保留）
  混合密钥: ✅ 已生成，已发布
  DID文档: ✅ 已更新，包含双密钥
  联系人通知: ✅ 已通知 15/15 位联系人
```

### 性能影响

| 操作     | 传统ECC | ML-DSA混合 | 开销  |
| -------- | ------- | ---------- | ----- |
| 签名     | 200ms   | 280ms      | +40%  |
| 验证     | 50ms    | 85ms       | +70%  |
| 密钥交换 | 100ms   | 160ms      | +60%  |
| 存储占用 | 1 KB    | 8 KB       | +7 KB |

::: tip
虽然后量子算法有一定性能开销，但在5G USIM卡上这些额外开销几乎不影响用户体验。建议所有用户启用混合模式以获得长期安全保障。
:::

## eSIM远程配置（OTA密钥部署）

> **状态**: ✅ 已实现 v0.39.0 | **标准**: GSMA SGP.22 RSP

### 概述

通过GSMA远程SIM配置（Remote SIM Provisioning）标准，实现eSIM Profile的OTA（Over-The-Air）下载安装和SIMKey密钥的远程部署，支持企业批量部署场景。

### 技术架构

```
                          ┌──────────┐
                          │  SM-DP+  │ (Subscription Manager - Data Preparation)
                          │  服务器  │
                          └────┬─────┘
                               │ SCP81 安全通道
                               │ (TLS 1.2 + ECDHE)
    ┌──────────┐          ┌────┴─────┐          ┌──────────┐
    │  SM-DS   │◄────────►│   LPA    │◄────────►│  eUICC   │
    │ 发现服务 │          │ 本地助手 │          │ SIM芯片  │
    └──────────┘          └──────────┘          └──────────┘

OTA密钥部署流程:
  1. SM-DP+ 生成加密的密钥材料
  2. 通过 SCP81 安全通道传输到设备
  3. LPA 将密钥写入 eUICC 安全域
  4. SIMKey Applet 接收并存储密钥
  5. 注册公钥到 DID 文档
```

### Profile管理

```
设置 → 安全 → SIMKey → eSIM管理

Profile列表:
  ✅ 中国移动 5G (ICCID: 89860...)  [启用]
  ⬚ 中国联通 5G (ICCID: 89860...)  [已安装]
  + 添加新Profile

操作:
  [下载Profile]  输入激活码或扫描二维码
  [启用/禁用]    切换活跃Profile
  [删除]         移除已安装的Profile
```

### OTA密钥部署

#### 单设备部署

```
设置 → 安全 → SIMKey → 远程密钥部署

1. 选择目标密钥类型:
   ● ECC P-256（推荐，兼容性好）
   ○ ECC P-384（更高安全性）
   ○ ML-DSA-65（后量子，实验性）

2. 选择部署方式:
   ● 新建 — 在SIM安全芯片内生成新密钥
   ○ 恢复 — 从加密备份导入密钥

3. 建立安全通道...
4. 密钥生成/导入中...
5. 注册到DID文档...
6. 完成 ✓

密钥信息:
  密钥ID: key-a1b2c3d4
  类型: ECC P-256
  公钥指纹: SHA256:5e8f...
  部署时间: 2026-02-23 10:30:00
```

#### 企业批量部署

```
场景: IT管理员为100名员工批量部署SIMKey

管理控制台 → 设备管理 → 批量部署

1. 上传设备清单 (CSV: EID, 员工ID, 部门)
2. 选择密钥策略:
   - 密钥类型: ECC P-256
   - 安全策略: 标准
   - PIN策略: 首次使用时设置
3. 开始批量部署

进度:
  ████████████████████░░░░░ 80/100
  成功: 78  失败: 2  进行中: 20

失败处理:
  设备 EID:1234... — 网络超时，已排入重试队列
  设备 EID:5678... — eUICC存储不足
```

### 密钥轮换

```
设置 → SIMKey → 远程密钥部署 → 密钥轮换

1. 生成新密钥对（在SIM安全芯片内）
2. 使用旧密钥签名新公钥（信任链传递）
3. 更新DID文档（包含新旧双公钥）
4. 过渡期: 180天（旧密钥仍可用）
5. 过渡结束后停用旧密钥

轮换状态:
  旧密钥: ✅ 活跃（过渡期保留）
  新密钥: ✅ 已部署，已发布
  过渡期剩余: 178天
```

### API示例

```kotlin
import com.chainlesschain.simkey.ESimOtaManager

val otaManager = ESimOtaManager(config)
await otaManager.initialize()

// 下载eSIM Profile
val result = otaManager.downloadProfile("1\$smdp.example.com\$MATCHING-ID")

// 远程部署密钥
val deployResult = otaManager.deployKey(
    targetEid = "89049032...",
    keyType = "ec256"
)

// 企业批量部署
val batchResult = otaManager.batchDeploy(targetsList)
```

::: tip
OTA密钥部署需要网络连接。对于离线场景，请使用NFC离线签名或助记词恢复方式。
:::

## TEE可信执行环境深度集成

> **状态**: ✅ 已实现 v0.39.0 | **平台**: ARM TrustZone / Intel SGX / Apple Secure Enclave

### 概述

深度集成可信执行环境（Trusted Execution Environment），SIMKey与TEE协同工作，提供双重硬件安全保障。PIN码在TEE安全世界中输入和验证，密钥操作在隔离环境中执行，即使操作系统被攻破也无法窃取密钥。

### 技术原理

```
普通世界 (Normal World)          安全世界 (Secure World / TEE)
┌─────────────────────┐         ┌──────────────────────────┐
│  ChainlessChain App │         │  Trusted Application     │
│  ┌───────────────┐  │         │  ┌────────────────────┐  │
│  │   SIMKey SDK  │──┼────────►│  │  SIMKey Trustlet   │  │
│  └───────────────┘  │  TEE    │  │  - PIN验证          │  │
│                     │  Client │  │  - 密钥缓存          │  │
│  ┌───────────────┐  │  API    │  │  - 签名执行          │  │
│  │   Android OS  │  │         │  └────────────────────┘  │
│  └───────────────┘  │         │  ┌────────────────────┐  │
│                     │         │  │  Trusted UI         │  │
└─────────────────────┘         │  │  (安全PIN输入)      │  │
                                │  └────────────────────┘  │
                                │  ┌────────────────────┐  │
                                │  │  Sealed Storage    │  │
                                │  │  (密封密钥存储)     │  │
                                │  └────────────────────┘  │
                                └──────────────────────────┘
```

### 平台支持

| 平台 | TEE类型 | 安全级别 | 支持特性 |
| --- | --- | --- | --- |
| Android (高通) | ARM TrustZone / QSEE | ⭐⭐⭐⭐⭐ | 全部 |
| Android (三星) | ARM TrustZone / TEEGRIS | ⭐⭐⭐⭐⭐ | 全部 |
| Android (华为) | ARM TrustZone / iTrustee | ⭐⭐⭐⭐⭐ | 全部 |
| iOS | Secure Enclave | ⭐⭐⭐⭐⭐ | 全部 |
| Desktop (Intel) | Intel SGX | ⭐⭐⭐⭐ | 密封存储、远程证明 |
| Desktop (AMD) | AMD SEV | ⭐⭐⭐ | 内存加密 |

### 安全能力

```
TEE 提供的安全能力:

✅ 密钥生成 — 密钥在TEE内生成，私钥不离开安全世界
✅ 安全签名 — 签名操作在TEE隔离环境中执行
✅ 密封存储 — 数据绑定到设备+TEE，其他设备无法解封
✅ 远程证明 — 向第三方证明设备TEE完整性
✅ Trusted UI — PIN码在TEE中渲染和验证，防截屏防键盘监听
✅ 生物识别绑定 — 密钥与指纹/面容绑定
```

### SIMKey + TEE 双重签名

```
最高安全等级: SIMKey硬件签名 + TEE密钥签名

场景: 大额交易需要双重硬件验证

1. TEE请求生物识别 → Face ID验证通过
2. TEE内部签名（TEE私钥）
3. SIMKey签名（SIM卡安全芯片私钥）
4. 合并双重签名
5. 验证方需同时验证两个签名

安全性:
  ✓ 攻破操作系统 → 仍需攻破TEE + SIM卡
  ✓ 丢失SIM卡 → 仍需攻破TEE（绑定设备）
  ✓ 丢失手机 → 仍需生物识别 + SIMKey PIN
```

### 远程证明

```
设置 → 安全 → SIMKey → TEE证明

远程证明报告:
  TEE类型: ARM TrustZone (QSEE)
  安全级别: 硬件级
  安全启动: ✅ 正常
  篡改检测: ✅ 未检测到篡改
  调试模式: ✅ 已关闭
  TEE版本: 3.0
  Applet版本: 1.2.0

  信任评估: 🟢 高信任度

[生成证明报告]  [验证远程报告]
```

### 配置

```
设置 → 安全 → SIMKey → TEE集成

■ 启用TEE加速签名
■ 启用Trusted UI（安全PIN输入）
■ 启用密封存储（本地密钥缓存加密）
■ 启用远程证明
□ 强制双重签名（SIMKey + TEE）
■ 生物识别绑定密钥

安全级别:
○ 标准 — 仅TEE签名加速
● 增强 — TEE + Trusted UI + 密封存储（推荐）
○ 最高 — 强制双重签名 + 远程证明
```

### API示例

```kotlin
import com.chainlesschain.simkey.TeeIntegration

val tee = TeeIntegration(config)
tee.initialize()

// 在TEE中生成密钥
val keyHandle = tee.generateKeyInTee(
    algorithm = "ec256",
    biometricBound = true,
    requireAuth = true
)

// TEE内签名
val signature = tee.signInTee(keyHandle.keyId, data)

// SIMKey + TEE 双重签名
val dualSig = tee.dualSign(
    teeKeyId = keyHandle.keyId,
    simkeySignFn = { data -> simkey.sign(data) },
    data = transactionData
)

// 远程证明
val report = tee.generateAttestationReport(nonce)
```

## 跨运营商SIMKey漫游协议

> **状态**: ✅ 已实现 v0.39.0 | **协议**: DID联邦认证 + GSMA互操作

### 概述

当用户从归属运营商网络切换到其他运营商网络时（如出差、旅行），SIMKey的身份认证和签名能力需要在新网络中继续可用。跨运营商漫游协议通过DID联邦认证和运营商联盟机制，实现SIMKey身份的无缝漫游。

### 漫游原理

```
归属网络 (Home)              拜访网络 (Visiting)
┌────────────────┐          ┌────────────────┐
│  中国移动       │   DID    │  中国联通       │
│  ┌──────────┐  │  联邦    │  ┌──────────┐  │
│  │ SIMKey   │  │  认证    │  │ 漫游代理  │  │
│  │ 归属注册 │◄─┼─────────►│  │          │  │
│  └──────────┘  │          │  └──────────┘  │
│                │          │                │
│  ┌──────────┐  │  安全    │  ┌──────────┐  │
│  │ HSM/CA   │  │  通道    │  │ HSM/CA   │  │
│  └──────────┘  │◄────────►│  └──────────┘  │
└────────────────┘          └────────────────┘

漫游流程:
  1. 设备检测到网络切换
  2. 向拜访网络发起联邦认证
  3. 拜访网络向归属网络验证DID身份
  4. 协商漫游参数（安全级别、签名限额）
  5. 建立安全通道，开始漫游
```

### 运营商联盟

```
SIMKey运营商联盟成员:

┌─────────────┬─────────────┬──────────────┐
│  中国移动    │  中国联通    │  中国电信     │
│  信任级别:   │  信任级别:   │  信任级别:    │
│  ⭐⭐⭐⭐⭐  │  ⭐⭐⭐⭐⭐  │  ⭐⭐⭐⭐⭐   │
│  完全互通    │  完全互通    │  完全互通     │
└─────────────┴─────────────┴──────────────┘

支持的操作:
  完全信任: 签名、加密、解密、密钥管理、备份
  标准信任: 签名、加密、解密
  受限信任: 仅验证和小额签名
  最低信任: 仅验证签名
```

### 漫游安全策略

```
设置 → 安全 → SIMKey → 漫游策略

切换策略:
● 自动（推荐）— 根据网络状态自动漫游
○ 手动 — 每次漫游需要确认
○ 禁止 — 不允许漫游

安全级别:
○ 完全 — 所有操作可用
● 标准 — 签名加密可用，密钥管理受限（推荐）
○ 受限 — 仅验证和小额签名
○ 仅验证 — 只能验证，不能签名

限制设置:
  日签名限额: [100] 次
  漫游最大时长: [24] 小时
  地域白名单: ☑ 中国大陆  ☑ 港澳台  □ 海外

通知:
■ 进入漫游时通知
■ 漫游签名时通知
■ 异常漫游告警
```

### 漫游场景示例

```
时间线:
09:00 — 在北京，使用中国移动SIMKey正常签名
09:30 — 进入联通覆盖区域
09:30 — 系统通知: "检测到网络切换，正在建立漫游..."
09:31 — 漫游建立成功: "已通过中国联通网络漫游，安全级别: 标准"
09:32 — 使用漫游签名完成合同签署 ✓
12:00 — 返回移动覆盖区域
12:00 — 通知: "已返回归属网络，漫游会话结束"
12:00 — 漫游摘要: 签名 5 次，无异常
```

### API示例

```kotlin
import com.chainlesschain.simkey.SimkeyRoaming

val roaming = SimkeyRoaming(config)
roaming.initialize("cn-mobile")

// 发现可用漫游网络
val networks = roaming.discoverRoamingNetworks()

// 建立漫游会话
val session = roaming.establishRoamingSession("cn-unicom")

// 通过漫游网络签名
val signature = roaming.signViaRoaming(data)

// 终止漫游
roaming.endRoamingSession()
```

## 基于SIMKey的零知识证明

> **状态**: ✅ 已实现 v0.39.0 | **标准**: W3C Verifiable Credentials + BBS+

### 概述

零知识证明（ZKP）允许用户证明某个声明为真，而无需透露任何额外信息。结合SIMKey的硬件签名不可伪造性，实现"我能证明我满足条件，但不告诉你任何多余信息"。

### 应用场景

```
场景一: 年龄验证（不暴露生日）
  问题: 酒吧要求证明年龄 ≥ 18
  传统: 出示身份证 → 暴露姓名、生日、住址...
  ZKP: 只证明 "年龄 ≥ 18" ✓ 不暴露任何其他信息

场景二: 资产证明（不暴露余额）
  问题: 贷款需要证明资产 ≥ 100万
  传统: 提交银行流水 → 暴露所有交易记录
  ZKP: 只证明 "资产 ≥ 100万" ✓ 不暴露精确金额

场景三: 身份认证（不暴露私钥）
  问题: 证明 "我是 DID:cc:Qm1234..."
  ZKP: 证明拥有对应私钥，但私钥不离开SIM卡

场景四: 群组成员（不暴露身份）
  问题: 证明 "我是某公司员工"
  ZKP: 证明属于员工集合，但不暴露具体是谁

场景五: 选择性披露凭证
  问题: 求职只需证明学历，不需暴露成绩单
  ZKP/BBS+: 从完整凭证中只披露 "学历=硕士"
```

### 支持的证明类型

| 证明类型 | 方案 | 证明大小 | 验证速度 | 适用场景 |
| --- | --- | --- | --- | --- |
| 身份证明 | PLONK (zkSNARK) | ~200B | <50ms | 登录、认证 |
| 年龄范围 | Bulletproofs | ~672B | <100ms | KYC、准入 |
| 资产范围 | Bulletproofs | ~672B | <100ms | 贷款、信用 |
| 成员证明 | PLONK + Merkle | ~300B | <80ms | 群组、权限 |
| 选择性披露 | BBS+ Signatures | ~400B | <60ms | 凭证呈现 |

### 工作流程

```
证明方 (Prover)                    验证方 (Verifier)
    │                                    │
    │  1. 发送随机挑战 (challenge)        │
    │◄───────────────────────────────────┤
    │                                    │
    ├─ 2. 准备私密输入 (witness)          │
    ├─ 3. 生成盲因子 (blinding)           │
    ├─ 4. 计算承诺 (commitment)           │
    ├─ 5. SIMKey签名 (绑定证明)           │
    ├─ 6. 构造ZKP                        │
    │                                    │
    │  7. 发送证明                        │
    ├───────────────────────────────────►│
    │                                    ├─ 8. 验证承诺
    │                                    ├─ 9. 验证SIMKey签名
    │                                    ├─ 10. 验证ZKP
    │  11. 验证结果                       │
    │◄───────────────────────────────────┤
    │       ✓ 证明有效 / ✗ 证明无效      │
```

### 使用示例

#### 年龄验证

```
设置 → 安全 → SIMKey → 零知识证明

场景: 年龄验证
  条件: 年龄 ≥ 18
  证明方案: Bulletproofs (范围证明)

1. 收到验证请求
2. 确认只证明 "年龄 ≥ 18"
   ⚠️ 不会暴露: 实际年龄、生日、姓名
3. 输入SIMKey PIN码
4. SIM卡安全芯片生成证明
5. 发送证明 ✓

验证结果: ✅ 证明有效 — 年龄 ≥ 18
```

#### 选择性披露

```
场景: 从学历凭证中只披露学位

完整凭证:
  姓名: 张三          [隐藏]
  学校: 清华大学      [隐藏]
  专业: 计算机科学    [隐藏]
  学位: 硕士          [披露 ✓]
  毕业年份: 2020      [隐藏]
  GPA: 3.8/4.0        [隐藏]

BBS+选择性披露:
  披露: { 学位: "硕士" }
  隐藏字段: 5个 (盲承诺保护)
  SIMKey签名: ✅ 绑定

验证方收到: 学位=硕士 + ZKP证明（其他字段存在但不可见）
```

### API示例

```kotlin
import com.chainlesschain.simkey.SimkeyZkp

val zkp = SimkeyZkp(config)
zkp.initialize()

// 身份零知识证明
val identityProof = zkp.proveIdentity(
    did = "did:cc:Qm1234...",
    challenge = verifierChallenge,
    simkeySignFn = { data -> simkey.sign(data) }
)

// 年龄范围证明
val ageProof = zkp.proveAgeRange(
    actualAge = 25,
    threshold = 18,
    simkeySignFn = { data -> simkey.sign(data) }
)

// 选择性披露
val disclosure = zkp.selectiveDisclose(
    credential = fullCredential,
    disclosedFields = listOf("degree"),
    simkeySignFn = { data -> simkey.sign(data) }
)

// 验证证明
val result = zkp.verifyProof(proof)
```

::: tip
零知识证明让您在不暴露隐私的前提下证明资质。SIMKey的硬件签名确保证明不可伪造，任何人无法替您生成证明。
:::

## 卫星通信SIM支持（天通一号）

> **状态**: ✅ 已实现 v0.39.0 | **卫星**: 天通一号 + 北斗三号

### 概述

在无地面网络覆盖的环境（远海、荒漠、灾区、高原）中，通过天通一号卫星通信和北斗短报文，继续使用SIMKey进行身份认证和签名操作。支持双模SIM卡（地面+卫星）自动切换。

### 支持的卫星系统

| 卫星系统 | 类型 | 覆盖范围 | 延迟 | SIMKey用途 |
| --- | --- | --- | --- | --- |
| 天通一号 | GEO | 中国+亚太 | 600-800ms | 签名、加密、通信 |
| 北斗三号 | MEO+GEO+IGSO | 全球 | 1-2s | 短报文签名（应急） |

### 支持终端

```
支持的卫星通信终端:

✅ 华为 Mate 60 Pro (卫星通信版)
✅ 华为 Mate 70 Pro (卫星通信版)
✅ 天通卫星电话 (SC310/SC320)
✅ 双模对讲机 (卫星+地面)
✅ 卫星IoT终端 (M2M)

SIM卡要求:
✅ 天通SIM卡（运营商发放）
✅ 双模SIM卡（地面5G + 天通卫星）
```

### 传输模式

```
设置 → 安全 → SIMKey → 卫星通信

传输模式:
● 混合（推荐）— 自动选择最优通道
○ 地面优先 — 优先使用地面网络
○ 卫星优先 — 优先使用卫星链路
○ 北斗短报文 — 仅短报文（极端环境）

自动切换规则:
  地面网络可用 → 使用地面网络（低延迟）
  地面不可用 + 卫星信号好 → 使用卫星链路
  地面+卫星均不可用 → 北斗短报文（如已启用）
  完全无信号 → 离线签名队列（联网后处理）
```

### 高延迟优化

```
卫星链路延迟优化策略:

1. 批量签名 (Batch Signing)
   将多个签名请求打包 → 构造Merkle Tree → 只签名Root
   效果: 10个签名只需1次卫星传输，节省90%带宽

2. 签名压缩
   ECC签名 64字节 → Base64URL压缩 → 减少卫星传输数据

3. 离线签名队列
   卫星链路中断时 → 签名请求缓存（最多100个）
   链路恢复时 → 自动批量处理队列

4. 预签名
   预生成若干一次性签名密钥对
   离线时使用预签名 → 联网后验证确认
```

### 北斗短报文集成

```
北斗短报文 + SIMKey 联合认证

适用场景: 完全无地面和卫星通信覆盖
容量限制: ~2000字节/条

工作流程:
1. 计算待签名数据的SHA-256哈希 (43字节)
2. 添加时间戳 + 随机数 (12字节)
3. SIMKey在本地签名
4. 压缩签名结果
5. 通过北斗短报文发送
6. 对方设备接收并验证

优势:
✅ 覆盖范围: 全球（含极地）
✅ 无需SIM卡网络（北斗独立）
✅ 适合应急通信
```

### 使用场景

```
场景一: 远海渔船签名
  地点: 东海渔场（无地面网络）
  设备: 双模卫星电话
  操作: 通过天通一号卫星签名捕捞日志
  延迟: ~700ms（可接受）

场景二: 灾区应急认证
  地点: 地震灾区（基站损毁）
  设备: 华为Mate 60 Pro
  操作: 通过北斗短报文发送身份认证
  延迟: ~1.5s

场景三: 高原科考数据签名
  地点: 青藏高原无人区
  设备: 卫星IoT终端
  操作: 批量签名科考数据后通过卫星上传
  优化: 10份数据合并为1次卫星传输
```

### 配置

```
设置 → 安全 → SIMKey → 卫星通信

■ 启用卫星SIM支持
■ 自动网络切换
□ 启用北斗短报文（需北斗模块）
■ 签名压缩
■ 离线签名队列

离线队列:
  最大队列: [100] 个签名
  自动处理: ■ 联网后自动处理

卫星状态:
  信号强度: ████████░░ -75 dBm
  链路状态: 🟢 已连接
  当前卫星: 天通一号 GEO
  传输模式: 混合（地面优先）
```

### API示例

```kotlin
import com.chainlesschain.simkey.SatelliteSimDriver

val satSim = SatelliteSimDriver(config)
satSim.initialize()

// 通过卫星签名
val result = satSim.sign(data, priority = "high")

// 批量签名（Merkle优化）
val batchResult = satSim.batchSign(dataArray)

// 北斗短报文签名
val beidouResult = satSim.signViaBeidouSMS(data)

// 处理离线队列
val queueResult = satSim.processOfflineQueue()
```

::: tip
在有地面网络时优先使用地面通道（延迟<50ms）。卫星通道主要用于无网络覆盖场景。建议开启"混合模式"让系统自动选择最优通道。
:::

## SIMKey硬件安全模块(HSM)联合认证

> **状态**: ✅ 已实现 v0.39.0 | **场景**: 企业财务、合同签章、大额交易

### 概述

将移动端SIMKey与企业级HSM（硬件安全模块）联合使用，实现门限签名（Threshold Signature）。密钥分为两份——SIMKey持有一半，HSM持有一半，必须双方协作才能完成签名，达到金融级安全标准。

### 技术架构

```
移动端                              企业服务端
┌──────────────┐                   ┌──────────────────┐
│   手机       │                   │   企业服务器      │
│   ┌────────┐ │    安全通道       │   ┌────────────┐ │
│   │ SIMKey │ │◄─────────────────►│   │    HSM     │ │
│   │ 份额A  │ │   TLS 1.3 +     │   │   份额B    │ │
│   └────────┘ │   双向认证       │   └────────────┘ │
│              │                   │   ┌────────────┐ │
│              │                   │   │  策略引擎  │ │
│              │                   │   │ (审批/限额) │ │
│              │                   │   └────────────┘ │
└──────────────┘                   └──────────────────┘

联合签名: Sign(份额A) ⊕ Sign(份额B) = 完整签名
```

### 支持的HSM

| HSM厂商 | 型号 | 接口 | 安全认证 | 支持状态 |
| --- | --- | --- | --- | --- |
| Thales | Luna Network HSM 7 | PKCS#11 | FIPS 140-2 L3 | ✅ |
| AWS | CloudHSM | JCE | FIPS 140-2 L3 | ✅ |
| Azure | Dedicated HSM | PKCS#11 | FIPS 140-2 L3 | ✅ |
| 三未信安 | SJJ1012-A | SKF/SDF | 国密二级 | ✅ |
| 江南天安 | TassHSM | SKF | 国密三级 | ✅ |
| 渔翁信息 | YW-HSM | PKCS#11 | 国密二级 | ✅ |

### 联合签名模式

```
模式一: 2-of-2 门限签名（推荐）
  SIMKey + HSM 必须都参与
  安全性最高，适合大额交易

模式二: 2-of-3 门限签名
  SIMKey + HSM1 + HSM2，任意2个即可
  具有冗余性，适合高可用场景

模式三: 顺序签名
  SIMKey先签 → HSM背书
  适合审批流程

模式四: 并行签名
  SIMKey和HSM同时签名
  速度最快
```

### 密钥分片

```
设置 → 安全 → SIMKey → HSM联合

密钥分片设置:
1. 连接企业HSM
2. 选择分片模式:
   ● 2-of-2（SIMKey + HSM，推荐）
   ○ 2-of-3（SIMKey + 2个HSM）
3. 生成主密钥（在安全环境中）
4. 分割为份额:
   份额A → 写入SIMKey SIM卡
   份额B → 存入企业HSM
5. 计算联合公钥
6. 完成

密钥状态:
  分片模式: 2-of-2
  SIMKey份额: ✅ 已存储
  HSM份额: ✅ 已存储 (Luna HSM 7)
  联合公钥: SHA256:9a3b...
  创建时间: 2026-02-23 10:00:00
```

### 审批策略

```
设置 → SIMKey → HSM联合 → 审批策略

策略规则:
  金额 < ¥10,000: 自动批准（无需审批）
  金额 ¥10,000 - ¥100,000: 单人审批
  金额 > ¥100,000: 多人审批（2/3通过）

审批人:
  ✓ 李经理 (财务部)
  ✓ 王总监 (风控部)
  ✓ 张总   (管理层)

白名单:
  ✓ 合作方A (did:cc:Qm1234...) — 免审批
  ✓ 合作方B (did:cc:Qm5678...) — 免审批
```

### 使用场景

```
场景: 企业财务转账 ¥500,000

1. 财务人员发起转账签名请求
2. 策略引擎检查: 金额 > ¥100,000 → 需多人审批
3. 通知审批人:
   ✅ 李经理 已批准
   ✅ 王总监 已批准
   ⏳ 张总 待审批 → ✅ 已批准 (2/3通过)
4. 执行联合签名:
   a. 财务人员输入SIMKey PIN → SIMKey份额签名
   b. HSM自动执行HSM份额签名
   c. 合并两个份额签名 → 生成完整签名
5. 转账交易广播 ✓

审计日志:
  [10:00] 签名请求提交 (¥500,000)
  [10:01] 审批请求发送 (3位审批人)
  [10:05] 审批通过 (2/3)
  [10:05] 联合签名执行
  [10:06] 交易广播成功
```

### HSM故障转移

```
主备HSM自动切换:

正常运行:
  主HSM (Luna HSM 7) → ✅ 活跃
  备HSM (CloudHSM)   → ✅ 待命

检测到主HSM故障:
  主HSM (Luna HSM 7) → ❌ 连接超时
  备HSM (CloudHSM)   → ✅ 自动接管

  通知: "主HSM不可用，已自动切换到备用HSM"

  故障转移耗时: < 5秒
  签名服务中断: 无
```

### 合规审计

```
设置 → SIMKey → HSM联合 → 审计日志

日志内容:
  ✓ 所有签名操作（时间、金额、签名方）
  ✓ 审批流程（申请、批准、拒绝）
  ✓ 密钥操作（生成、分片、轮换）
  ✓ HSM状态变化（连接、断开、故障转移）
  ✓ 策略变更（修改审批规则）

导出格式:
○ JSON（适合系统集成）
● PDF报告（适合合规审计）
○ CSV（适合数据分析）

保留期限: 7年（满足金融监管要求）
```

### API示例

```kotlin
import com.chainlesschain.simkey.HsmFederation

val hsm = HsmFederation(config)
hsm.initialize()

// 注册企业HSM
hsm.registerHSM(
    type = "thales_luna",
    name = "Production HSM",
    endpoint = "hsm.company.com:1792"
)

// 生成分片密钥
hsm.generateKeyShares(
    keyId = "finance-key-001",
    mode = "2of2"
)

// 联合签名
val result = hsm.coSign(
    keyId = "finance-key-001",
    data = transactionData,
    simkeySignFn = { data -> simkey.sign(data) },
    context = { amount: 500000, recipient: "合作方A" }
)

// 审计日志
val auditLog = hsm.getAuditLog(limit = 100)
```

::: tip
HSM联合认证适合企业级应用场景。个人用户可使用SIMKey + TEE双重签名获得类似的安全等级，无需额外购买HSM设备。
:::

## 路线图

- [x] eSIM远程配置（OTA密钥部署）— v0.39.0
- [x] TEE可信执行环境深度集成 — v0.39.0
- [x] 跨运营商SIMKey漫游协议 — v0.39.0
- [x] 基于SIMKey的零知识证明 — v0.39.0
- [x] 卫星通信SIM支持（天通一号）— v0.39.0
- [x] SIMKey硬件安全模块(HSM)联合认证 — v0.39.0
