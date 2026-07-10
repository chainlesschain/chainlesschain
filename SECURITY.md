# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's **Private Vulnerability Reporting**:

1. Go to the [Security tab](https://github.com/chainlesschain/chainlesschain/security) of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details (affected component, reproduction steps, impact, and a proof of concept if available)

This opens a private advisory visible only to you and the maintainers. We will:

- Acknowledge receipt within a few days
- Investigate and confirm the issue
- Work with you on a fix and coordinated disclosure timeline
- Credit you in the advisory (and request a CVE where applicable) once the issue is confirmed and fixed

## Scope

This policy covers all components in this monorepo, including:

- Desktop app (`desktop-app-vue/`)
- CLI (`packages/cli/`, npm `@chainlesschain/*` packages)
- IDE extensions (`packages/vscode-extension/`, `packages/jetbrains-plugin/`)
- Android / iOS apps
- Backend services (`backend/`)

## 安全问题报告（中文）

请**不要**通过公开 issue 报告安全漏洞。请使用本仓库 [Security 标签页](https://github.com/chainlesschain/chainlesschain/security)的 **"Report a vulnerability"** 提交私密报告。确认并修复后，我们会在 advisory 中致谢报告者。
