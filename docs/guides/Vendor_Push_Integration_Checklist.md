# 国内推送厂商接入清单（B 组 seam）

> 创建：2026-06-02 · 状态：🟡 全部 stub，0 家真集成
> **本文是「可执行清单」**——前置账号/凭证/SDK 阻塞项 + 每厂商 checkbox + 验收口径。
> **「怎么改代码」的详细步骤 single-source 在 [`Vendor_Push_Setup.md`](./Vendor_Push_Setup.md)**，本文不重复，只在每步链过去。
> 关联：[`docs/design/NoOp_Seam_Tracker.md`](../design/NoOp_Seam_Tracker.md) B 组 + A2/A3/A5/A6。

---

## 0. 为什么这是阻塞项（与 NoOp seam 的联动）

family-guard 的 4 个休眠 notifier seam **最终都走推送通道**：

| NoOp seam（A 组） | 依赖推送 | 现状 |
|---|---|---|
| A2 `SosNotifier`（SOS 广播/撤销/已接通） | ✅ | 🔴 NoOp |
| A3 `EmergencyContactNotifier`（SOS 60s 兜底，走 SMS 非推送，但同属告警链） | (SMS) | 🔴 NoOp |
| A5 `GuardianAnomalyNotifier`（异常推家长） | ✅ | 🔴 NoOp |
| A6 `GroupChatNotifier`（多家长协商频道） | ✅ | 🔴 NoOp |

→ **先接通推送厂商（B 组），A2/A5/A6 才有真实落点**。非小米机型当前收不到任何厂商推送（FCM 国内不可达），监管告警在那些设备上静默丢失。

---

## 1. 当前状态矩阵（已对照代码核实 2026-06-02）

代码位置：`android-app/app/src/main/java/com/chainlesschain/android/push/vendor/`

| Vendor | impl 类 | `isIntegrated()` | SDK 来源 | 自动匹配 manufacturer | 国内市占率 |
|---|---|---|---|---|---|
| 小米 Xiaomi | `XiaomiPushService`（**参考框架**，4 TODO） | `false` | 手动 AAR（非 Maven） | xiaomi / redmi | ~16% |
| 华为 Huawei | `HuaweiPushService`（stub，`OtherVendorStubs.kt`） | `false` | Huawei Maven repo | huawei / honor | ~10% |
| OPPO | `OppoPushService`（stub） | `false` | OPPO Maven repo | oppo / realme / oneplus | ~9% |
| vivo | `VivoPushService`（stub） | `false` | 手动 AAR | vivo / iqoo | ~7% |
| FCM（海外兜底） | `FcmPushService`（routing-only） | `false` | google-services.json | (fallback) | — |

**已就绪（不用动）**：`VendorPushService` 接口 / `PushVendorRegistry`（按 manufacturer 自动选 + 用户 override）/ `VendorPreferences` / Settings UI。
**改一个 vendor 只动它自己的 `XxxPushService` + 新建 `XxxPushReceiver` + manifest + gradle dep**，其余零改动。

---

## 2. 前置阻塞项清单（**非代码——必须先办，否则代码无从写起**）

> 这些是 PM / 账号负责人要办的事，每项都是真实门槛（账号审核、企业资质、费用）。

### 2.1 小米 Xiaomi（推荐 1️⃣）
- [ ] 注册 [小米开放平台](https://dev.mi.com/console/) 开发者账号（个人/企业）
- [ ] 创建应用（包名须与 release `applicationId` 一致）
- [ ] 申请 Push 服务，取 **APP_ID / APP_KEY / APP_SECRET**（3 个）
- [ ] 下载 MiPush SDK AAR（[下载页](https://admin.xmpush.xiaomi.com/zh_CN/mipush/downpage)，**非 Maven Central**，需手动 vendor 进 `app/libs/`）
- [ ] 资质：个人账号可申请；企业推送量更高
- 费用：基础推送免费

### 2.2 华为 Huawei（2️⃣，**接入最重**）
- [ ] 注册 [华为开发者联盟](https://developer.huawei.com/consumer/cn/)账号
- [ ] **实名认证 + 企业资质**（华为 HMS 个人开发者权限受限，Push Kit 通常需企业认证）
- [ ] 创建应用 → 开通 Push Kit → 下载 **`agconnect-services.json`**
- [ ] 取 APP_ID（agconnect 文件内）
- [ ] 需加 `com.huawei.agconnect` gradle plugin + Huawei Maven repo
- [ ] SHA-256 证书指纹登记到 AppGallery Connect（与 release keystore 一致）
- 费用：基础免费；⚠️ 资质审核周期最长

### 2.3 OPPO（3️⃣，含 OnePlus/Realme）
- [ ] 注册 [OPPO 开放平台](https://open.oppomobile.com/)账号
- [ ] 企业认证（OPPO 推送一般需企业主体）
- [ ] 创建应用 → 开通 PUSH → 取 **APP_KEY / APP_SECRET / APP_ID / MasterSecret**
- [ ] 下载 Heytap/OPush AAR（手动 vendor）
- 费用：基础免费

### 2.4 vivo（4️⃣，可推 v1.3，含 iQOO）
- [ ] 注册 [vivo 开放平台](https://dev.vivo.com.cn/)账号
- [ ] 企业认证
- [ ] 创建应用 → 开通推送 → 取 **APP_ID / APP_KEY / APP_SECRET**
- [ ] 下载 VivoPush AAR（手动 vendor）
- 费用：基础免费

### 2.5 FCM（海外，独立轨）
- [ ] 已有 M3 D3 骨架（`android-app/docs/M3_FCM_SETUP.md`）；用户配 `google-services.json` 后激活
- [ ] 国内不可达，仅 Pixel / Samsung 国际版等 fallback

---

## 3. 单厂商代码接入 checklist（拿到凭证后，每步 → setup doc）

> 以小米为模板（其余厂商对称，看 setup doc 对应 §3.2/§3.3/§3.4）。**改完一个 vendor 跑一遍本节。**

- [ ] **凭证注入**：`~/.gradle/gradle.properties` 加 AppId/AppKey（**不上 git**）→ `build.gradle.kts` `buildConfigField`（[setup §3.1 步骤 3](./Vendor_Push_Setup.md)）
- [ ] **SDK 依赖**：AAR 进 `app/libs/` 或加 vendor Maven repo（[setup §3.1 步骤 1-3](./Vendor_Push_Setup.md)）
- [ ] **AndroidManifest**：加 vendor service / receiver / permission（[setup §3.1 步骤 4](./Vendor_Push_Setup.md)）
- [ ] **改 `XxxPushService` 4 处 TODO**：`initialize`/`currentToken`/`shutdown` 换真 SDK 调用 + `isIntegrated()` 返 `true`（[setup §3.1 步骤 5](./Vendor_Push_Setup.md)）
- [ ] **新建 `XxxPushReceiver`**：收 payload/token → 转 `CcPushNotificationService.onRemoteData` / `onTokenChanged`（[setup §3.1 步骤 6](./Vendor_Push_Setup.md)）
- [ ] **设备闸**：`initialize()` 内 `Build.MANUFACTURER` 匹配才注册（非本厂商机型早返，避免误注册）
- [ ] **token 上行**：`onTokenChanged` → 上传桌面（需 v1.2 桌面 multi-vendor dispatch endpoint，[setup §4](./Vendor_Push_Setup.md)）
- [ ] **R8 keep**：vendor SDK 类加 `-keep`（⚠️ 当前 release minify 已整体禁用见 trap #19，复活后必补 keep 规则）

### 关联陷阱（改前必看）
- [ ] `feedback_android_update_loop_immutable_apk` — 改 release signing / manifest 前
- [ ] 华为/OPPO/vivo 需 release keystore SHA-256 登记到各控制台（debug 签名收不到推送）
- [ ] `android_release_r8_minify_hotfix_chain`（trap #19）— SDK 混淆 keep 规则

---

## 4. 验收口径（一个 vendor 算"真集成"）

1. `XxxPushService.isIntegrated()` 返 `true`，绑定从 stub 切真实现。
2. 真机（对应厂商 ROM）E2E：杀进程后仍能收推送 → 点击拉起 → `CcPushNotificationService` 收到 payload。
3. token 上行桌面，桌面能定向下发到该 token。
4. 把 NoOp_Seam_Tracker 该相关行（A2/A5/A6 中能验证的）状态推进。

> ⚠️ 真机 E2E 必须用**对应厂商真机 + 各控制台已登记 release 签名**，Win 开发机不可跑。

---

## 5. 推荐执行顺序

1. **小米先做**（市占最高 + 官方文档最好 + 个人账号可申请 + 参考框架已在 `XiaomiPushService`）。
2. 桌面 multi-vendor token dispatch endpoint（[setup §4](./Vendor_Push_Setup.md)）—— 一次做，所有 vendor 复用。
3. 华为（资质审核周期最长，**账号注册要尽早启动**，代码可后做）。
4. OPPO → vivo。
5. 每家落地后回填本文 §1 矩阵 + NoOp_Seam_Tracker。

---

## 变更记录

| 日期 | 操作 |
|---|---|
| 2026-06-02 | 初版：状态矩阵（对照代码核实）+ 前置阻塞项 + 接入 checklist + 验收口径；补 Vendor_Push_Setup.md 缺的「前置门槛 + checkbox」维度 |
