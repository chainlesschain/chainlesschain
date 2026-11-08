# Windows 原生目标旅程（2026-11-07）

本批以真实 Electron 主进程/preload、完整生产 Vue renderer、实际 DID/密码登录和加密原生 SQLite 验证个人项目风险跟进。使用全新临时 profile 和合成项目；首次设置完成标志由 fixture 写入，未验收安装/首次设置向导。业务任务创建和描述修改均经过实际界面及严格原生确认，没有替换 dialog、ApprovalGate、IPC 服务、Graph、数据库驱动或时钟。

最终源码 `1f02b9691f98b6bf2259c77c4213b0359eb42c10` 上的完整脚本退出 **0 / passed**，见 [journey.json](./journey.json)及[结束界面截图](./stopped.png)。源码/构建指纹、逐次原生按钮回执和实际停止时间保留在报告中，文件/源码摘要见 `manifest.json`；复核器核对这些已发生的结果，不将中途阶段成功视为全程通过。

## 两个真实产品缺陷

1. UKey 热插拔监控约每 5 秒报告缺失设备；原实现虽保留密码登录身份，却每次推进其授权代次，使等待原生确认的目标动作失效。[失败记录](./failed-native-auth.json)记录相同 DID 下持续变化的代次，任务未被写入。修复将无关硬件事件限定为作废待完成认证，不改变已有密码会话代次；真正注销、UKey 会话撤销、身份/窗口/数据库变化仍失效。回归包括待完成 PIN 遇硬件缺失后不得建立新会话，以及不能恢复已撤销的旧软件会话。
2. 独立验收将 Vue `ref` 内的请求代理直接传入 contextBridge，Electron 在到达 ipcMain 前拒绝克隆。[失败记录](./failed-acceptance-ipc.json)保留动作/血缘成功、验收未通过的整条观察。独立 Electron 39.8.10 最小诊断确认普通对象能传递、Proxy 返回 `An object could not be cloned`。验收确认/检查/完成和巡检/停止重试改为传递仅含基本类型的普通对象；保留持久请求 ID。组件回归用真正的 structuredClone 约束并模拟未知结果重试。

## 验证范围

完整非重叠回归 **52 文件、954 项通过，0 失败、0 跳过**：桌面 business-actions 21/402，组织配置排除桌面已覆盖文件后 12/260，renderer 19/292。完整原始报告分别为 [desktop-tests.json](./desktop-tests.json)、[organization-tests.json](./organization-tests.json)、[renderer-tests.json](./renderer-tests.json)。此前 704、870、790 等批次与此有重叠，不相加。

原生按钮驱动使用 `electronApp.evaluate(() => process.pid)` 获取真正 Electron PID，Windows launcher PID 不能代替。只匹配该 PID、精确标题与 `#32770`，核对提议正文和唯一启用按钮后发送实际 Win32 BM_CLICK；TaskDialog 不公开 Win32 正文时，仅在同一 HWND 上用 UI Automation 读取正文。它是可信测试自动化，不授予后台或插件新的批准能力。

完整脚本依次检查：

- 实际密码表单登录，以匹配 DID 创建临时项目。
- 原生取消创建后任务为 0；原生确认后仅一个任务且仅一个成功创建回执。
- **合成输入准备**：仅在可信主进程验证项目归属、真实数据库位于本次临时 profile 后，将该任务截止时间设为过去；这不是通过业务 UI 编辑截止时间的验收。
- 在 Vue 保存目标、显式允许任务建议、开启真实 60 秒监控并立即检查，回读 v2 和 `OVERDUE_INCOMPLETE_TASK`。
- 在 Vue 准备描述建议，真实原生确认后从公开任务 API 回读新说明，核对同一 intent/run/review 的四类证据。
- 再检查仍有一个逾期信号，目标保持 active/completion=null；仅配置风险消除条件，点击完成后独立报告 met=false，目标仍 active。
- 点击结束跟进，回读 abandoned/monitor disabled，跨过实际 70 秒后检查次数和历史不变；结束后手动检查被拒绝。该观察未模拟时钟，不代表永久无人值守保证。

实际运行时 Electron **39.8.10**、Node **22.22.1**、ABI **140**、better-sqlite3-multiple-ciphers **12.11.1**；执行器 Node **22.22.2**。主进程为仓库 build-main 的普通复制构建，renderer 为完整 Vite 生产构建，均返回 0；不是已安装发行包。真实产品库额外核对无明文 SQLite header，未提供密钥时 schema 读取失败。原始日志、随机密码、密钥和数据库保留在本地临时 profile，不存入本证据目录。

## 复跑

先按锁文件准备匹配 Electron ABI 的原生驱动，不退回 sql.js。仓库根运行：

```powershell
# desktop-app-vue 中先运行 node scripts/build-main.js 和完整 vite build
node desktop-app-vue/scripts/project-goal-native-journey.mjs --electron <Electron可执行文件> --output <新的输出目录>
node docs/research/agents/evidence/dmm-native-goal-journey-2026-11-07/verify-evidence.mjs
```

输出目录必须尚不存在。脚本最长 10 分钟，失败保存结构化结果和截图并退出 1，不降级确认或更换请求来隐藏失败。复核器只核查已归档报告/指纹和断言，不重新运行应用或测试。

## 远端与剩余工作

草稿 [#542](https://github.com/chainlesschain/chainlesschain/pull/542) 依赖 [#541](https://github.com/chainlesschain/chainlesschain/pull/541)，本批功能修复提交 `28f10a0f376abb4dfa562db45be61e7dd6a33df8`。新 [DMM Native Goal Journey](../../../../../.github/workflows/dmm-native-goal-journey.yml) 在准确 head 的 Windows runner 构建实际应用并运行同一脚本，只上传有界合成报告/截图；既有 DMM Project Host 保留 Linux/Windows/macOS 主进程和 renderer 回归，并将原先两个组织宿主用例扩大至完整组织授权配置，覆盖共享认证代次对组织动作/审批的影响。远端排队/执行状态见 `remote-checks.json`，不能用先前提交的部分成功替代本批门禁。

尚未验收：独立真实业务样本与效果、Linux/macOS GUI、真实 IDE/模型/扩展完整组合旅程、安装包与迁移升级/回退、生产来源登记/72 份签名回执及灰度切换。没有发布或升级任何包。CLI/IDE 公开版本仍沿用 .143 记录；今后发行仍须准确源码全平台 Actions 门禁和 OIDC 子包→CLI→IDE→客户端顺序。总体 DMM 目标保持进行中。
