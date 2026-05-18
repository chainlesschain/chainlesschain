# SIMKey 企业版功能

> **版本: v0.39.0 | eSIM OTA远程配置 | TEE可信执行环境 | 跨运营商漫游 | 零知识证明 | 卫星通信SIM | HSM联合认证**

本文档涵盖 SIMKey v0.39.0 引入的 6 大企业级安全功能。

> 基础功能请参阅 [SIMKey 基础指南](/chainlesschain/simkey) | 高级功能请参阅 [SIMKey 高级安全功能](/chainlesschain/simkey-advanced)

## 概述

SIMKey 企业版功能模块面向大规模组织部署场景，提供 eSIM OTA 远程批量配置、TEE 可信执行环境深度集成（ARM TrustZone/Intel SGX 双重硬件签名）、跨运营商 SIMKey 身份漫游、基于 BBS+/Bulletproofs 的零知识证明、天通一号卫星通信 SIM 支持以及 SIMKey + HSM 门限签名联合认证等企业级安全能力。

## 核心特性

- 📡 **eSIM OTA 远程配置**: 基于 GSMA SGP.22 标准，支持企业批量密钥部署和 Profile 管理
- 🛡️ **TEE 可信执行环境**: 深度集成 ARM TrustZone / Intel SGX / Secure Enclave，双重硬件签名
- 🌍 **跨运营商漫游**: DID 联邦认证 + 运营商联盟，SIMKey 身份无缝漫游
- 🔏 **零知识证明**: 基于 BBS+ / Bulletproofs / PLONK 的选择性披露和隐私保护
- 🛰️ **卫星通信 SIM**: 天通一号 + 北斗短报文，离线和极端环境下的签名能力
- 🏦 **HSM 联合认证**: SIMKey + 企业 HSM 门限签名，金融级双硬件安全

## 系统架构

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  eSIM OTA    │    │  TEE 集成    │    │  HSM 联合    │
│  SM-DP+ 服务 │    │  TrustZone   │    │  门限签名    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────┬───────┴───────┬───────────┘
                   │               │
          ┌────────▼────────┐  ┌───▼────────────┐
          │  SIMKey Enterprise│  │ 漫游协议引擎  │
          │  Core Manager    │  │ DID 联邦认证   │
          └────────┬────────┘  └───┬────────────┘
                   │               │
          ┌────────▼────────┐  ┌───▼────────────┐
          │  ZKP 证明引擎   │  │ 卫星通信驱动   │
          │  BBS+ / PLONK   │  │ 天通 + 北斗    │
          └─────────────────┘  └────────────────┘
```

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

| 平台            | TEE类型                  | 安全级别   | 支持特性           |
| --------------- | ------------------------ | ---------- | ------------------ |
| Android (高通)  | ARM TrustZone / QSEE     | ⭐⭐⭐⭐⭐ | 全部               |
| Android (三星)  | ARM TrustZone / TEEGRIS  | ⭐⭐⭐⭐⭐ | 全部               |
| Android (华为)  | ARM TrustZone / iTrustee | ⭐⭐⭐⭐⭐ | 全部               |
| iOS             | Secure Enclave           | ⭐⭐⭐⭐⭐ | 全部               |
| Desktop (Intel) | Intel SGX                | ⭐⭐⭐⭐   | 密封存储、远程证明 |
| Desktop (AMD)   | AMD SEV                  | ⭐⭐⭐     | 内存加密           |

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

| 证明类型   | 方案            | 证明大小 | 验证速度 | 适用场景   |
| ---------- | --------------- | -------- | -------- | ---------- |
| 身份证明   | PLONK (zkSNARK) | ~200B    | <50ms    | 登录、认证 |
| 年龄范围   | Bulletproofs    | ~672B    | <100ms   | KYC、准入  |
| 资产范围   | Bulletproofs    | ~672B    | <100ms   | 贷款、信用 |
| 成员证明   | PLONK + Merkle  | ~300B    | <80ms    | 群组、权限 |
| 选择性披露 | BBS+ Signatures | ~400B    | <60ms    | 凭证呈现   |

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

| 卫星系统 | 类型         | 覆盖范围  | 延迟      | SIMKey用途         |
| -------- | ------------ | --------- | --------- | ------------------ |
| 天通一号 | GEO          | 中国+亚太 | 600-800ms | 签名、加密、通信   |
| 北斗三号 | MEO+GEO+IGSO | 全球      | 1-2s      | 短报文签名（应急） |

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

| HSM厂商  | 型号               | 接口    | 安全认证      | 支持状态 |
| -------- | ------------------ | ------- | ------------- | -------- |
| Thales   | Luna Network HSM 7 | PKCS#11 | FIPS 140-2 L3 | ✅       |
| AWS      | CloudHSM           | JCE     | FIPS 140-2 L3 | ✅       |
| Azure    | Dedicated HSM      | PKCS#11 | FIPS 140-2 L3 | ✅       |
| 三未信安 | SJJ1012-A          | SKF/SDF | 国密二级      | ✅       |
| 江南天安 | TassHSM            | SKF     | 国密三级      | ✅       |
| 渔翁信息 | YW-HSM             | PKCS#11 | 国密二级      | ✅       |

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

---

## 故障排查

### OTA 密钥部署失败

**现象**: 远程密钥部署过程中报错或超时。

**排查步骤**:

1. 确认设备网络连接稳定，OTA 部署需要持续在线
2. 检查 eUICC 存储空间是否充足（后量子密钥需要较大空间）
3. 确认 SM-DP+ 服务器地址配置正确且可达
4. 企业批量部署时检查 CSV 设备清单格式是否正确（EID 格式校验）

### TEE 初始化异常

**现象**: TEE 集成功能不可用或双重签名失败。

**排查步骤**:

1. 确认设备支持 TEE（高通 QSEE / 三星 TEEGRIS / 华为 iTrustee）
2. 检查设备是否已 Root（Root 设备 TEE 信任链可能被破坏）
3. 查看远程证明报告中的「安全启动」和「篡改检测」状态
4. Intel SGX 需在 BIOS 中启用，AMD SEV 需内核支持

### 漫游连接建立失败

**现象**: 切换到拜访网络后 SIMKey 漫游无法建立。

**排查步骤**:

1. 确认拜访网络运营商已加入 SIMKey 联盟
2. 检查漫游策略是否设置为「禁止」（应改为「自动」或「手动」）
3. 确认归属网络可达（DID 联邦认证需要向归属网络验证身份）
4. 检查地域白名单设置，确保当前区域已勾选

### HSM 联合签名超时

**现象**: 门限签名执行时间过长或超时。

**排查步骤**:

1. 检查企业 HSM 连接状态，确认网络延迟在可接受范围内
2. 确认审批流程已通过（大额交易需多人审批，可能存在等待）
3. 检查主备 HSM 是否发生故障转移（查看 HSM 状态监控）
4. 验证 SIMKey 份额和 HSM 份额的密钥 ID 是否匹配

### 卫星通信签名延迟过高

**现象**: 通过天通一号或北斗签名响应时间超过预期。

**排查步骤**:

1. 检查卫星信号强度，信号弱时延迟会显著增加
2. 确认传输模式为「混合」，系统应优先选择地面网络
3. 对于批量签名使用 Merkle 优化减少卫星传输次数
4. 检查离线签名队列是否积压过多未处理请求

## 配置参考

```js
// simkey-enterprise.config.js — SIMKey 企业版完整配置
module.exports = {
  // eSIM OTA 远程配置
  esimOta: {
    enabled: true,
    smdpPlusUrl: "https://smdp.company.com",  // SM-DP+ 服务器地址
    smdsUrl: "https://smds.gsma.com",          // SM-DS 发现服务
    defaultKeyType: "ec256",                   // "ec256" | "ec384" | "ml-dsa-65"
    pinPolicy: "set-on-first-use",             // "set-on-first-use" | "preset" | "random"
    batchCsvFormat: "eid,employeeId,dept",     // 批量部署 CSV 列定义
    rotationPeriodDays: 365,                   // 密钥轮换周期（天）
    rotationTransitionDays: 180,               // 轮换过渡期（天）
    retryOnFailure: true,                      // 部署失败自动重试
    maxRetries: 3,
  },

  // TEE 可信执行环境
  tee: {
    enabled: true,
    accelerateSigning: true,          // 启用 TEE 签名加速
    trustedUi: true,                  // 安全 PIN 输入（Trusted UI）
    sealedStorage: true,              // TEE 密封存储（本地密钥缓存）
    remoteAttestation: true,          // 远程证明
    dualSignRequired: false,          // 强制 SIMKey + TEE 双重签名
    biometricBinding: true,           // 生物识别绑定
    securityLevel: "enhanced",        // "standard" | "enhanced" | "maximum"
  },

  // 跨运营商漫游
  roaming: {
    enabled: true,
    homeCarrier: "cn-mobile",         // 归属运营商
    switchPolicy: "auto",             // "auto" | "manual" | "disabled"
    defaultSecurityLevel: "standard", // "full" | "standard" | "restricted" | "verify-only"
    maxDailySignatures: 100,          // 漫游日签名限额
    maxRoamingHours: 24,              // 最大漫游时长（小时）
    regionWhitelist: ["CN", "HK", "MO", "TW"], // 允许漫游地区
    notifyOnRoaming: true,
    notifyOnRoamingSign: true,
  },

  // 零知识证明
  zkp: {
    enabled: true,
    defaultScheme: "plonk",           // "plonk" | "bulletproofs" | "bbs+"
    cacheProofs: true,                // 缓存最近证明（避免重复计算）
    cacheTtlMs: 300000,               // 证明缓存 TTL (5 分钟)
    maxProofSizeBytes: 1024,          // 最大证明大小
    selectiveDisclosureFields: [],    // 默认披露字段（空=按需选择）
  },

  // 卫星通信 SIM
  satellite: {
    enabled: true,
    transmitMode: "hybrid",           // "hybrid" | "ground-first" | "satellite-first" | "beidou-sms"
    beidouSms: false,                 // 北斗短报文（需北斗模块）
    signatureCompression: true,       // 签名数据压缩
    offlineQueue: true,
    offlineQueueMax: 100,             // 最大离线队列条数
    batchMerkleOptimize: true,        // 批量 Merkle 优化
  },

  // HSM 联合认证
  hsm: {
    enabled: true,
    mode: "2of2",                     // "2of2" | "2of3" | "sequential" | "parallel"
    primaryHsm: {
      type: "thales_luna",            // "thales_luna" | "aws_cloudhsm" | "azure_hsm" | "sanwei" | "jiangnan" | "yuweng"
      endpoint: "hsm.company.com:1792",
      interface: "pkcs11",
    },
    backupHsm: {
      type: "aws_cloudhsm",
      endpoint: "cloudhsm.company.aws",
      interface: "jce",
    },
    failoverTimeout: 5000,            // 主备切换超时 (ms)
    approvalPolicy: {
      auto: 10000,                    // < ¥10,000 自动批准
      single: 100000,                 // < ¥100,000 单人审批
      multi: { threshold: "2of3" },   // ≥ ¥100,000 多人审批
    },
    auditRetentionYears: 7,           // 审计日志保留年限
  },
};
```

## 性能指标

> 测试环境: 企业服务器（8 核 / 32GB）+ Thales Luna HSM 7 + 5G USIM + ARM TrustZone，测试样本 ≥ 500 次

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| eSIM OTA 单设备密钥部署 | < 30s | 12s | ✅ |
| eSIM OTA 批量部署（100 台） | < 10min | 6.5min | ✅ |
| 密钥轮换（生成+更新 DID） | < 60s | 28s | ✅ |
| TEE 签名加速（vs. 软件签名） | ≥ 2× | 3.1× | ✅ |
| TEE 双重签名（SIMKey + TEE） | < 300ms | 175ms | ✅ |
| TEE 远程证明报告生成 | < 5s | 1.9s | ✅ |
| 跨运营商漫游建立延迟 | < 5s | 2.3s | ✅ |
| ZKP 身份证明（PLONK） | < 50ms | 31ms | ✅ |
| ZKP 年龄范围证明（Bulletproofs） | < 100ms | 68ms | ✅ |
| ZKP 选择性披露（BBS+） | < 60ms | 44ms | ✅ |
| 卫星签名（天通一号，单次） | < 1500ms | 720ms | ✅ |
| 批量 Merkle 签名（10 条→1 传输） | < 2000ms | 890ms | ✅ |
| HSM 2-of-2 联合签名 | < 500ms | 210ms | ✅ |
| HSM 故障转移（主→备） | < 5s | 2.8s | ✅ |
| HSM 审批流程（2/3 审批人） | < 10min | 4.2min | ✅ |
| 企业级并发签名吞吐（HSM 模式） | ≥ 50 TPS | 78 TPS | ✅ |

## 测试覆盖率

> 测试位置: `desktop-app-vue/tests/unit/ukey/enterprise/` 及 `packages/cli/__tests__/ukey/enterprise/`

| 测试文件 | 覆盖模块 | 测试数 |
| --- | --- | --- |
| ✅ `esim-ota-manager.test.js` | OTA 部署、批量部署、密钥轮换、Profile 管理 | 42 |
| ✅ `tee-integration.test.js` | TEE 初始化、密钥生成、双重签名、远程证明 | 38 |
| ✅ `simkey-roaming.test.js` | 漫游会话建立/终止、联盟信任级别、策略执行 | 31 |
| ✅ `simkey-zkp.test.js` | PLONK/Bulletproofs/BBS+ 证明生成与验证、选择性披露 | 47 |
| ✅ `satellite-sim-driver.test.js` | 天通签名、北斗短报文、Merkle 批量、离线队列 | 35 |
| ✅ `hsm-federation.test.js` | HSM 注册、分片密钥、联合签名、故障转移、审计日志 | 44 |
| ✅ `enterprise-approval-policy.test.js` | 审批阈值、多人审批、白名单豁免、策略变更 | 26 |
| ✅ `enterprise-integration.test.js` | 端到端：OTA+TEE+HSM、漫游+ZKP、卫星批量 | 29 |
| ✅ `enterprise-cli.test.js` | CLI 命令：esim ota、hsm cosign、zkp prove、roaming | 22 |

**总计**: 314 个测试，覆盖率 93%

## 安全考虑

1. **OTA 安全通道**: 远程密钥部署通过 SCP81 安全通道（TLS 1.2 + ECDHE），确保传输不被窃听
2. **TEE 远程证明**: 定期执行远程证明，验证设备 TEE 完整性未被篡改
3. **Root 设备禁用**: 已 Root 或越狱的设备应禁止使用 TEE 功能，安全保障降级
4. **漫游签名限额**: 漫游状态下应设置更严格的签名限额和时长限制
5. **HSM 审批策略**: 大额交易强制多人审批，审批人应来自不同部门以防合谋
6. **HSM 密钥分片安全**: 分片密钥的生成和分割应在安全环境中完成，份额分发后销毁中间数据
7. **卫星通信加密**: 卫星链路数据额外加密，北斗短报文内容使用端到端加密
8. **ZKP 证明不可伪造**: 零知识证明与 SIMKey 硬件签名绑定，任何人无法替他人生成证明
9. **合规审计**: 所有企业级操作保留 7 年审计日志，满足金融监管要求

## 使用示例

```javascript
// 1. eSIM OTA 远程密钥下发
await window.electronAPI.invoke('simkey:esim:provision', {
  carrier: 'china-mobile', profileUrl: 'lpa://...' })

// 2. TEE 签名（私钥不出安全区）
const sig = await window.electronAPI.invoke('simkey:tee:sign', {
  keyRef: 'corp-root', hash: '0x...' })

// 3. 跨运营商漫游
await window.electronAPI.invoke('simkey:roaming:enable', {
  allowedCarriers: ['china-mobile', 'china-unicom'],
  signatureLimitPerHour: 10
})

// 4. SIMKey ZKP 年龄证明（不泄漏生日）
const proof = await window.electronAPI.invoke('simkey:zkp:prove', {
  statement: 'age>=18', privateInputs: { birthday: '1990-01-01' } })

// 5. HSM 多人审批大额签名
await window.electronAPI.invoke('simkey:hsm:request-sign', {
  amount: 1_000_000, requiredApprovers: 3, approverGroups: ['finance', 'risk'] })

// 6. 卫星链路（天通一号）
await window.electronAPI.invoke('simkey:satellite:send', {
  kind: 'beidou-short-msg', text: 'emergency-ack' })
```

企业部署请先在 `admin` 后台配置 HSM Cluster、审批人组与漫游白名单，再通过 IPC 调用。

## 相关文档

- [SIMKey 基础指南](/chainlesschain/simkey) — 初次设置、日常使用、备份恢复
- [SIMKey 高级安全功能](/chainlesschain/simkey-advanced) — iOS eSIM、5G优化、NFC离线签名
- [U盾集成](/chainlesschain/ukey)
- [数据加密](/chainlesschain/encryption)
- [审计日志](/chainlesschain/audit)

## 关键文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `src/main/ukey/esim-ota-manager.js` | eSIM OTA 远程配置引擎 | ~380 |
| `src/main/ukey/tee-integration.js` | TEE 可信执行环境集成 | ~420 |
| `src/main/ukey/simkey-roaming.js` | 跨运营商漫游协议 | ~350 |
| `src/main/ukey/simkey-zkp.js` | 零知识证明引擎 | ~300 |
| `src/main/ukey/satellite-sim-driver.js` | 卫星通信 SIM 驱动 | ~280 |
| `src/main/ukey/hsm-federation.js` | HSM 联合认证管理 | ~360 |
