# ChainlessChain 文档中心

按用途查找安装指南、开发文档、专题设计和实施记录。项目介绍见[仓库首页](../README.md)。

## 常用入口

| 我想……                 | 文档                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 安装与启动应用         | [安装指南](./quick-start/INSTALLATION.md) · [快速开始](./quick-start/QUICK_START.md)                                           |
| 使用 CLI               | [CLI 文档](./cli/README.md) · [命令索引](./cli/CLI_COMMANDS_REFERENCE.md) · [CLI 安装指南](./guides/CLI_INSTALLATION_GUIDE.md) |
| 使用 IDE 插件和工作台  | [IDE 文档](./ide/README.md) · [演进工作台](./features/evolution-workbench/README.md)                                           |
| 了解功能与架构         | [功能总览](./FEATURES.md) · [系统架构](./ARCHITECTURE.md) · [详细设计](./design/README.md)                                     |
| 参与开发               | [开发指南](./development/DEVELOPMENT.md) · [贡献指南](./development/CONTRIBUTING.md) · [API 参考](./api/API_REFERENCE.md)      |
| 部署与发布             | [部署文档](./deployment/README.md) · [发布文档](./releases/README.md)                                                          |
| 查看差距分析与实施进展 | [研究分析](./research/README.md) · [项目报告](./reports/README.md) · [RSI Agent 批次索引](./reports/rsiagent/README.md)        |
| 查看版本变化           | [项目更新日志](../CHANGELOG.md) · [历史版本记录](./CHANGELOG.md)                                                               |

## 目录分类

### 使用与接入

| 目录                                 | 内容                                          |
| ------------------------------------ | --------------------------------------------- |
| [quick-start](./quick-start/)        | 安装、启动和快速上手                          |
| [guides](./guides/README.md)         | 功能使用指南、接入教程、微信数据采集          |
| [manual](./manual/)                  | 产品介绍、白皮书和使用手册（Markdown / Word） |
| [cli](./cli/README.md)               | CLI 命令、运行时、能力清单和验证证据          |
| [ide](./ide/README.md)               | IDE 插件使用与工作区面板                      |
| [api](./api/README.md)               | API 与技能管理接口                            |
| [configuration](./configuration/)    | 配置、编辑器集成和界面说明                    |
| [deployment](./deployment/README.md) | 部署、监控和运维                              |
| [releases](./releases/README.md)     | 发布流程、候选版本、验收清单和发布说明        |

### 架构与开发

| 目录                                            | 内容                                       |
| ----------------------------------------------- | ------------------------------------------ |
| [design](./design/README.md)                    | 系统设计、模块设计和技术验证；文档站同步源 |
| [development](./development/README.md)          | 开发规范、贡献指南、调试和插件开发         |
| [implementation-plans](./implementation-plans/) | 实施计划、路线图和架构决策                 |
| [flows](./flows/)                               | 开发、交付和项目工作流程                   |
| [migrations](./migrations/)                     | 迁移方案与兼容性调整                       |
| [optimization](./optimization/README.md)        | 优化计划、性能改进和修复记录               |
| [research](./research/README.md)                | CLI、IDE、Agent 的竞品研究和差距分析       |
| [audits](./audits/)                             | 专项审计                                   |

### 功能专题

| 目录                                           | 内容                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| [features](./features/README.md)               | 功能说明与模块专题；[演进工作台](./features/evolution-workbench/README.md) |
| [blockchain](./blockchain/README.md)           | 区块链、合约、跨链与钱包                                                   |
| [enterprise](./enterprise/README.md)           | 企业版设计、实现与迁移                                                     |
| [identity](./identity/README.md)               | DID、身份切换与权限                                                        |
| [mobile](./mobile/README.md)                   | 移动端实现、同步与优化                                                     |
| [linux](./linux/)                              | Linux 配对与平台集成                                                       |
| [p2-intelligence](./p2-intelligence/README.md) | P2 智能层设计与阶段记录                                                    |
| [skills-and-tools](./skills-and-tools/)        | 技能与工具说明                                                             |

### 记录与内部资料

| 目录                           | 内容                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| [reports](./reports/README.md) | 实施、状态、测试与修复报告；[RSI Agent 系列](./reports/rsiagent/README.md) |
| [internal](./internal/)        | 内部工程记录和排障资料                                                     |
| [claude](./claude/)            | 协作上下文、决策和开发模式记录                                             |
| [legal](./legal/)              | 隐私政策、服务条款和申请资料                                               |

## 文档放置约定

- 根目录保留本导航、`ARCHITECTURE.md`、`FEATURES.md` 和 `CHANGELOG.md`，专题文档放入对应目录。
- 使用指南与运行说明按产品或功能归类；差距分析放入 `research/cli/`、`research/ide/` 或 `research/agents/`。
- 批次交付和阶段结论放入 `reports/`。RSI Agent 系列统一放入 `reports/rsiagent/`，并维护按批次编号排列的索引。
- 新建普通文档使用 `kebab-case.md`；带时间的报告建议使用 `topic-YYYY-MM-DD.md`。现有文件名保留，同名但内容不同的文档用日期区分。
- 添加或移动文档时，同步更新所在分类的 `README.md`、相对链接和引用路径；脚本、测试与工作流中的路径也需要检查。
- `*.generated.md` 由对应脚本生成；`design/` 的文档站映射沿用现有同步流程。

原导航中的版本更新说明保存在[文档更新历史](./releases/documentation-history.md)。历史报告中的完成度、版本和限制以各自记录日期为准。
