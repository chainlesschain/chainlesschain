# ChainlessChain 安装部署

> 核对日期：**2026-11-09**。公开 CLI **0.166.145**、Open VSX **0.37.181**、JetBrains **0.4.198**；两款 IDE 推荐 CLI .145。PC / mobile 仍为独立公开产品 **v5.0.3.145**。源码产品 .146 和 VS Code .182 不作为本页已核对的公开安装推荐。

## 概述

先选择需要的入口：终端 Agent 安装 npm CLI；浏览器工作台由 `cc ui` 启动；桌面与移动客户端使用各自的产品安装包；IDE 插件另外安装并连接 CLI。仅使用 CLI 和云端模型时，不需要先部署整套 Docker 后端。

[系统概述](./overview) · [本轮升级指南](./cli-ide-update-2026-11-09-145) · [配置说明](./configuration)

## 核心特性

- **固定公开版本安装**：使用官方 npm registry，区分 CLI、IDE、客户端及共享子包的独立版本。
- **跨端入口**：Windows / macOS / Linux 桌面、Android、iOS、CLI、Web 面板与双 IDE。
- **按需初始化**：`cc setup` 支持跳过桌面下载和 Docker 配置，先完成模型连接与 CLI 初始化。
- **环境诊断**：`cc doctor`、`cc config validate` 检查实际安装与配置状态。
- **独立升级**：CLI / IDE 升级不自动替换已经安装的桌面或移动客户端。

## 系统架构

```text
npm 包 → CLI / Agent → 配置的模型服务
                  ├→ cc ui → 本机浏览器工作台
                  └→ IDE 插件 → 当前工作区的 CLI 宿主

产品 Release → 桌面安装包 / Android APK / iOS IPA
Docker Compose → 按需启动本地模型、向量库和项目后端
```

## 系统要求

| 用途               | 要求                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| npm CLI / 源码开发 | Node.js **22.12.0+**、npm **10+**；源码开发还需要 Git                                  |
| 桌面客户端         | 按 Release 中操作系统与架构选择安装包；安装打包客户端不等于需要系统 Node.js            |
| Android .145       | **Android 9 / API 28+**；按设备选择 APK 架构                                           |
| iOS .145           | **iOS 16.0+**；公开 IPA 按 ad-hoc 签名设备范围安装                                     |
| Docker 后端        | 已运行的 Docker Engine / Docker Desktop 与 Docker Compose；仅在使用相关服务时需要      |
| 本地模型           | 内存、显存和磁盘按选用模型及上下文规模准备，不把固定的历史资源数字当作所有模型最低要求 |

Android / iOS 要求按公开产品 .145 的发行源码核对，不能从源码包版本 .146 推断已经发布了新安装包。

## 安装 CLI 与 Web 面板

### 1. 检查环境并安装

```bash
node --version
npm --version
npm i -g chainlesschain@0.166.145 --registry https://registry.npmjs.org
cc --version
```

安装后应显示 `0.166.145`。若 `cc` 指向系统 C 编译器或另一个工具，使用完整命令 `chainlesschain --version`，并核对 npm 全局可执行目录是否在当前终端的 PATH 中。

### 2. 初始化 CLI

```bash
cc setup --skip-download --skip-services
cc doctor
cc config validate
```

按向导选择实际可访问的模型服务、API 模型 ID 和该服务的凭据。向导的 `--skip-download` 跳过桌面二进制下载，`--skip-services` 跳过 Docker 配置；没有这些选项时按向导确认相应步骤。配置修改与密钥输入详见[配置说明](./configuration)。

### 3. 打开需要的工作入口

```bash
# 终端交互 Agent
cc agent

# 本机浏览器工作台
cc ui
```

浏览器面板默认使用本机 HTTP `18810`、WebSocket `18800`，以启动时输出的地址为准。远程访问需要另外配置绑定与认证，不应直接把本机默认服务当成公网部署。

## PC 端安装

从 [v5.0.3.145 正式发行页](https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.145) 或[官网桌面下载页](https://www.chainlesschain.com/desktop)选择资产。

| 平台                | 该版本资产示例                                          | 安装方式                           |
| ------------------- | ------------------------------------------------------- | ---------------------------------- |
| Windows             | `ChainlessChain-Setup-5.0.3-alpha.145.exe`              | 运行安装程序，按向导完成安装       |
| Windows Portable    | `ChainlessChain-Portable-5.0.3-alpha.145.exe`           | 使用便携版本，按其数据目录说明运行 |
| macOS Apple Silicon | `ChainlessChain-5.0.3-alpha.145-arm64.dmg`              | 打开 DMG 并复制应用到 Applications |
| macOS Intel         | `ChainlessChain-5.0.3-alpha.145.dmg`                    | 选择与 CPU 架构匹配的资产          |
| Linux AppImage      | `ChainlessChain-5.0.3-alpha.145.AppImage`               | 赋予执行权限后运行                 |
| Debian / Ubuntu     | `chainlesschain-desktop-vue_5.0.3-alpha.145_amd64.deb`  | 用系统包管理器安装本地 DEB         |
| RPM 系统            | `chainlesschain-desktop-vue-5.0.3-alpha.145.x86_64.rpm` | 用对应系统包管理器安装本地 RPM     |

产品标签使用 `v5.0.3.145`，桌面资产包含 `5.0.3-alpha.145`，两者是该发行的不同命名形式。下载大小以资产页面为准；本页不再使用旧的 1.0.0 文件名或未经核验的 APT 软件源。

Linux 本地文件安装示例，在保存资产的目录执行：

```bash
chmod +x ChainlessChain-5.0.3-alpha.145.AppImage
./ChainlessChain-5.0.3-alpha.145.AppImage

# 或安装已下载的 Debian 资产
sudo apt install ./chainlesschain-desktop-vue_5.0.3-alpha.145_amd64.deb
```

首次启动按应用界面完成身份、存储和模型配置。原生创建、目标移交及模型草稿等新入口仍要求匹配的桌面实现，不能只凭 CLI .145 安装成功认定现有客户端具备这些能力。

## IDE 插件安装

| IDE                | 当前公开插件          | 安装与配对                                                                                                                                                                                                                          |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code 兼容编辑器 | Open VSX **0.37.181** | [商店页面](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide)，或[下载 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.181/file/chainlesschain.chainlesschain-ide-0.37.181.vsix)后从 VSIX 安装 |
| JetBrains          | **0.4.198**           | [Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge)，按 IDE 兼容范围安装                                                                                                                            |

两款插件均推荐 CLI **0.166.145**。安装/升级后重启旧聊天宿主，通过 Doctor 核对实际 CLI 路径。Microsoft Marketplace 尚未发行；VS Code 用户可使用公开 VSIX。详细操作见 [IDE 指南](./ide-plugin)。

## 移动端安装

- **Android**：从产品 .145 发行页下载 `app-arm64-v8a-release.apk`、`app-armeabi-v7a-release.apk` 或 `app-universal-release.apk`；按设备架构选择并在系统界面确认安装。`app-release.aab` 是分发构建，不是直接点击安装的 APK。
- **iOS**：该发行提供 `ChainlessChain.ipa`；按发行说明和 ad-hoc 签名设备范围安装。源码构建需要 macOS、Xcode 及匹配的签名配置，本页不承诺 App Store / TestFlight 全设备可用。
- **跨设备功能**：安装后仍需显式配对、身份确认和相应数据授权。详见 [Android 指南](/guide/mobile-android-usage) 与 [iOS 指南](/guide/mobile-ios-usage)。

## 从源码开发桌面应用

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
npm ci --legacy-peer-deps
npm run dev

# 生产构建
npm run build
```

以上根目录脚本实际进入 `desktop-app-vue`。也可以在该目录运行 `npm run dev`、`npm run build`；主进程单独构建为 `npm run build:main`。源码安装涉及 Electron 和原生依赖，应按平台提供兼容工具链；不要跳过安装脚本后把缺失的 native 模块当成产品故障。源码构建属于当前 Git 提交，不是已经公开的产品安装包。

## 按需启动 Docker 服务

在仓库根目录显式指定所用 Compose 文件和服务，避免混淆根目录、`backend/docker` 与 `config/docker` 下的不同编排：

```bash
docker compose -f docker-compose.yml up -d ollama qdrant postgres redis
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 ollama
```

CLI 的对应包装命令为：

```bash
cc services up ollama qdrant postgres redis
cc services logs --tail 100 ollama
```

`cc services` 从当前工作目录及其明确搜索路径查找 Compose 文件；应在包含目标编排的目录运行。本页不提供未注册的 `cc services restart`：需要重启时直接使用 `docker compose -f docker-compose.yml restart <service>`。

根编排中 Ollama 为 `11434`、Qdrant HTTP 为 `6333`、PostgreSQL 为 `5432`、Redis 为 `6379`。其他服务按所选 Compose 文件核对；部署到服务器时设置实际凭据与监听范围，不沿用开发默认值。

## 配置参考

| 配置入口                                   | 作用                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `cc setup --skip-download --skip-services` | 只初始化 CLI 与模型配置                             |
| `cc config list`                           | 显示脱敏配置和 CLI 配置文件的实际路径               |
| `cc config effective --json`               | 查看启动配置的脱敏来源诊断                          |
| `cc config validate`                       | 校验字段、类型与配置存储权限                        |
| `cc config set-secret llm.apiKey`          | 交互式隐藏输入模型服务密钥                          |
| `cc start`                                 | 完成 setup 后启动已配置的桌面二进制，不代替安装验证 |

CLI 默认配置在 `~/.chainlesschain/config.json`；桌面端还存在 Electron `userData` 下的应用和模型配置，它们不是同一个文件。不要把旧的完整 JSON 示例覆盖到新配置中；详见[配置路径与字段](./configuration)。

## 使用示例

### 更新到本页核对的公开组合

```bash
npm i -g chainlesschain@0.166.145 --registry https://registry.npmjs.org
chainlesschain --version
chainlesschain doctor
```

随后升级到 Open VSX .181 / JetBrains .198 并重启聊天宿主。桌面与移动客户端按产品发行页独立升级，不因 CLI 更新而自动更换。

### 安装后检查模型配置

```bash
cc config explain llm.provider
cc config explain llm.model
cc llm providers --json
```

显式运行 `cc llm test` 会访问所配置的模型服务，可能产生真实推理用量；只读配置检查不等于模型连通性或任务质量验收。

## 性能指标

本次未重新测量安装耗时、内存、模型首 token 延迟或 Docker 就绪时间。下载大小以当前资产为准，源码依赖、平台、缓存和网络会影响安装耗时；本地模型资源按模型与上下文选择。本页不提供未经本轮实测的“15 秒安装”或固定覆盖率结论。

## 测试覆盖

本页根据命令注册、包版本、实际资产、平台构建配置和对应测试文件更新。相关回归包括 `packages/cli/__tests__/integration/setup-flow.test.js`、`__tests__/unit/downloader.test.js`、`__tests__/unit/service-manager.test.js`、`__tests__/unit/config-security.test.js` 与 `__tests__/unit/paths.test.js`。

公开 .145 的准确发行源已核对 CLI CI **75 成功、1 跳过** / Strict Sandbox **6 成功**。这是该发行的记录，不替代本次文档提交的构建，也不代表所有客户端安装、IDE GUI 或真实模型任务已重新验收。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

## 安全考虑

- 模型密钥用 `set-secret` 的隐藏输入或受控 stdin；普通 `config set` 拒绝把密钥放进命令行参数。
- 保存模式可能是系统密钥存储，也可能是仅当前用户可读的配置文件，不能统称所有平台都在 JSON 内 AES 加密。
- 下载并核对与操作系统、架构和发行版本匹配的资产；备份前停止相关写入，保留恢复所需的权限、密钥存储与版本信息。
- CLI 没有通用顶层 `backup` / `restore` 命令；使用具体业务的导出/同步/快照入口，不以复制单个 JSON 代替完整恢复。
- U-Key/SIMKey 的 PIN、驱动和签名方式按设备配置核对，不使用文档假定的通用默认 PIN。

## 故障排查

| 现象                           | 检查方式                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| npm 安装 E404 或旧版本         | 核对 `--registry https://registry.npmjs.org`、固定版本与网络，再重新打开终端检查完整命令     |
| `cc` 不是 ChainlessChain       | 使用 `chainlesschain --version`，检查 PATH 中实际命令来源                                    |
| Electron / native 模块安装失败 | 核对 Node 版本、平台工具链和原始安装日志；不要把镜像或编译失败当作安装完成                   |
| `cc start` 提示未 setup        | 先运行向导；只使用 CLI 时可跳过桌面下载，另行安装客户端                                      |
| Docker 提示找不到编排          | 切换到目标目录或直接运行显式 `docker compose -f ...` 命令                                    |
| 模型返回 401 / 不存在的模型    | 在配置入口核对同一个 provider、Base URL、API 模型 ID 与该端点的凭据                          |
| 配置权限校验失败               | 先读 `cc config validate --json`；确认目标是自己的配置目录后再用 `--fix` 做安全迁移/权限修复 |

## 关键文件

- `packages/cli/src/constants.js`：CLI 默认值和最低 Node 版本。
- `packages/cli/src/commands/setup.js`、`doctor.js`、`start.js`、`services.js`：实际命令和选项。
- `packages/cli/src/lib/paths.js`、`service-manager.js`、`downloader.js`：目录、Compose 查找与下载。
- `desktop-app-vue/package.json`、`android-app/app/build.gradle.kts`、`ios-app/ChainlessChain.xcodeproj/project.pbxproj`：构建脚本和平台要求。

## 相关文档

- [系统概述](./overview) · [配置说明](./configuration) · [CLI 指南](./cli)
- [IDE 指南](./ide-plugin) · [CLI / IDE 当前升级指南](./cli-ide-update-2026-11-09-145)
- [自进化开关配置](./self-evolution-configuration) · [输入与恢复](./agent-input-and-recovery)
