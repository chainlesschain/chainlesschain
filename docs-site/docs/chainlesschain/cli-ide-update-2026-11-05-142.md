# CLI .142 与 IDE 配套升级：授权目标事件和历史恢复

## 当前发行状态

截至 2026-11-05，Session Core **0.3.25**、CLI **0.166.142**、Open VSX 扩展 **0.37.178** 已公开。
JetBrains **0.4.195** 已通过官方宿主矩阵和上传，仍等待商店审核或公开索引，公开可用性尚未验证。
不可变 npm 和 IDE 发行源码为 `b78cf0af8c8b0491189465773b148ac77c332222`。

PC、Android 和 iOS **v5.0.3.145** 正在准备发行，当前已核验公开客户端仍是 **v5.0.3.144**。
用户已明确授权本次客户端在核验 JetBrains 官方上传后先行发布，不等待商店审核。
其他公开依赖、构建和制品核验继续执行。Microsoft Marketplace 渠道仍暂缓。

## 本次功能

- **另行授权的目标事件。** 插件可显式观察目标状态或桌面风险与动作摘要，读取时重新检查授权、信任和插件声明。
- **保留历史恢复。** 新桌面端 v5 历史授权独立于旧授权。CLI 每次读取一页，确认输出和重新核验后原子提交检查点；中断可能重复事件，应按事件 ID 去重。
- **IDE 显式恢复。** 原生文件选择器传递连接与检查点路径，提供新建、恢复、下一页和取消操作，没有自动重试或持续翻页。
- **组合交付场景。** `project-delivery-assistant` 0.2.0 组合已有证据、事件、历史和待确认描述草稿；安装不会启动自动工作，也不自动创建或执行任务。

新的原生历史入口需要匹配的新版桌面客户端；仅升级 CLI 或扩展不能为旧桌面端增加该入口。
日志保留最近 1000 条已接入事件，没有旧版本历史回填。事件、检查、动作回执和描述编辑都不证明业务目标完成。

## 升级

使用 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.142 --registry https://registry.npmjs.org
cc --version
cc doctor
```

重启 CLI、`cc ui` 和 IDE 聊天宿主，检查 IDE 实际连接的可执行路径。
Open VSX 可安装 **0.37.178**。JetBrains **0.4.195** 需等待商店公开或使用明确标识的官方构件侧载。
上一已核验公开的 JetBrains **0.4.194** 推荐 CLI **0.166.141**，新插件的推荐关系不适用于旧插件。

## 发行核验与限制

准确发行提交的 CLI CI 跨全部配置操作系统完成，**75 项成功、1 项可选 dry-run 跳过**；Strict Sandbox **6/6** 成功。
Actions OIDC 先发布并核验必需子包，再发布 CLI。独立回读确认公开 tarball 与不可变工作流制品逐字节一致，来源签名匹配准确提交。
Open VSX 流程已核验公开 VSIX。JetBrains 上传与商店审核通过分别记录。

registry-only 的 `--ignore-scripts` 安装和签名核验不等于完整 native/postinstall、真机或真实 DMM GUI 验收。
本轮未新增付费模型任务评测，既有任务验收结果不因工程检查或发行而提升。

[完整发行记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release142-public/README.md)
· [npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/41887211826)
· [独立回读](https://github.com/chainlesschain/chainlesschain/actions/runs/41950556751)
· [Open VSX](https://github.com/chainlesschain/chainlesschain/actions/runs/41950792178)
· [JetBrains](https://github.com/chainlesschain/chainlesschain/actions/runs/41950791667)
