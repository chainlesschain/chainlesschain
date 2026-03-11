# 自主技术学习引擎

> **Phase 62 | v3.0.0 | 5 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔍 **技术栈自动检测**: 识别 8+ 种清单文件（package.json/pom.xml/Cargo.toml 等），提取语言、框架和构建工具
- 📚 **最佳实践提取**: 从代码库、文档和社区三种来源提取可复用模式和编码约定
- 🧪 **置信度评估**: 自动对实践进行置信度评分，高置信度（>=0.85）自动提升
- 🛠️ **技能合成**: 将验证过的最佳实践自动转化为可执行的 Skill 技能
- 🌐 **多语言生态**: 覆盖 JS/TS、Java、Kotlin、Python、Rust、Go、Ruby、PHP 八大生态

## 系统架构

```
┌──────────────┐
│  Project     │
│  Codebase    │
└──────┬───────┘
       │ 扫描清单文件
       ▼
┌──────────────────────────────────┐
│       Tech Learning Engine       │
│  ┌────────────┐  ┌────────────┐ │
│  │ Stack      │  │ Practice   │ │
│  │ Detector   │  │ Extractor  │ │
│  │ (8种清单)  │  │ (3种来源)  │ │
│  └─────┬──────┘  └─────┬──────┘ │
│        │               │        │
│  ┌─────▼───────────────▼──────┐ │
│  │    Skill Synthesizer       │ │
│  │    (置信度 >= 0.85 → Skill)│ │
│  └────────────┬───────────────┘ │
└───────────────┼─────────────────┘
                │
       ┌────────▼────────┐
       │  SQLite (2表)   │
       │  tech_stack_    │
       │  profiles /     │
       │  learned_       │
       │  practices      │
       └─────────────────┘
```

## 概述

Phase 62 为 ChainlessChain 引入自主技术学习能力，AI 可自动检测项目技术栈、从最佳实践中提取模式，并将高置信度模式合成为新技能。

**核心目标**:

- **技术栈感知**: 自动检测语言/框架/构建工具
- **最佳实践提取**: 从项目代码和文档中提取可复用模式
- **技能合成**: 将验证过的实践自动转化为 Skill
- **多语言支持**: 覆盖 8+ 种主流技术生态

---

## 支持的技术生态

| 清单文件           | 语言/框架                          | 构建工具         |
| ------------------ | ---------------------------------- | ---------------- |
| `package.json`     | JavaScript/TypeScript, React/Vue   | npm/yarn/webpack |
| `pom.xml`          | Java, Spring Boot                  | Maven            |
| `build.gradle`     | Kotlin/Java, Android               | Gradle           |
| `requirements.txt` | Python, Django/Flask/FastAPI        | pip              |
| `Cargo.toml`       | Rust                               | Cargo            |
| `go.mod`           | Go                                 | Go Modules       |
| `Gemfile`          | Ruby, Rails                        | Bundler          |
| `composer.json`    | PHP, Laravel                       | Composer         |

---

## 核心功能

### 1. 技术栈检测

```javascript
const profile = await window.electronAPI.invoke('tech-learning:detect-stack', {
  projectPath: '/path/to/project'
});

console.log(profile);
// {
//   id: 'tsp-001',
//   projectPath: '/path/to/project',
//   manifestType: 'package.json',
//   languages: ['TypeScript', 'JavaScript'],
//   frameworks: ['Vue 3', 'Electron'],
//   buildTools: ['Vite', 'esbuild'],
//   status: 'COMPLETE'
// }
```

### 2. 最佳实践提取

```javascript
const practices = await window.electronAPI.invoke('tech-learning:extract-practices', {
  profileId: 'tsp-001',
  source: 'codebase'  // 'codebase' | 'documentation' | 'community'
});

// practices: [
//   {
//     id: 'lp-001',
//     title: 'Singleton + Factory 模式',
//     category: 'DESIGN_PATTERN',
//     confidence: 0.92,
//     status: 'PROMOTED',   // 置信度≥0.85 自动提升
//     pattern: 'class + _instance + getFactory()'
//   },
//   ...
// ]
```

### 3. 技能合成

```javascript
// 从已验证的实践合成新技能
const skill = await window.electronAPI.invoke('tech-learning:synthesize-skill', {
  practiceId: 'lp-001'
});
// { skillId: 'sk-auto-001', name: 'Singleton Factory', source: 'learned' }
```

### 4. 查询接口

```javascript
// 获取技术栈档案列表
const profiles = await window.electronAPI.invoke('tech-learning:get-profiles', {
  filter: { status: 'COMPLETE' }
});

// 获取已学习的实践
const allPractices = await window.electronAPI.invoke('tech-learning:get-practices', {
  filter: { profileId: 'tsp-001', status: 'PROMOTED' }
});
```

---

## 实践状态

| 状态          | 说明                                 |
| ------------- | ------------------------------------ |
| **EXTRACTED** | 已提取，待验证                       |
| **VERIFIED**  | 人工确认有效                         |
| **PROMOTED**  | 自动提升（置信度 ≥ 0.85）或人工提升 |

---

## IPC 通道

| 通道                              | 参数                       | 返回值       |
| --------------------------------- | -------------------------- | ------------ |
| `tech-learning:detect-stack`      | `{ projectPath }`          | 技术栈档案   |
| `tech-learning:get-profiles`      | `{ filter? }`              | 档案列表     |
| `tech-learning:extract-practices` | `{ profileId, source? }`   | 实践列表     |
| `tech-learning:get-practices`     | `{ filter? }`              | 实践列表     |
| `tech-learning:synthesize-skill`  | `{ practiceId }`           | 合成的技能   |

---

## 数据库表

### tech_stack_profiles

| 字段          | 类型    | 说明                        |
| ------------- | ------- | --------------------------- |
| id            | TEXT PK | 档案 ID                    |
| project_path  | TEXT    | 项目路径                    |
| languages     | JSON    | 检测到的语言列表            |
| frameworks    | JSON    | 检测到的框架列表            |
| build_tools   | JSON    | 检测到的构建工具            |
| manifest_type | TEXT    | 清单文件类型                |
| status        | TEXT    | DETECTED/ANALYZING/COMPLETE |
| details       | JSON    | 详细信息                    |
| created_at    | INTEGER | 创建时间                    |

### learned_practices

| 字段       | 类型    | 说明                             |
| ---------- | ------- | -------------------------------- |
| id         | TEXT PK | 实践 ID                         |
| profile_id | TEXT FK | 关联技术栈档案                   |
| title      | TEXT    | 实践标题                         |
| description| TEXT    | 详细描述                         |
| category   | TEXT    | 分类（设计模式/编码约定/...）    |
| confidence | REAL    | 置信度（0-1）                    |
| status     | TEXT    | EXTRACTED/VERIFIED/PROMOTED      |
| source     | TEXT    | 来源                             |
| pattern    | TEXT    | 模式描述                         |
| created_at | INTEGER | 创建时间                         |

---

## 相关链接

- [自主开发者](/chainlesschain/autonomous-developer)
- [协作治理](/chainlesschain/collaboration-governance)
- [Skills 系统](/chainlesschain/skills)
- [EvoMap GEP 协议](/chainlesschain/evomap)

## 关键文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `src/main/ai-engine/tech-learning-engine.js` | 自主技术学习核心引擎 | ~400 |
| `src/main/ai-engine/stack-detector.js` | 技术栈检测器（8 种清单） | ~300 |
| `src/main/ai-engine/practice-extractor.js` | 最佳实践提取器 | ~280 |
| `src/main/ai-engine/skill-synthesizer.js` | 技能合成器 | ~220 |
| `src/main/ipc/ipc-tech-learning.js` | IPC 处理器注册 | ~100 |

## 相关文档

- [自主开发者](/chainlesschain/autonomous-developer) - 自主开发 AI 代理
- [协作治理](/chainlesschain/collaboration-governance) - 协作治理框架
- [Skills 系统](/chainlesschain/skills) - 138 内置技能系统
- [EvoMap GEP 协议](/chainlesschain/evomap) - 进化图谱基因协议
