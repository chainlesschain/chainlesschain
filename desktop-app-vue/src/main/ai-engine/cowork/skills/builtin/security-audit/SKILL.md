---
name: security-audit
display-name: Security Audit
description: 代码安全审计技能 - 执行OWASP Top 10扫描、密钥检测、依赖审计
version: 1.0.0
category: security
user-invocable: true
tags:
  [security, audit, owasp, vulnerability, secret-detection, dependency-audit]
capabilities: [owasp-scan, secret-detection, dependency-audit, security-report]
tools:
  - code_analyzer
  - secret_scanner
  - file_reader
instructions: |
  Use this skill when the user asks for security review, vulnerability scanning,
  or code audit. Scan for OWASP Top 10 vulnerabilities, hardcoded secrets,
  and known dependency vulnerabilities. Output a risk-rated report.
examples:
  - input: "/security-audit src/main/"
    output: "Security audit report with findings rated Critical/High/Medium/Low"
  - input: "/security-audit src/main/auth/"
    output: "Focused audit on authentication code for injection, broken auth, etc."
os: [win32, darwin, linux]
author: ChainlessChain
---

# 安全审计技能

## 描述

执行全面的代码安全审计，包括OWASP Top 10漏洞扫描、硬编码密钥检测、npm依赖审计。

## 使用方法

```
/security-audit [目标路径]
```

## 执行步骤

1. **扫描硬编码密钥**: 检查源代码中的API密钥、密码、Token等敏感信息
2. **OWASP Top 10检查**: 检查SQL注入、XSS、CSRF等常见漏洞
3. **依赖审计**: 运行npm audit检查已知漏洞的依赖
4. **输出报告**: 生成安全审计报告，包含发现的问题和修复建议

## 输出格式

- 风险等级: Critical / High / Medium / Low
- 发现详情: 文件路径、行号、问题描述
- 修复建议: 具体的修复方案
