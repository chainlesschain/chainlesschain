# CLI 0.166.105 与 IDE 下一版候选

2026-10-18：当前公开仍为 CLI **0.166.104**、Open VSX **0.37.149**、JetBrains **0.4.166**。下一版候选为 CLI **0.166.105**、VS Code **0.37.150**、JetBrains **0.4.167**，两个候选插件推荐 CLI `.105`；尚待最终提交完整 CI 矩阵、npm OIDC 发布与公开包回读，插件在 CLI 可获取后发行。36+9 活动已执行，累计候选合格 **25/45**；最新补测已收齐 **22/25**，其中 **4 项全流程通过**，另有 **3 项 Windows JetBrains 进行中**。候选合格不等于全流程通过，新版尚未发布或补测，不能声称全部合格。

## 版本与发布顺序

| 组件                  | 当前公开  | 下一版候选 |
| --------------------- | --------- | ---------- |
| CLI                   | 0.166.104 | 0.166.105  |
| Open VSX              | 0.37.149  | 0.37.150   |
| JetBrains Marketplace | 0.4.166   | 0.4.167    |

两个候选插件推荐 CLI 0.166.105。Agent SDK 0.2.15、Session Core 0.3.19、Context/Memory Kernel 0.1.10、PDH 0.4.65 保持独立版本。

最终发行提交需要 CLI CI、CLI Strict Sandbox 全系统矩阵及 IDE/ARM64 门禁通过；npm 使用 GitHub Actions OIDC。CLI 公开可获取后才发布插件。JetBrains 必须已批准、已列出、未隐藏且可公开下载，上传成功不等于审核通过。Microsoft Marketplace 仍为独立发行渠道。

## 本轮改进

- 通用编码任务指导与纯静态相对导入反馈，不执行候选代码、不注入特定任务答案。
- 延迟写入未完成时不误报完成，区分 provider 网络中止与用户取消。
- JSON 终态增加有界安全错误类型和原因代码，不额外重试或重放请求；新增详情不复制 URL、headers、body 或 stack。
- JetBrains 历史与实时回答共用 Markdown 渲染，保留原文、会话和行标识。

## 升级与补测

目前公开安装命令：

```bash
npm i -g chainlesschain@0.166.104 --registry https://registry.npmjs.org
```

仅在 0.166.105 公开包回读成功后使用：

```bash
npm i -g chainlesschain@0.166.105 --registry https://registry.npmjs.org
cc --version
cc doctor
```

插件公开后升级并重启 IDE，确认 Doctor 指向同一 CLI。对未合格项使用新公开包补测；保留已合格候选的原始证据，不因诊断重复生成。原失败记录不改写。候选验收、宿主恢复和全流程结果分别报告，本候选准备不代表补测通过。
