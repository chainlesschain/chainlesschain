# AI 对话 (chat/ask)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## chat — 交互式对话

启动交互式 AI 对话，支持流式输出。

```bash
chainlesschain chat                     # 默认: Ollama qwen2:7b
chainlesschain chat --model llama3      # 使用其他模型
chainlesschain chat --provider openai --api-key sk-...
chainlesschain chat --agent             # 代理模式（可读写文件、执行命令）
```

### 对话内斜杠命令

| 命令        | 说明         |
| ----------- | ------------ |
| `/exit`     | 退出对话     |
| `/model`    | 切换模型     |
| `/provider` | 切换提供商   |
| `/clear`    | 清空对话历史 |
| `/history`  | 查看对话历史 |
| `/help`     | 显示帮助     |

## ask — 单次问答

非交互式单次 AI 问答，适用于脚本和 CI/CD 流水线。

```bash
chainlesschain ask "什么是WebRTC?"
chainlesschain ask "解释这段代码" --model gpt-4o --provider openai
chainlesschain ask "Hello" --json       # JSON输出（含问题/回答/模型信息）
```
