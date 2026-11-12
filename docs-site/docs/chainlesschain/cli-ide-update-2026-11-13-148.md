# CLI 0.166.148 / IDE 0.37.187 + 0.4.202

## 概述

Release source: `146b3fbd438eece981aa14327d9481156683acd4`. CLI OIDC publication and VS Code public readback are complete; JetBrains upload is awaiting Marketplace listing review.

## 核心特性

- CLI: `chainlesschain@0.166.148`, CLI CI 76/76 and Strict Sandbox verified.
- VS Code: Open VSX `0.37.187`, paired with CLI `0.166.148`.
- JetBrains: `0.4.202`, host/build/publish workflow succeeded.

## 系统架构

The CLI owns the self-evolution capability projection. IDEs render the projection and do not receive production authority or governance credentials.

## 配置参考

Use the CLI deployment status command to inspect capability state, production authority, runtime evidence and automatic-promotion policy.

## 性能指标

This release adds a bounded status projection only; it does not claim runtime producer/storage throughput or experiment results.

## 测试覆盖

CLI CI passed 76/76, Strict Sandbox passed on all configured systems, and both IDE host matrices passed before publication.

## 安全考虑

Automatic promotion remains **HOLD**. Production authority and runtime evidence remain disabled.

## 故障排查

After upgrading, restart the CLI/IDE host and run `cc --version` and `cc doctor`. If JetBrains is not listed yet, wait for Marketplace review to finish.

## 关键文件

- `packages/cli/src/lib/evolution/evolution-deployment-config.js`
- `packages/vscode-extension/src/evolution-deployment-config.js`
- `packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/EvolutionDeploymentConfig.java`

## 使用示例

```bash
npm i -g chainlesschain@0.166.148 --registry https://registry.npmjs.org
cc --version
cc doctor
```

## 相关文档

- [Governed skill evolution](governed-skill-evolution.md)
- [Agent platform release boundaries](agent-platform-release.md)
