# 代理模式 (agent)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

启动 Claude Code 风格的代理式 AI 会话。AI 可读写文件、执行命令、搜索代码库、调用 138 个内置技能。

## 命令参考

```bash
chainlesschain agent                    # 默认: Ollama qwen2:7b
chainlesschain a --model llama3         # 短别名
chainlesschain agent --provider openai --api-key sk-...
```

> `agent` 命令的短别名为 `a`，两者完全等价。

## 内置工具

代理模式提供 8 个内置工具：

| 工具           | 说明                 |
| -------------- | -------------------- |
| `read_file`    | 读取文件内容         |
| `write_file`   | 写入文件             |
| `edit_file`    | 编辑文件（查找替换） |
| `run_shell`    | 执行 Shell 命令      |
| `search_files` | 搜索文件内容         |
| `list_dir`     | 列出目录内容         |
| `run_skill`    | 运行内置技能         |
| `list_skills`  | 列出可用技能         |

## 使用示例

```
> 帮我重构 src/utils/helper.js，提取公共方法

🤖 我来分析这个文件...
[调用 read_file: src/utils/helper.js]
[调用 edit_file: 提取公共方法到 src/utils/common.js]
[调用 run_skill: code-review 检查重构质量]

已完成重构，提取了 3 个公共方法到 common.js。
```
