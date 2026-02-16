---
name: release-manager
display-name: Release Manager
description: 发布管理技能 - 语义版本计算、Changelog生成、Tag创建、Release Notes
version: 1.0.0
category: devops
user-invocable: true
tags: [release, version, changelog, tag, semver, github-release]
capabilities:
  [
    version-calculation,
    changelog-generation,
    tag-creation,
    release-notes,
    multi-platform,
  ]
tools:
  - file_reader
  - file_writer
  - command_executor
instructions: |
  Use this skill to manage the release lifecycle. Calculate semantic version bumps
  from commit analysis, generate CHANGELOG.md entries from conventional commits,
  create git tags, and generate GitHub Release notes. Coordinate version updates
  across multiple package files (package.json, build.gradle.kts, Info.plist).
examples:
  - input: "/release-manager --bump minor"
    output: "Version: 0.36.0 → 0.37.0. Updated 4 files. Generated changelog with 23 feat, 15 fix entries."
  - input: "/release-manager --changelog v0.35.0..HEAD"
    output: "Changelog for v0.36.0: 12 features, 8 fixes, 3 refactors from 45 commits."
  - input: "/release-manager --dry-run"
    output: "Dry run: Would bump to 0.37.0 (minor). 45 commits since v0.36.0. No files modified."
os: [win32, darwin, linux]
author: ChainlessChain
---

# 发布管理技能

## 描述

管理完整的发布周期：从提交历史计算语义版本、生成 Changelog、创建 Git Tag、生成 Release Notes、协调多文件版本更新。

## 使用方法

```
/release-manager [操作] [选项]
```

## 操作

### 版本升级

```
/release-manager --bump <type>
```

- `major` - 主版本 (破坏性变更)
- `minor` - 次版本 (新功能)
- `patch` - 补丁版本 (修复)
- `auto` - 从提交历史自动判断

更新的文件:
- `package.json` (根目录)
- `desktop-app-vue/package.json`
- `android-app/app/build.gradle.kts` (versionCode + versionName)
- `ios-app/ChainlessChain/Resources/Info.plist`

### Changelog 生成

```
/release-manager --changelog [range]
```

从 Conventional Commits 生成分类条目:
- **Features** (feat:)
- **Bug Fixes** (fix:)
- **Performance** (perf:)
- **Refactoring** (refactor:)
- **Documentation** (docs:)
- **Breaking Changes** (BREAKING CHANGE:)

### 创建 Tag

```
/release-manager --tag
```

创建带注释的 Git Tag:
- Tag 名: `v0.37.0`
- 注释: 版本亮点摘要

### Release Notes

```
/release-manager --release-notes
```

生成 GitHub Release Notes:
- 版本亮点（从 feat 提交提取）
- 完整变更列表
- 贡献者列表
- 升级指南（如有 Breaking Changes）

### Dry Run

```
/release-manager --dry-run
```

预览所有变更但不实际修改文件。

## 版本计算规则

| 提交类型 | 版本影响 |
| -------- | -------- |
| feat: | minor |
| fix: | patch |
| perf: | patch |
| BREAKING CHANGE: | major |
| docs:/style:/test:/chore: | 无 |

## 输出格式

```
Release Manager
===============
Current: v0.36.0
Commits since: 45
Recommended: minor → v0.37.0

Changes:
  feat: 12 features
  fix: 8 bug fixes
  perf: 3 improvements
  refactor: 5 refactors

Files to update:
  ✏️ package.json (0.36.0 → 0.37.0)
  ✏️ desktop-app-vue/package.json
  ✏️ android-app/app/build.gradle.kts (36 → 37)
  ✏️ ios-app/.../Info.plist (36 → 37)

Changelog preview:
  ## [0.37.0] - 2026-02-16
  ### Features
  - feat(skills): add 15 new built-in skills
  ...
```

## 示例

自动版本升级:

```
/release-manager --bump auto
```

生成 Changelog:

```
/release-manager --changelog v0.35.0..HEAD
```

预览:

```
/release-manager --dry-run
```
