# LLM 管理 (llm)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 命令参考

```bash
chainlesschain llm models               # 列出已安装的Ollama模型
chainlesschain llm models --json        # JSON格式输出
chainlesschain llm test                 # 测试Ollama连通性
chainlesschain llm test --provider openai --api-key sk-...
```

## 子命令说明

### models

列出本地 Ollama 已安装的模型信息。

```bash
chainlesschain llm models
chainlesschain llm models --json
```

### test

测试 LLM 提供商连通性，发送一条简单消息验证 API 是否可用。

```bash
chainlesschain llm test                                    # 测试默认提供商 (Ollama)
chainlesschain llm test --provider openai --api-key sk-... # 测试 OpenAI
chainlesschain llm test --provider deepseek --api-key sk-...
```

## 支持的 LLM 提供商

| 提供商           | 默认模型      | 需要 API Key |
| ---------------- | ------------- | ------------ |
| Ollama (本地)    | qwen2:7b      | 否           |
| OpenAI           | gpt-4o        | 是           |
| DashScope (阿里) | qwen-max      | 是           |
| DeepSeek         | deepseek-chat | 是           |
| 自定义           | —             | 是           |
