# PDH 采集器端点抓包 Runbook（gov/bank best-effort scaffold 验证）

> 目的：把若干 gov/bank 采集器（`gov-12123` / `gov-ixiamen` / `gov-tax` /
> `bank-cmbc` / `bank-boc` / `bank-bankcomm` / `finance-dcep` / `health-meiyou`）
> 里 **best-effort、未实地验证** 的 cookie-api 端点，用**你自己的真机 + 你自己的
> 登录态**抓出真实 URL / cookie / 字段名，回填后去掉 `unverified` 标记。
>
> **适用前提（授权边界）**：仅在**你本人拥有**的已 root 设备、**你本人**的账号、
> **你本人**的 App 上进行，用于与你自己的个人数据中台软件做互通（interop）。
> 不要对他人账号/设备进行。

## 0. 现实预期（先看，省时间）

来自已装 3 个 App 的二进制静态分析（2026-06-15，rooted Redmi）：这些 App 专门
做了对抗抓包的加固。难度递增：

| App | 加固 | 抓包难度 |
|---|---|---|
| 交管12123 `com.tmri.app.main` | `libNetHTProtect` | 中（host 已确认，缺子路径）|
| i厦门 `com.xmgov.xmapp` | `libzxprotect` + `libijmDataEncryption`（**请求体加密**）| 难（需 hook 解密函数）|
| 中国银行 `com.chinamworld.bocmbci` | **DexHelper(SecNeo) 壳** + 银行级反调试/反 Frida/反代理 | 很难，**建议放弃 live 抓包**，只用 snapshot |

银行 App 会把 Frida/代理/root 当作攻击行为：可能直接退出、白屏，**甚至触发风控
标记你的账户**。不值得硬刚——银行类只走 snapshot 模式。

## 1. 一次性环境准备

设备为 arm64（Redmi M2104K10AC，Helio G88）。在 PC 上：

```bash
pip install frida-tools mitmproxy        # 或用 HTTP Toolkit（GUI，最省事）
frida --version                          # 记下版本，例如 16.x.x
# 从 github.com/frida/frida/releases 下载同版本 frida-server-<ver>-android-arm64
adb push frida-server-*-android-arm64 /data/local/tmp/frida-server
adb shell "su -c 'chmod 755 /data/local/tmp/frida-server'"
```

安装 mitmproxy 的 CA 为**系统证书**（这些 App 忽略用户证书）：

```bash
mitmdump &                               # 生成 ~/.mitmproxy/mitmproxy-ca-cert.cer
# 最简单：装 Magisk 模块 “MagiskTrustUserCerts”，把用户证书提升为系统证书
```

`unpin.js` = 社区通用的 frida-multiple-unpinning 脚本（绕过 SSL pinning）。

## 2. 通用抓包流程（每个 App 都先试这个）

```bash
# 终端 A：设备上起 frida-server
adb shell "su -c '/data/local/tmp/frida-server &'"

# 终端 B：起代理（GUI 选 HTTP Toolkit 更直观）
mitmweb --listen-port 8080               # 浏览器开 http://127.0.0.1:8080 看流量
adb shell settings put global http_proxy <你PC的局域网IP>:8080

# 终端 C：带 SSL-unpin 启动 App
frida -U -f <package> -l unpin.js        # 或 objection -g <package> explore → android sslpinning disable
```

然后在 App 里：登录 → 打开目标页面（违章列表 / 账单 / 申报记录 / 经期记录…）→
在 mitmweb 里找到返回你记录的那个 XHR 请求。

抓完务必收尾：

```bash
adb shell settings delete global http_proxy
adb shell "su -c 'pkill frida-server'"
```

## 3. 各 App 具体说明

| App | package | 说明 |
|---|---|---|
| **交管12123** | `com.tmri.app.main` | Host 已确认 `https://{你的省}.122.gov.cn/app`（省两字母码，见 APK `assets/prov.json`）。只缺**违章 / 驾驶证子路径**。`libNetHTProtect` 可能要反 Frida 绕过（`frida --no-pause` 或 `objection`）。最容易拿下。采集器已支持 `opts.province`。|
| **i厦门** | `com.xmgov.xmapp` | `libzxprotect` + `libijmDataEncryption` → 请求/响应**体被加密**。URL 能看到，但 JSON 是密文。要拿到明文得额外 hook 解密函数（`frida-trace -j 'com.ijiami.*!*'` 或 trace `libijmDataEncryption` 导出）。先把 **URL + header 名**抓下来，body 不透明也行。|
| **中国银行** | `com.chinamworld.bocmbci` | DexHelper 壳 + 银行反篡改。大概率**检测到 Frida/代理/root 后退出或白屏**。**建议跳过 live 抓包，仅用 snapshot 模式**。|
| 个税 `cn.gov.tax.its` / 民生 `com.cmbc.newmbank` / 交行 `com.bankcomm.Bankcomm` / 数字人民币 `cn.gov.pbc.dcep` / 美柚 `com.lingan.seeyou` | — | 设备上**未安装**，需先装。美柚最软（消费类，pinning 弱）；其余 gov/bank 同上行为。|

## 3.1 静态分析已确认结论（2026-06-16，rooted chopin，无 live 抓包）

只做只读 APK 二进制分析（解包 + dex/assets 字符串 grep），未碰任何账号登录态。
设备上已装 4 个目标 App，结论如下：

| App | 静态结论 | 采集器动作 |
|---|---|---|
| **i厦门** `com.xmgov.xmapp` | **真实后端域名确认** = `*.ixiamen.org.cn`；业务网关 `https://buss.ixiamen.org.cn/pbc/`（usercenter 鉴权在 `/pbc/usercenter/`；市民卡/社保在 `https://smk.ixiamen.org.cn/smk/`）。原 `gov-ixiamen` 占位 `app.ixm.gov.cn` 域名是**错的**。但请求/响应 **body 被 `libzxprotect` 加密**，确切 `办事记录` 子路径静态不可见。 | ✅ 已把 host 改成真实网关（`buss.ixiamen.org.cn/pbc/`，`opts.listUrl` 可覆盖），`/handle/list` 尾段仍 best-effort，`unverified:true` 保留。VERSION 0.1.0→0.2.0。|
| **工行** `com.icbc` | 移动银行网关 host = `https://wapb-btt-dmz-gnc.dccnet.com.cn`（dex 引用 20 次）+ `srs/epass/mims.icbc.com.cn`。但 body 经 `libicbcencryption`/`libnetsecsdk`/`libEncrypt` 加密+签名，且 DexHelper(SecNeo) 壳。 | ⛔ 银行仍只走 snapshot（host 仅供参考，cookie-api 无法在无原生签名下调用）。采集器不改。|
| **中行** `com.chinamworld.bocmbci` | dex 明文里**只有推送 SDK host**（xiaomi/meizu/getui/weixin），无任何银行端点 —— SecNeo 壳全加密。**符合 §0 预判。** | ⛔ 放弃 live 抓包，仅 snapshot。采集器不改。|
| **交管12123** `com.tmri.app.main` | host 早已确认 `https://{省}.122.gov.cn/app`（`assets/prov.json`，已提交 `ed42e398c`）。仅 1 个 dex、几乎无明文 URL，请求由 `libNetHTProtect.so` 原生构造 —— 违章/驾驶证子路径静态拿不到。 | host 已对，子路径需 live 抓包或原生 RE。采集器不改。|

**教训：静态分析能确认/纠正 host 域名（i厦门/工行/12123），但凡是 body 经原生库加密（i厦门 libzxprotect / 工行 libicbcencryption / 12123 libNetHTProtect / 中行 SecNeo）的 App，确切子路径 + 字段名仍需 live hook。银行类一律 snapshot，不因拿到 host 就标 verified。**

## 4. 回填给我什么（**只要结构，脱敏**）

每个抓到的请求，贴回：

- **Method + URL**（完整路径），例：`GET https://fj.122.gov.cn/app/wfcx/queryList?pageNo=1`
- **承载鉴权/签名的 header**——只要**名字**（如 `Cookie` / `X-Sign` / `tokenId`），**不要值**
- 一条记录的**响应字段名**，值留空，例：
  ```json
  { "wfsj":"<time>", "wfdz":"<addr>", "wfxw":"<reason>", "fkje":"<fine>", "wfjfs":"<points>" }
  ```

我只需要**形状**。**不要**发真实 cookie 值、余额、姓名、身份证号、金额——我按字段
**名**接线，真实数据全部留在你本地。

## 5. 我回填后做什么

拿到某 App 的真实 URL + 字段名后，我会：

1. 把对应采集器的占位端点改成确认值（保留 `opts.*Url` 可覆盖）。
2. 按真实字段名补全 `map*()` 的别名。
3. 去掉该采集器 `authenticate()` 的 `unverified: true`。
4. 加/改单测固定真实形状，提交（pdh/lib 改动会触发 USR_VERSION + npm 发版链，见
   traps #27/#28）。

## 参考

- 采集器源码：`packages/personal-data-hub/lib/adapters/{gov-12123,gov-ixiamen,gov-tax,bank-*,finance-dcep,health-meiyou}/`
- 银行家族共享工厂：`packages/personal-data-hub/lib/adapters/_bank-base.js`
- 完整性审计记忆：`pdh_collector_completeness_audit_2026_06_13`（CORRECTION 13–17）
- 真机静态分析结论（本 runbook §0）：12123 host 已修正提交 `ed42e398c`
