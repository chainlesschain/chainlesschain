# Releasing the IDE-bridge editor extensions

Maintenance + publish runbook for the two editor extensions that pair with the
CLI IDE bridge (design `docs/design/modules/98_IDE桥接对标方案.md`, Phase 4):

- **VS Code** — `packages/vscode-extension/` → Open VSX (`ovsx`) and the
  official VS Code Marketplace (`vsce`); both are required release channels
- **JetBrains** — `packages/jetbrains-plugin/` → JetBrains Marketplace (`gradlew publishPlugin`)

CI: `.github/workflows/ide-extensions.yml`. A normal push to `main` that touches
either package **builds + uploads the artifact** (`.vsix` / plugin `.zip`).
Publishing happens **only** on a dedicated tag. Missing credentials for any
required release channel fail the tagged release.

## Version governance

Both extensions are versioned independently of the CLI/product line (they ship
to different marketplaces). Keep all three in sync per extension when bumping:

| Extension | Version source                                                                    | CHANGELOG                                |
| --------- | --------------------------------------------------------------------------------- | ---------------------------------------- |
| VS Code   | `packages/vscode-extension/package.json` `version`                                | `packages/vscode-extension/CHANGELOG.md` |
| JetBrains | `packages/jetbrains-plugin/build.gradle.kts` `version` + `plugin.xml` `<version>` | `packages/jetbrains-plugin/CHANGELOG.md` |

Bump → update CHANGELOG → commit → tag.

### Authoritative release path

Local marketplace publishing and tag-triggered CI publishing are **alternative
release paths**, not consecutive steps. Repository releases use the dedicated
GitHub tag workflow as the authoritative path:

- Do not publish a version locally and then push its release tag. The tag
  workflow would attempt to publish the same immutable marketplace version
  again and its evidence would no longer identify the original upload.
- For a normal release, validate and commit the version bump, wait for the
  commit's IDE CI gates, then push exactly one matching release tag to GitHub.
- A local publish is break-glass only. If it is explicitly chosen, do not later
  run tag CI for that same version; record the local evidence and bump to a new
  version before returning to the authoritative tag workflow.
- Never move, delete, or recreate a release tag to repair a failed run. Rerun
  the workflow against the same immutable tag after correcting an
  infrastructure/credential issue.

## Publishing

### VS Code — Open VSX

We publish to the **Open VSX Registry** (open-vsx.org), which serves Cursor /
VSCodium / Gitpod / etc. Open VSX needs a GitHub login and token. The official
VS Code Marketplace remains externally blocked until `VSCE_PAT` is provisioned,
and the tag workflow now treats that blocker as a failed release instead of
silently declaring the Open VSX-only half complete.

- **Namespace**: `chainlesschain` (= the extension's `publisher`).
- **Token**: sign in at open-vsx.org with GitHub → **sign the Eclipse Foundation
  Open VSX Publisher Agreement** on the PROFILE page (required; otherwise token
  creation is blocked) → /user-settings/tokens → generate `ovsxat_…`.
  - Local: stored as the Windows User env var **`OVSX_PAT`** (so `ovsx publish`
    auto-authenticates).
  - CI: repo secret **`OVSX_PAT`**.

Release:

1. Bump `version` in `package.json` + CHANGELOG, commit.
2. Run `npm run test:unit`, package/metadata checks, and the Extension Host
   smoke gates. Wait for the exact commit's `IDE Extensions` workflow to pass.
3. Confirm `ide-vscode-vX.Y.Z` is unused and `X.Y.Z` exactly equals
   `packages/vscode-extension/package.json` `version`.
4. Create the immutable tag on the validated commit and push it to GitHub:
   `git tag ide-vscode-v0.2.2 && git push github ide-vscode-v0.2.2`.
5. `ide-extensions.yml` rechecks tag/version equality and publishes the same
   VSIX to Open VSX and the official Marketplace. Missing `OVSX_PAT` or
   `VSCE_PAT` fails the release.
6. Verify both JSON results in the job summary. Each verifier downloads the
   public VSIX and compares its canonical content digest with the tagged-run
   artifact; the official query also verifies publisher, name, exact version,
   stable (not pre-release) status, and an HTTPS package asset.

The Open VSX publish uses `--skip-duplicate`, so rerunning the same immutable
tag after an interrupted run does not fail merely because that exact version
already reached the registry. Authentication, network, package-validation, and
other publish failures still fail the job. Post-publish verification waits for
registry listing/download metadata for roughly ten minutes before failing,
which avoids treating normal indexing delay as a release failure. It also
downloads the registry VSIX, validates its published raw SHA-256, and compares a
canonical digest of every ZIP entry name and uncompressed byte with the VSIX
built by the tagged run. ZIP timestamps/compression may differ across a rerun,
but an unrelated pre-existing copy of the same version cannot satisfy the gate.

Break-glass local alternative (not followed by tag CI):
`cd packages/vscode-extension && npm run publish:ovsx`. Namespace creation is a
one-time registry administration action, not something a release workflow
should retry while ignoring errors.

### VS Code — official Marketplace (required, externally blocked)

Needs a `VSCE_PAT` from an Azure DevOps org. Publisher `chainlesschain` exists,
but creating the DevOps org requires an Azure subscription → not done. Before
the next VS Code release tag: create the org → PAT (`All accessible
organizations`, scope `Marketplace: Manage`) → secret `VSCE_PAT`. Until then
the tag gate is expected to fail closed; Open VSX publication is not evidence
of stock VS Code listing.

### JetBrains

1. Configure the required Marketplace **permanent token** as
   `JETBRAINS_PUBLISH_TOKEN`. Author signing is recommended; to enable it, set
   all three signing values
   `JETBRAINS_CERTIFICATE_CHAIN` / `JETBRAINS_PRIVATE_KEY` /
   `JETBRAINS_PRIVATE_KEY_PASSWORD` (see the IntelliJ Platform plugin-signing
   docs). With none of the three, Gradle skips `signPlugin` and CI emits a
   warning; a partial signing configuration fails closed.
2. Bump `version` in `build.gradle.kts` + `plugin.xml`, update CHANGELOG, commit.
3. Wait for exact-commit CI to pass `smokeTest`, JUnit, `buildPlugin`,
   `verifyPluginStructure`, `verifyPluginProjectConfiguration`, `verifyPlugin`,
   and the Remote Robot GUI smoke.
4. Confirm the two version sources equal `X.Y.Z` and
   `ide-jetbrains-vX.Y.Z` is unused, then tag the validated commit:
   `git tag ide-jetbrains-v0.1.0 && git push github ide-jetbrains-v0.1.0`.
5. Tag CI rechecks the tag, Gradle version, and `plugin.xml` version before
   `publishPlugin`.

JetBrains may accept the upload while holding the version for manual review.
After a successful `publishPlugin`, a reachable Marketplace response that says
the version is not yet approved/listed is reported as `pending` in the job
summary and as a workflow warning, without turning the accepted upload red.
A version absent from the public API is also pending because uploads are not
public during review. A record explicitly returned as hidden, malformed
responses, HTTP/network failures, and `publishPlugin` failures still fail.
Review the pending Marketplace submission separately; a green-with-warning run
is not evidence that public listing has completed.

The post-publish Marketplace readback is a separate dependent job. If that
readback alone fails because the public API is unavailable, rerun only failed
jobs; the already successful immutable upload job is not repeated.

The break-glass local alternative is `./gradlew publishPlugin` with the required
credentials. As above, do not follow a local upload with tag CI for the same
version.

## Pre-release verification (no marketplace credentials needed)

- **VS Code unit + package gates**:
  `npm run test:unit`, `node scripts/sync-elicitation-schema.mjs --check`,
  `vsce package --no-dependencies`, then
  `verify-vsix.selftest.mjs` and `verify-vsix.mjs`.
- **VS Code runtime gates**: install the packaged VSIX into fresh stable and
  minimum-supported (`1.85.2`) Extension Hosts with
  `test/extension-host/run.cjs`. Windows and Linux/Xvfb run the complete real
  Webview DOM control/restart journey through a random loopback-only Chromium
  CDP port. Signed macOS VS Code builds reject the hosted runner's external
  CDP and inspector handshakes, so macOS drives the same installed VSIX Webview
  through VS Code's own Extension Host/Webview message boundary. The hidden
  relay exists only when the launcher injects a fresh 256-bit token, validates
  that token on both sides, and exposes fixed semantic DOM actions rather than
  arbitrary JavaScript evaluation. A random loopback-only Electron inspector
  endpoint is still enabled as a VS Code test-runner bootstrap workaround, but
  the macOS journey never connects to it and does not install a WebSocket client.
  macOS remains release-authoritative only when both stable and minimum
  journeys pass.
  `--host-api-only` is a
  diagnostic fallback that verifies activation, registered commands, the live
  bridge, and the production Activity View/focus command, but it does not prove
  DOM behavior and cannot authorize a release. Windows is also mandatory
  because the bridge lockfile's owner-only DACL is platform-specific.
- **JetBrains headless gates**:
  `./gradlew smokeTest test buildPlugin verifyPluginStructure
verifyPluginProjectConfiguration verifyPlugin --no-daemon --stacktrace`.
- **JetBrains runtime gate**: CI starts the built plugin in a real sandbox IDE
  under Linux/Xvfb and runs `uiSmokeTest` through Remote Robot. The release is
  not tagged until this exact-commit workflow passes.

## Notes / gotchas

- The workflow never creates a GitHub Release (avoids the immutable-release /
  tag-burn traps in `hidden-risk-traps.md`); it only uploads run artifacts +
  pushes to the marketplaces.
- No `continue-on-error` on build/publish steps — a failed package or publish
  fails the job loudly.
- Publish steps fail fast with a clear error if the required secret is missing,
  so a tag pushed without secrets configured does not silently "succeed".
- A release tag whose suffix differs from its package version fails before
  publishing. JetBrains CI also fails if Gradle and `plugin.xml` drift.
- Open VSX duplicate tolerance is scoped to its CLI's exact-version
  `--skip-duplicate` behavior; the workflow does not blanket-ignore publish
  exit codes.
- Marketplace CLIs are pinned in the workflow so rerunning an immutable tag
  uses the same packaging and upload implementation.
- JetBrains `pending` is accepted only after a successful upload and a
  successfully parsed Marketplace response. Registry/network errors are not
  converted into pending.
- `gradle-wrapper.jar` (8.7) is vendored (same as `android-app/`); CI uses the
  wrapper, not a system Gradle.

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部。本文：Releasing the IDE-bridge editor extensions。

### 2. 核心特性

见正文要点 / 特性 / 范围章节。

### 3. 系统架构

见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位

见正文定位 / 背景章节。

### 5. 核心功能

见正文功能 / 内容章节。

### 6. 技术架构

见正文技术 / 实现章节。

### 7. 系统特点

见正文（状态 / 版本 / 特性）。

### 8. 应用场景

见正文应用场景 / 背景。

### 9. 竞品对比

见正文对比 / 借鉴（如有）。

### 10. 配置参考

见正文配置 / 参数 / 环境章节。

### 11. 性能指标

见正文性能 / 指标章节（如有）。

### 12. 测试覆盖

见正文测试 / 验证章节（如有）。

### 13. 安全考虑

见正文安全 / 权限章节（如适用）。

### 14. 故障排除

见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件

见正文实现位置 / 关键文件章节。

### 16. 使用示例

见正文命令 / 操作 / API 示例。

### 17. 相关文档

见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
