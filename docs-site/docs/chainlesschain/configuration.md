# 配置说明

> 核对日期：**2026-11-09**。以下按公开 CLI **0.166.145** 组合与仓库配置实现说明。先确认正在配置 CLI、IDE 聊天宿主还是桌面应用，避免编辑一个文件却期待另一个入口自动生效。

## 概述

CLI 与桌面端存在不同配置根目录和管理器。CLI 使用自己的 `config.json`、受管/工作区设置与模型连接解析；桌面端还维护 Electron `userData` 下的统一配置、应用配置和独立模型配置。它们不能概括为“所有入口共享同一个 JSON、所有环境变量统一覆盖文件”。

先使用 `cc config list` 确认 CLI 文件路径，再用 `effective` / `explain` 查看配置来源。桌面模型连接通过应用设置管理，IDE 的连接表单保存所配置 CLI 的连接；已有运行中的聊天宿主需要重启或按会话规则应用后续请求。

## 核心特性

- **可查询字段**：`config keys` / `config schema` 从注册描述符给出类型、默认值和弃用迁移。
- **来源诊断**：`config effective` / `config explain` 给出脱敏配置与来源，标识适用的受管锁定。
- **安全输入**：密钥经隐藏 TTY 或 stdin 输入，不通过普通 `config set` 的参数传递。
- **原子写入**：CLI 配置更新使用跨进程锁和原子替换，写入失败不会以未受锁的方式继续。
- **端点隔离**：模型连接按 provider 与规范化端点绑定，切换无密钥端点不会借用旧连接的密钥。
- **独立开关**：自进化默认关闭，模型设置、Memory 自动回忆与已有会话按各自范围生效。

## 系统架构

```text
CLI 默认值 + CLI config.json + 入口适用的 settings / 环境 / 显式参数
                    ↓
       模型连接解析与会话捕获的配置身份
                    ↓
       IDE / Agent / Web 面板按宿主读取或展示

桌面 userData
  ├─ .chainlesschain/config.json   统一配置管理器
  ├─ config/app-config.json       应用配置管理器
  └─ llm-config.json              桌面模型连接管理器
```

`cc config effective` 是启动配置及来源的诊断入口，不是所有命令参数或运行中会话最终请求的完整快照。模型/端点仍按具体入口的连接解析和会话绑定判断。

## 配置文件位置

### CLI

默认文件为用户主目录下的 `.chainlesschain/config.json`：

| 平台          | 默认位置                                    |
| ------------- | ------------------------------------------- |
| Windows       | `%USERPROFILE%\.chainlesschain\config.json` |
| macOS / Linux | `~/.chainlesschain/config.json`             |

原生覆盖变量 **`CHAINLESSCHAIN_HOME`** 指向包含 `config.json` 的配置/数据根目录，并优先于兼容入口的 `CLAUDE_CONFIG_DIR` 回退。目录必须是合规的绝对私有路径，不能直接指向工作区、其子目录/祖先或共享系统目录。不要把旧文档中的 `CC_DATA_DIR` 当作这里的等价根目录开关。

当前生效路径以 `cc config list` 的 `Config:` 输出为准。改变配置根目录后需使用相同环境启动后续 CLI / IDE 宿主，旧目录内的密钥引用和会话不会自动搬迁。

### 桌面应用

以下路径中的 `userData` 由 Electron 的 `app.getPath("userData")` 决定，以该构建实际日志/设置为准；不要只按应用显示名猜目录。

| 文件                                   | 管理范围                                     |
| -------------------------------------- | -------------------------------------------- |
| `userData/.chainlesschain/config.json` | UnifiedConfigManager 统一配置                |
| `userData/config/app-config.json`      | AppConfig 应用配置                           |
| `userData/llm-config.json`             | 桌面 LLMConfigManager 模型连接与对应安全存储 |

CLI 的 `~/.chainlesschain/config.json` 与这些文件路径不同。移动端也使用自己的应用数据及安全存储；不能将桌面 JSON 原样复制为通用移动配置。

## 配置来源与优先级

| 场景                   | 解析规则与诊断                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| CLI 普通配置           | 内置默认值与用户文件合并；字段由版本化 schema 校验                                                    |
| CLI 模型连接           | 显式连接选项、同 provider / 同规范化端点的配置、provider 默认值按连接解析器选择；密钥另有专用选择规则 |
| 受管 / 工作区 settings | 适用入口加载规则、模型及环境设置；兼容性和受管锁定由该入口核验                                        |
| 环境凭据               | `CC_API_KEY`、相应 provider 的凭据环境变量等按入口解析；不是任意环境变量都能覆盖任意 JSON 字段        |
| 桌面配置               | 由对应管理器合并自己的默认值、环境和已保存文件，不能直接套用 CLI 的模型参数优先级                     |
| 已在运行的会话         | 继续受已经捕获的连接身份和策略约束；改文件不等于正在发送的请求已经切换                                |

```bash
cc config effective --json
cc config explain llm.provider --json
cc config explain llm.model --json
```

关注 `provenance`、来源文件、`locked` 和兼容性信息。诊断不发送推理请求；显式连接测试另行执行。

## 配置参考

### 常用字段

| 字段                                   | 类型 / 范围          | 说明                                                                                       |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `llm.provider`                         | 已注册 provider ID   | 不同服务/协议使用正确的 provider，兼容服务可使用 `custom`                                  |
| `llm.baseUrl`                          | 字符串               | API 基地址；不是 `/chat/completions`、`/responses` 等单次请求路径                          |
| `llm.model`                            | 字符串               | 服务实际提供的 API 模型 ID，不使用未经核对的控制台显示名称                                 |
| `llm.apiKey`                           | secret               | 使用 `config set-secret` 或模型配置表单保存                                                |
| `llm.visionModel`                      | 字符串或空值         | 适用时的图像模型回退；实际能力仍需 provider 支持                                           |
| `llm.fallbackModels`                   | 数组或字符串         | 有序回退模型；旧 `llm.fallbackModel` 已标记迁移                                            |
| `llm.temperature`                      | 数字，0–2            | 具体模型可能施加进一步限制                                                                 |
| `llm.maxTokens`                        | 正数                 | 输出上限配置，不等于模型上下文容量或服务实际输出能力                                       |
| `evolution.enabled`                    | 布尔值，默认 `false` | 新 Agent 会话的可选自进化开关                                                              |
| `services.autoStart`                   | 布尔值，默认 `false` | 服务相关配置；具体启动入口仍按命令行为判断                                                 |
| `services.dockerComposePath`           | 字符串或空值         | schema 中的编排路径字段；`cc services` 当前仍按自身搜索逻辑查找文件，不承诺此字段替代 `-f` |
| `paths.projectRoot` / `paths.database` | 字符串或空值         | 对应模块适用的项目根/数据库路径覆盖                                                        |

完整清单以当前 CLI 的 `cc config keys --json`、`cc config schema --json` 为准。不要直接粘贴一份包含旧数据库、UI、网络字段的通用 JSON 覆盖现有配置。

### 只包含非敏感字段的结构示例

以下是配置文件的**局部结构**，不是替换整个文件的导入模板：

```json
{
  "evolution": {
    "enabled": false
  },
  "llm": {
    "provider": "ollama",
    "baseUrl": "http://127.0.0.1:11434",
    "model": "YOUR_INSTALLED_MODEL_ID"
  },
  "services": {
    "autoStart": false
  }
}
```

`YOUR_INSTALLED_MODEL_ID` 必须替换为服务中实际存在的模型 ID。切换整个连接时优先使用下面的向导/原子连接入口，以免仅修改部分字段后留下旧连接设置。

## 使用示例

### 1. 查看、校验与调整普通配置

```bash
cc config list
cc config keys --json
cc config schema --json
cc config validate --json
cc config set evolution.enabled false
cc config get evolution.enabled
```

未知字段默认拒绝；`--allow-unknown` 面向扩展开发，不代表运行时会读取任意新字段。`config validate --fix` 可进行已实现的安全迁移与权限修复，先检查诊断并保留原文件。

### 2. 初始化或修改模型连接

初次使用可以运行 `cc setup --skip-download --skip-services`。IDE 用户也可在“配置大模型 / Configure LLM”中选择平台并保存到该 IDE 实际使用的 CLI。

自动化场景使用 `cc llm configure` 从 stdin 接收连接 JSON，原子保存 provider、模型、端点和凭据关系。以下示例不含密钥；先将模型 ID 替换为本机 Ollama 已安装的值。

macOS / Linux / Git Bash：

```bash
cc llm configure <<'JSON'
{
  "provider": "ollama",
  "baseUrl": "http://127.0.0.1:11434",
  "model": "YOUR_INSTALLED_MODEL_ID",
  "apiKey": ""
}
JSON
```

PowerShell：

```powershell
@'
{
  "provider": "ollama",
  "baseUrl": "http://127.0.0.1:11434",
  "model": "YOUR_INSTALLED_MODEL_ID",
  "apiKey": ""
}
'@ | cc llm configure
```

本地 OpenAI-compatible 服务可选择 `custom` 并填写其实际 API 基地址（常见为服务提供的 `/v1` 基路径）。非 loopback HTTP 连接需要在配置表单或 stdin 结构中显式确认 `allowHttp: true`；该确认不会让 HTTP 变成加密传输。新无密钥端点不会沿用旧端点密钥。

### 3. 安全写入密钥

```bash
cc config set-secret llm.apiKey
```

在真实交互终端中按隐藏提示输入。需要强制系统密钥存储时：

```bash
cc config set-secret llm.apiKey --storage keychain
```

`keychain` 是 CLI 的跨平台存储模式名称，不只适用于 macOS。自动化时从可信秘密来源经 stdin 传入；不要把真实密钥写进命令参数、示例 JSON 文件或 shell 历史。

### 4. 查看生效范围与测试连接

```bash
cc config effective --json
cc config explain llm.model
cc llm providers --json
```

上述配置/目录查询不是模型推理验收。`cc llm test` 会联系所配置服务，可能产生用量；修改配置后重启旧宿主，确认当前会话使用的实际模型和端点。

### 5. Memory 与自进化

```bash
cc config set evolution.enabled false
cc agent --no-recall-memory
```

`evolution.enabled` 的显式 `false` 覆盖其环境开启路径，修改后对新宿主/会话生效。`--no-recall-memory` 关闭该 Agent 的自动 Memory 回忆，恢复会话时再次指定；它不删除记忆，不撤回此前发出的内容。详见[自进化配置](./self-evolution-configuration)。

## 密钥保存方式

| 模式                     | 行为                                                     |
| ------------------------ | -------------------------------------------------------- |
| `--storage auto`（默认） | 优先系统安全存储；不可用时可回退到仅所有者可读的配置文件 |
| `--storage keychain`     | 强制系统存储；不可用时拒绝写入，不回退为普通配置值       |
| `--storage file`         | 采用 owner-only 配置文件保存，不应描述为统一的密文保险库 |

系统后端包括 Windows CurrentUser DPAPI、macOS Keychain、Linux/FreeBSD Secret Service。使用系统存储时，配置文件保存秘密引用；使用文件回退时，文件权限是保护边界，不等于内容都经过 AES 加密。

CLI 的 `list`、`get`、`effective` 和 `explain` 对敏感值脱敏；直接读取原始文件仍可能看到文件回退保存的秘密。把显示用的脱敏 JSON 当备份会丢失真正的凭据；复制引用文件到另一台设备也不能证明系统存储中的秘密可恢复。

## 性能指标

本次文档更新没有重测配置读取、校验、加解密或多设备同步耗时。配置原子写入、锁和凭据后端属于实现行为，不能据此给出固定毫秒级基准或跨设备同步承诺。性能问题按实际平台、存储和宿主日志定位。

## 测试覆盖

可核对的相关测试包括：

- `packages/cli/__tests__/unit/config-manager.test.js`：配置读写。
- `packages/cli/__tests__/unit/config-security.test.js`、`secret-store.test.js`：秘密输入、存储及脱敏边界。
- `packages/cli/__tests__/unit/config-editor-broker.test.js`、`paths.test.js`：编辑入口和目录验证。
- `packages/cli/__tests__/unit/llm-connection-config.test.js`、`__tests__/integration/llm-connection-config.test.js`：原子连接保存与端点隔离。
- `desktop-app-vue/tests/unit/config/unified-config-manager.test.js`：桌面配置管理器。

文件存在及历史测试结果不代表本次提交已重新执行完整套件。本次只更新文档和示例，不新增真实推理请求、覆盖率统计或业务验收；发行与最新源码验证继续独立记录。

## 安全考虑

- `config set` 拒绝注册的 secret 字段；使用隐藏输入或受控 stdin。
- `config validate` 检查字段与权限；Windows 使用所有者 ACL，POSIX 使用私有目录/文件权限。不要把共享目录或代码工作区作为整个私有配置根目录。
- 模型配置测试与实际任务可能访问外部服务；只有当前选定端点的凭据可以用于该连接。
- 设置来源、受管锁定、会话身份和当前授权分别核验；显示成功保存不等于当前运行请求已经换用新配置。
- 日志、支持材料和备份应按具体存储方式处理，不上传原始密钥、秘密引用数据库或包含私密内容的完整配置。

## 故障排查

| 问题                                  | 处理方式                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| 配置改了但 IDE 仍用旧模型             | 先核对 IDE 的 CLI 路径，查看 `config explain`，重启旧聊天宿主并检查会话覆盖             |
| 编辑文件后桌面设置没变                | 比较 CLI 根目录与 Electron `userData` 中的实际文件，不假定共享同一份 JSON               |
| `CONFIG_SECRET_REQUIRES_SECURE_INPUT` | 改用 `cc config set-secret <key>`，不要将密钥作为第二个参数                             |
| `CONFIG_SECRET_STORE_UNAVAILABLE`     | 检查系统密钥服务；`--storage keychain` 不会静默转为文件保存                             |
| `CONFIG_HOME_UNSAFE`                  | 使用工作区外的绝对私有目录，检查 `CHAINLESSCHAIN_HOME` 和兼容目录变量                   |
| JSON 损坏 / 字段迁移                  | 先保留原始文件；`cc config edit` 可打开原始内容，修复后再校验；不以覆盖默认配置代替恢复 |
| 服务仍找不到 Compose 文件             | 使用 `docker compose -f <实际文件>`，或在含目标编排的目录运行 `cc services`             |
| Base URL 被拒绝                       | 只填 API 基路径，不嵌入用户名、密码、query、fragment 或具体 completion 请求路径         |

## 关键文件

| 源文件                                                                          | 作用                         |
| ------------------------------------------------------------------------------- | ---------------------------- |
| `packages/cli/src/lib/paths.js`                                                 | CLI 配置根目录和覆盖规则     |
| `packages/cli/src/constants.js`、`src/lib/config-schema.js`                     | 默认值、字段类型及迁移描述   |
| `packages/cli/src/commands/config.js`                                           | 配置命令、来源诊断及隐藏输入 |
| `packages/cli/src/lib/config-manager.js`、`secret-store.js`                     | 锁、原子写入和系统秘密存储   |
| `packages/cli/src/lib/llm-connection-config.js`、`llm-connection-resolution.js` | 连接原子保存与解析           |
| `desktop-app-vue/src/main/config/unified-config-manager.js`、`app-config.js`    | 两类桌面配置管理器           |
| `desktop-app-vue/src/main/llm/llm-config.js`                                    | 桌面独立模型配置             |

## 相关文档

- [系统概述](./overview) · [安装部署](./installation) · [CLI 配置命令](./cli-config)
- [IDE 模型配置](./ide-plugin) · [本轮升级指南](./cli-ide-update-2026-11-09-145)
- [自进化开关配置](./self-evolution-configuration) · [会话输入与恢复](./agent-input-and-recovery)
