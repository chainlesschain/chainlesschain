# PDH 推文承诺 → 实现落地 13 天计划

> **状态**：v0.1 (2026-05-22)
> **触发**：用户 review 推文 `docs/marketing/pdh-公众号推文-厦门场景.md` 后明确："不要发布出去 功能还没实现"
> **目标**：把推文每条许诺映射到具体实现任务，13 天内推文承诺 100% 对齐真机可演

## 1. Gap 总览

| 推文段落 | 已 ship | 缺什么 | 阻塞推文发布？ |
|---|---|---|---|
| §"在一台普通的小米手机上跑了一遍 30 秒 1305 条" | ✅ Plan A v0.1 真机 verified | — | 否 |
| §"加密金库 / 一键销毁 / 操作账本" | ✅ SQLCipher + DESTROY + queryEvents | UI 按钮 | 是 |
| §"已支持 19+ App / 6 大类" | system-data-android + bilibili (1 真 + 3 占位) | 18 张卡 + 12 个 Kotlin collector | **是** |
| §"用大白话提问 / AI 给出处 / 无网也能用 / 拒云开关" | 桌面通 | A3 端侧 LLM 全套 | **是** |
| §"一键带走" | ⏳ verify export API | export UI 按钮 + tar+gpg | 是 |
| §"不重复抓 / 操作账本 / iPhone 暂不可用（坦诚）" | ✅ | — | 否 |
| **rooted "完整版" 微信深度** | Phase 12 v0.5 frida-indep | Phase 12.6 frida-dep 路径 | 可选（推文已注脚） |

## 2. 13 天时间表

```
W1 — Core AI capability + UI 骨架 (5d)
┌──┬─────────────────────────────────────────────────────┬─────────┐
│D1│ A3.1 + A3.2 kotlinllamacpp AAR 接入 + Ktor server   │ Kotlin  │
│  │   build.gradle.kts + LocalLlmServer.kt 骨架         │         │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D2│ A3.3 + A3.4 LocalLlmEngine JNI wrapper + ModelMgr   │ Kotlin  │
│  │   首次下载 Qwen2.5-1.5B-Q4_K_M + SHA256 校验        │         │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D3│ A3.5 LocalCcRunner.askQuestion + CC_HUB_OLLAMA_URL  │ Kotlin  │
│  │   A3.6 HubAskScreen Compose UI                       │         │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D4│ A3.7 + A3.8 ViewModel askAction + RemoteOperate tab │ Kotlin  │
│  │   A3.10 拒云开关 Settings UI                          │         │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D5│ D5-UI HubLocalScreen 重构 6 类分组 LazyColumn        │ Kotlin  │
│  │   社交 / 邮箱 / 购物 / 出行 / 内容 / AI 助手          │         │
└──┴─────────────────────────────────────────────────────┴─────────┘

W2 — Adapter coverage (mechanical bilibili 复制 × 5 大类，5d)
┌──┬─────────────────────────────────────────────────────┬─────────┐
│D6│ 邮箱 4 家 (QQ/Gmail/163/Outlook)                     │ Kotlin  │
│  │   IMAP 表单 + email-imap snapshot mode + wiring     │ + JS    │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D7│ 支付宝 + 淘宝                                          │ Kotlin  │
│  │   SAF 文件上传（账单 CSV / 订单 HTML）+ adapter      │ + JS    │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D8│ 高德 + 携程 (Travel)                                  │ Kotlin  │
│  │   OAuth + 历史轨迹/订单 + travel-* snapshot         │ + JS    │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D9│ 抖音 + 小红书 + 微博 (社交)                            │ Kotlin  │
│  │   cookie WebView × 3 复用 SocialCookieWebViewScreen │         │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D10│ AI 助手 9 家                                          │ Kotlin  │
│   │   cookie WebView × 9 + ai-chat-history vendor wire │         │
└──┴─────────────────────────────────────────────────────┴─────────┘

W3 — 三道锁 + audit + 真机闭环 (3d)
┌──┬─────────────────────────────────────────────────────┬─────────┐
│D11│ D6-export 一键导出（tar+gpg）+ HubLocal UI 按钮     │ Kotlin  │
│   │       桌面端 reimport 验通                            │ + JS    │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D12│ Audit screen UI + 一键销毁二次确认 dialog           │ Kotlin  │
│   │       事件类型: collect/query/ask/export/destroy    │         │
├──┼─────────────────────────────────────────────────────┼─────────┤
│D13│ 真机 E2E: 5 个生活场景至少跑通 3 个                  │ Real    │
│   │       + 飞机模式 ask + citations 点击跳 audit        │ device  │
└──┴─────────────────────────────────────────────────────┴─────────┘
```

## 3. 并行加速方案（13d → 8d）

需要 3 个并行 session（git race 防御参照 memory `feedback_parallel_session_git_race.md`）：

```
Session A (Android JNI + LLM): D1 → D2 → D3 → D4 → A3.10 → A3.9 真机
Session B (Adapter UI 流水线): D5 → D6 → D7 → D8 → D9 → D10
Session C (Security & polish):  D5 part2 → D11 export → D12 audit → D13 E2E
```

各 session 必须：
- `git commit --only -- <自己改的路径>` 防 race（参照 memory）
- commit subject 加路径前缀 `(A) feat(pdh):...` `(B) feat(android):...` `(C) feat(pdh-ui):...` 利于 git log 分辨
- 跑 `dual-remote push` 工作流

## 4. 真正阻塞推文发布的必做项（MVP）

不做不能发推文：

- [x] D1-D4 **A3 端侧 LLM** ※ 否则"大白话/给出处/无网/拒云"4 项空转
- [x] D6 **邮箱 4 家** ※ 推文 §邮箱明文列出 QQ/Gmail/163/Outlook
- [x] D7 **支付宝 + 淘宝** ※ 推文 §"我妈生日那周买啥送哪儿"必依赖
- [x] D8 **高德 + 携程** ※ 推文 §出行 + 场景"上次跟那个老朋友哪儿吃饭"
- [x] D9 **抖音 + 小红书 + 微博** ※ 推文 §"内容平台"列了这仨 + B站
- [x] D10 **AI 助手 9 家** ※ 推文明文列了"豆包/文心/Kimi/通义/DeepSeek 等 9 家"
- [x] D11 **一键导出** ※ 推文 §"一键带走"
- [x] D12 **audit screen** ※ 推文 §"每次操作都有账本"
- [x] D13 **真机闭环 5 场景** ※ 否则推文是"PPT 公司"

可选：

- [ ] **rooted 微信深度** ※ 推文 §"root 完整版"已留注脚 "可选" — 不阻塞发布

## 5. 推文需小幅 amend 的项（不算改推文，是核对事实）

- ICP 备案号：`闽 ICP 备 2025105973 号-1` ← grep 现有官网/工商核验
- 公司全称：`厦门无链之链科技有限公司` ← 同上
- 公司地址：`福建省厦门市自由贸易试验区象屿路 93 号厦门国际航运中心 C 栋 4 层（邮编 361000）` ← 工商核验
- "Android 端 2026-05-22 落地" ← 实际功能 ship 日确认
- 4 项发明专利 ← 知产局查
- 《T/ZGCMCA 023—2025》AI 团体标准参编 ← 标准发布查

## 6. 子设计文档

每个大块自带 design doc：

- ✅ **A3 端侧 LLM**：`docs/design/PDH_A3_OnDevice_LLM.md`（已 land）
- ⏳ **D5 HubLocalScreen 重构**：写在 D5 启动当日
- ⏳ **D6-D10 5 个 adapter UI**：每个 collector 一个轻量设计 section（mechanical bilibili 模板）
- ⏳ **D11 export/destroy**：写在 D11 启动当日
- ⏳ **D12 audit screen**：写在 D12 启动当日

## 7. 失败 fallback 决策树

| 风险点 | 触发条件 | Fallback |
|---|---|---|
| kotlinllamacpp upstream 断更 | A3.1 接入失败 | 自维护 llama.cpp JNI ~200 LOC |
| Qwen2.5-1.5B 米机跑不动 | A3.9 真机 OOM/<2 tok/s | 降级 0.5B |
| HTTP loopback MIUI 拦 | A3.9 ETIMEDOUT | 改 Kotlin 直推（不走 cc subprocess） |
| email IMAP 厂商限制 | D6 OAuth 拒 third-party | 改 IMAP app-specific password 流程 |
| 抖音/小红书 X-s 签名变 | D9 sync 返回 403 | WebView evaluate JS hook 平台自己的签名函数 |
| 微博 cookie 频繁失效 | D9 24h cookie 过期 | 加 cookie auto-refresh + 用户提示 |
| 模型下载 1GB 失败 | D2 用户网络差 | hf-mirror 镜像 + 断点续传 + 用户改 URL |
| MIUI 后台 kill 推理进程 | A3.9 推理中闪退 | foregroundService + notification |

## 8. 发布 readiness checklist

13 天后真要发布时核验：

- [ ] 全部 9 张 adapter 卡（system-data + bilibili + 4 email + 2 shopping + 2 travel + 3 social + 9 aichat = 21 张）真机可点 + 至少 5 个有真账号 demo 数据
- [ ] HubAskScreen 飞机模式下 5 场景至少 3 个出真答案 + 引用点击跳 audit OK
- [ ] 一键导出 → 桌面 reimport 验通 (entity 数一致)
- [ ] 一键销毁 → 二次确认 dialog → 真机 vault file deleted + key 清空
- [ ] Settings 拒云开关切换真生效（关闭时调云端拒接，开启时弹明示弹窗）
- [ ] Audit screen 显 collect/query/ask/export/destroy 各类事件
- [ ] 真机 30 秒采集视频录制（视频号脚本）
- [ ] 公众号后台关键词"数据回家"配下载链
- [ ] ICP 备案号 + 公司资质 5 项二次核验通过

## 9. 关联

- `docs/marketing/pdh-公众号推文-厦门场景.md` — 推文源（需求规格）
- `docs/design/PDH_A3_OnDevice_LLM.md` — A3 子设计
- `docs/design/Personal_Data_Hub_Android_Standalone_Cc.md` — Plan A 主架构
- memory `pdh_plan_a_android_standalone_design.md` — Plan A v0.1 ship 状态
- memory `pdh_a8_social_adapters_landing.md` — A8 v0.1 ship 状态
- memory `personal_data_hub_phase_status.md` — PDH 总进度
