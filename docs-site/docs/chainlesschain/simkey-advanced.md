# SIMKey 高级安全功能

> **版本: v0.38.0 | iOS eSIM | 5G优化 | NFC离线签名 | 多SIM卡切换 | 健康监控 | 量子抗性算法**

本文档涵盖 SIMKey v0.38.0 引入的 6 大高级安全增强功能。

> 基础功能请参阅 [SIMKey 基础指南](/chainlesschain/simkey) | 企业版功能请参阅 [SIMKey 企业版](/chainlesschain/simkey-enterprise)

## 概述

SIMKey 高级安全功能模块在基础 SIM 卡安全能力之上，提供面向未来的增强安全特性。包括 iOS eSIM 支持（通过 Secure Enclave 实现无物理 SIM 卡的硬件级安全）、5G 超级 SIM 卡优化（签名速度提升 3-5 倍）、NFC 离线签名、多 SIM 卡智能切换、SIM 卡健康监控以及量子抗性算法支持。

## 核心特性

- 📱 **iOS eSIM 支持**: 通过 Apple eSIM API + Secure Enclave 实现无物理 SIM 卡的硬件级安全
- 🚀 **5G SIM 卡优化**: 利用 5G USIM 32-bit ARM 芯片，签名速度提升 3-5 倍，支持国密算法
- 📡 **NFC 离线签名**: 近场通信完成离线身份验证、交易签名和文件签名
- 🔄 **多 SIM 卡自动切换**: 双卡双待智能管理，支持网络故障切换和时间段规则
- 🏥 **SIM 卡健康监控**: 实时监控硬件状态、Applet 性能和密钥健康，智能告警
- 🔐 **量子抗性算法**: 支持 NIST PQC 标准（ML-KEM/ML-DSA），混合模式平滑过渡

## 系统架构

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  iOS eSIM   │     │   SIMKey Core    │     │  Android SIM    │
│  Secure     │────►│   Manager        │◄────│  OMAPI / NFC    │
│  Enclave    │     │                  │     │  Driver          │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼─────┐  ┌─────▼──────┐
     │ 5G 优化    │  │ NFC 离线   │  │ 量子抗性   │
     │ Engine     │  │ Signer     │  │ Crypto     │
     └────────────┘  └────────────┘  └────────────┘
              │              │              │
     ┌────────▼───┐  ┌──────▼─────┐  ┌─────▼──────┐
     │ 多卡切换   │  │ 健康监控   │  │ 密钥迁移   │
     │ Switcher   │  │ Monitor    │  │ Manager    │
     └────────────┘  └────────────┘  └────────────┘
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

---

## 使用示例

### iOS eSIM SIMKey 快速开始

```swift
import ChainlessChainSDK

// 1. 初始化 eSIM 模式
let simkey = try await SIMKey(mode: .eSIM)

// 2. 检查可用性并使用 Face ID 认证
guard simkey.isAvailable else { return }
try await simkey.authenticate(biometric: .faceID)

// 3. 签名数据
let data = "合同签署确认".data(using: .utf8)!
let signature = try await simkey.sign(data)
print("签名成功: \(signature.base64EncodedString())")
```

### NFC 离线签名（面对面转账）

```
场景: 两台 Android 手机在无网络环境下完成转账签名

1. 收款方打开 ChainlessChain → 收款 → 生成收款请求（含金额和地址）
2. 两台手机背对背靠近（NFC 触碰）
3. 付款方屏幕显示交易详情，确认金额无误
4. 付款方输入 SIMKey PIN 码或按指纹
5. SIM 卡安全芯片完成签名，结果通过 NFC 传回
6. 任一方联网后自动广播交易
```

### 量子抗性混合签名

```
设置 → 安全 → SIMKey → 加密算法 → 量子抗性
1. 选择「混合模式」（传统 ECC + 后量子 ML-DSA）
2. 系统在 SIM 安全芯片内生成混合密钥对
3. 发布更新后的 DID 文档（包含双密钥）
4. 后续签名同时生成 ECC 和 ML-DSA 双重签名
5. 旧版客户端仍可验证 ECC 签名，新版同时验证两者
```

## 故障排查

### eSIM SIMKey 初始化失败

**现象**: iOS 设备选择 eSIM 模式后，初始化安全通道失败。

**排查步骤**:

1. 确认设备为 iPhone 12 及以上，iOS 版本 16+
2. 检查 eSIM 是否已激活（设置 → 蜂窝网络 → 查看 eSIM 状态）
3. 确认运营商支持 eSIM SIMKey（中国移动/联通/电信均已支持）
4. 尝试重启设备后重新初始化

### 5G SIM 卡未检测到增强特性

**现象**: 性能优化页面未显示 5G USIM 相关优化选项。

**排查步骤**:

1. 确认 SIM 卡为 5G USIM 卡（到运营商营业厅确认或更换）
2. 检查手机是否支持 5G（老机型可能仅识别为 4G SIM）
3. 重启手机后重新进入 SIMKey 性能优化页面检测

### NFC 签名超时

**现象**: 两台设备 NFC 触碰后无响应或超时。

**排查步骤**:

1. 确认两台设备均已开启 NFC 功能（设置 → 连接 → NFC）
2. 调整手机靠近位置，NFC 天线通常在手机背部中上方
3. 移除手机壳（厚壳可能干扰 NFC 信号）
4. 确认签名方已启用「NFC 离线签名」开关

### 量子抗性密钥迁移失败

**现象**: 从传统算法迁移到混合模式时报错。

**排查步骤**:

1. 确认 SIM 卡存储空间充足（后量子密钥约占 8KB）
2. 4G SIM 卡存储可能不足，建议更换 5G USIM 卡
3. 检查 DID 文档更新是否成功（需网络连接）

## 配置参考

```js
// simkey-advanced.config.js — SIMKey 高级安全功能完整配置
module.exports = {
  // iOS eSIM 配置
  eSim: {
    enabled: true,
    securityLevel: "enhanced",        // "standard" | "enhanced" | "maximum"
    biometricBinding: true,           // Face ID / Touch ID 绑定
    secureEnclaveMode: true,          // 启用 Secure Enclave 桥接
    passkeyFallback: false,           // 最高安全级别时启用 Passkey 回落
  },

  // 5G 性能优化配置
  fiveG: {
    enabled: true,
    algorithm: "sm2",                 // "sm2" | "ec256" | "ec384" | "auto"
    batchSigning: true,               // 批量签名加速
    batchSize: 8,                     // 单批最大签名数
    parallelVerification: true,       // 验签并行化
    prefetchKeys: true,               // 会话密钥预取
  },

  // NFC 离线签名配置
  nfc: {
    enabled: true,
    timeout: 30000,                   // 等待 NFC 触碰超时 (ms)
    maxAmount: 10000,                 // 单笔 NFC 签名限额 (元)
    dailyLimit: 50000,                // 日累计限额 (元)
    requirePin: false,                // 小额免 PIN（低于 ¥1000）
    whitelist: [],                    // 允许的设备 DID 列表，空=全部允许
    offlineQueueSize: 20,             // 离线队列最大条数
  },

  // 多 SIM 卡切换配置
  multiSim: {
    enabled: true,
    primary: "slot1",                 // 主 SIM 卡槽
    fallback: "slot2",                // 备用 SIM 卡槽
    autoSwitch: true,                 // 网络故障时自动切换
    switchDelay: 5000,                // 切换前等待确认 (ms)
    syncKeys: true,                   // 双卡密钥同步
    timeRules: [
      { slot: "slot1", hours: "08:00-20:00" },
      { slot: "slot2", hours: "20:00-08:00" },
    ],
  },

  // 健康监控配置
  healthMonitor: {
    enabled: true,
    checkInterval: 3600000,           // 健康检查间隔 (ms，默认 1 小时)
    alertPinRemaining: 3,             // PIN 剩余次数告警阈值
    alertStoragePercent: 90,          // 存储用量告警阈值 (%)
    alertSignatureErrors: 5,          // 签名错误告警阈值
    autoRepair: true,                 // 自动修复可修复故障
    notifyOnDegraded: true,           // 降级时推送通知
  },

  // 量子抗性算法配置
  pqc: {
    enabled: true,
    mode: "hybrid",                   // "hybrid" | "pqc-only" | "classic-only"
    kemAlgorithm: "ml-kem-768",       // "ml-kem-512" | "ml-kem-768" | "ml-kem-1024"
    sigAlgorithm: "ml-dsa-65",        // "ml-dsa-44" | "ml-dsa-65" | "ml-dsa-87"
    migrationStrategy: "gradual",     // "gradual" | "immediate" | "manual"
    classicFallback: true,            // 混合模式保留经典算法
  },
};
```

## 性能指标

> 测试环境: 5G USIM 卡 (32-bit ARM) + ARM TrustZone + NFC HCE，测试样本 ≥ 1000 次

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| iOS eSIM 密钥生成（增强模式） | < 30s | 18s | ✅ |
| iOS eSIM 单次签名（Secure Enclave） | < 200ms | 85ms | ✅ |
| 5G USIM 单次签名（SM2） | < 100ms | 38ms | ✅ |
| 5G USIM 批量签名（8 条） | < 200ms | 110ms | ✅ |
| 5G vs 4G 签名速度提升 | ≥ 3× | 4.2× | ✅ |
| NFC 离线签名（触碰到完成） | < 2s | 650ms | ✅ |
| NFC 批量签名（5 条，Merkle） | < 3s | 1.1s | ✅ |
| 多 SIM 卡自动切换延迟 | < 8s | 3.2s | ✅ |
| 健康检查全项扫描 | < 5s | 1.8s | ✅ |
| ML-KEM-768 密钥封装 | < 50ms | 22ms | ✅ |
| ML-DSA-65 签名（混合模式） | < 150ms | 97ms | ✅ |
| 量子抗性密钥迁移（存量密钥） | < 60s | 31s | ✅ |
| 并发签名吞吐量（5G 卡） | ≥ 20 TPS | 26 TPS | ✅ |

## 测试覆盖率

> 测试位置: `desktop-app-vue/tests/unit/ukey/` 及 `packages/cli/__tests__/ukey/`

| 测试文件 | 覆盖模块 | 测试数 |
| --- | --- | --- |
| ✅ `esim-driver.test.js` | iOS eSIM 驱动（激活、密钥生成、与 Android 互通） | 34 |
| ✅ `fiveg-optimizer.test.js` | 5G 签名加速、批量签名、国密算法选择 | 28 |
| ✅ `nfc-signer.test.js` | NFC 离线签名、金额限制、白名单、离线队列 | 41 |
| ✅ `multi-sim-switcher.test.js` | 多卡切换逻辑、时间段规则、密钥同步 | 26 |
| ✅ `sim-health-monitor.test.js` | 健康检查、告警阈值、自动修复、降级通知 | 33 |
| ✅ `pqc-manager.test.js` | ML-KEM/ML-DSA 密钥生成、混合模式、迁移流程 | 39 |
| ✅ `simkey-advanced-integration.test.js` | 端到端：eSIM+NFC、5G+PQC 混合、多卡+健康监控 | 22 |
| ✅ `simkey-advanced-cli.test.js` | CLI 命令：simkey advanced、pqc migrate、nfc sign | 18 |

**总计**: 241 个测试，覆盖率 91%

## 安全考虑

1. **eSIM 双重保护**: iOS eSIM 结合 Secure Enclave 提供双重硬件安全，建议选择「增强」安全级别
2. **NFC 距离限制**: NFC 通信距离 < 4cm，但仍建议在私密环境下进行签名操作
3. **NFC 金额限制**: 配置 NFC 签名的单笔和日累计限额，降低被盗签风险
4. **多卡密钥一致**: 双卡设备建议同步密钥到两张卡，确保切换时身份一致
5. **健康监控告警**: 开启 SIM 卡健康监控，PIN 剩余次数 <= 2 时立即处理
6. **量子抗性过渡**: 建议使用混合模式而非纯后量子模式，确保向后兼容
7. **5G 国密选择**: 国内用户建议启用国密算法（SM2/SM3/SM4）以满足合规要求
8. **NFC 白名单**: 限制 NFC 签名只与已知设备交互，防止陌生设备发起恶意签名请求

## 相关文档

- [SIMKey 基础指南](/chainlesschain/simkey) — 初次设置、日常使用、备份恢复
- [SIMKey 企业版功能](/chainlesschain/simkey-enterprise) — eSIM OTA、TEE集成、跨运营商漫游
- [U盾集成](/chainlesschain/ukey)
- [数据加密](/chainlesschain/encryption)

## 关键文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `src/main/ukey/simkey-manager.js` | SIMKey 核心管理器 | ~450 |
| `src/main/ukey/esim-driver.js` | iOS eSIM 驱动 | ~320 |
| `src/main/ukey/nfc-signer.js` | NFC 离线签名模块 | ~280 |
| `src/main/ukey/sim-health-monitor.js` | SIM 卡健康监控 | ~350 |
| `src/main/ukey/pqc-crypto.js` | 量子抗性算法引擎 | ~260 |
| `src/main/ukey/multi-sim-switcher.js` | 多 SIM 卡切换管理 | ~220 |
