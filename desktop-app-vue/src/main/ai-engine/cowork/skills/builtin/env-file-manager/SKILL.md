---
name: env-file-manager
display-name: Env File Manager
description: 环境变量文件管理（.env解析、比较、验证、模板生成、缺失检测、安全检查）
version: 1.0.0
category: development
user-invocable: true
tags: [env, environment, dotenv, config, variable, secret, security]
capabilities: [env_parse, env_compare, env_validate, env_template, env_check]
tools:
  - env_parse
  - env_compare
  - env_validate
  - env_template
instructions: |
  Use this skill to manage .env environment variable files. Parse and display variables,
  compare environments (dev vs prod), detect missing variables, validate values,
  generate .env.example templates, and check for accidentally committed secrets.
examples:
  - input: "/env-file-manager --parse .env"
    output: "12 variables: DB_HOST, DB_PORT, API_KEY (masked), ..."
  - input: "/env-file-manager --compare .env .env.production"
    output: "3 differences: API_URL changed, NEW_VAR added, OLD_VAR removed"
  - input: "/env-file-manager --template .env --output .env.example"
    output: "Generated .env.example with 12 variables (values masked)"
  - input: "/env-file-manager --check .env"
    output: "⚠ 2 security issues: API_KEY looks like a real secret, DB_PASSWORD exposed"
  - input: "/env-file-manager --missing .env .env.example"
    output: "3 missing variables: REDIS_URL, SMTP_HOST, LOG_LEVEL"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
supported-file-types:
  [.env, .env.local, .env.development, .env.production, .env.example]
---

# Env File Manager

环境变量文件管理技能。

## 功能

| 操作     | 命令                                      | 说明                |
| -------- | ----------------------------------------- | ------------------- |
| 解析     | `--parse <file>`                          | 解析并显示环境变量  |
| 比较     | `--compare <file1> <file2>`               | 比较两个env文件差异 |
| 缺失检测 | `--missing <file> <template>`             | 检测缺失变量        |
| 模板生成 | `--template <file> --output <file>`       | 生成.env.example    |
| 安全检查 | `--check <file>`                          | 检查敏感信息泄露    |
| 验证     | `--validate <file>`                       | 验证变量格式和值    |
| 合并     | `--merge <file1> <file2> --output <file>` | 合并环境变量        |
