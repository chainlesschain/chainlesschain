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

## 配置参考

```javascript
// tech-learning 引擎配置
const techLearningConfig = {
  // 技术栈检测
  stackDetection: {
    // 目录扫描最大深度（层）
    maxDepth: 5,

    // 最大扫描文件数
    maxFiles: 500,

    // 支持的清单文件类型（按优先级排序）
    manifestPriority: [
      'package.json', 'pom.xml', 'build.gradle',
      'Cargo.toml', 'go.mod', 'requirements.txt',
      'Gemfile', 'composer.json'
    ]
  },

  // 最佳实践提取
  practiceExtraction: {
    // 置信度自动提升阈值（>= 此值自动升为 PROMOTED）
    autoPromoteThreshold: 0.85,

    // 单次提取最大实践数
    maxPracticesPerRun: 50,

    // 实践来源权重（影响置信度计算）
    sourceWeights: {
      codebase: 1.0,
      documentation: 0.85,
      community: 0.7
    }
  },

  // 技能合成
  skillSynthesis: {
    // 仅允许 PROMOTED 状态的实践合成技能
    requirePromotedStatus: true,

    // 合成技能的来源标注
    skillSourceLabel: 'learned'
  }
};
```

---

## 性能指标

| 操作                             | 目标        | 实际        | 状态 |
| -------------------------------- | ----------- | ----------- | ---- |
| 技术栈检测（500 文件项目）       | < 3s        | ~1.2s       | ✅   |
| 最佳实践提取（codebase 来源）    | < 5s        | ~2.8s       | ✅   |
| 置信度评分计算                   | < 100ms/条  | ~35ms       | ✅   |
| 技能合成写入                     | < 200ms     | ~90ms       | ✅   |
| 档案列表查询                     | < 100ms     | ~28ms       | ✅   |
| 多语言冲突检测                   | < 500ms     | ~180ms      | ✅   |

---

## 测试覆盖

✅ `tech-learning-engine.test.js` — 引擎初始化、端到端检测流程、多语言项目处理（20 个用例）

✅ `stack-detector.test.js` — 8 种清单文件解析、语言/框架/构建工具提取、扫描深度限制（24 个用例）

✅ `practice-extractor.test.js` — 三种来源提取（codebase/documentation/community）、置信度计算、自动提升逻辑（18 个用例）

✅ `skill-synthesizer.test.js` — PROMOTED 状态门控、技能结构生成、`learned` 来源标注（12 个用例）

✅ `tech-learning-ipc.test.js` — 5 个 IPC 通道参数验证与返回值格式（15 个用例）

✅ `tech-learning-db.test.js` — `tech_stack_profiles` 和 `learned_practices` 表 CRUD、关联查询（10 个用例）

> **总测试数**: 99 个用例，覆盖率 > 91%

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

## 使用示例

### 检测项目技术栈

1. 打开「技术学习」页面，输入项目路径
2. 点击「检测技术栈」，系统自动扫描清单文件
3. 查看检测结果：语言、框架、构建工具
4. 技术栈档案自动保存到数据库供后续使用

### 提取最佳实践

1. 选择已有的技术栈档案
2. 选择提取来源：codebase（代码库）/ documentation（文档）/ community（社区）
3. 系统自动分析并提取可复用的编码模式
4. 查看每条实践的置信度评分，高于 0.85 自动提升为 PROMOTED

### 合成新技能

1. 在已提取的实践列表中，选择 PROMOTED 状态的实践
2. 点击「合成技能」，系统将实践转化为可执行的 Skill
3. 新技能自动注册到技能系统，可在 `skill list` 中查看
4. 合成的技能标注来源为 `learned`，与内置技能区分

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 技术栈检测失败 | 项目路径无效或无清单文件 | 确认路径存在且包含 package.json 等清单文件 |
| 检测到的语言不准确 | 清单文件内容不完整 | 补充 dependencies/devDependencies 信息 |
| 实践提取为空 | 项目代码量过少或模式不明显 | 使用更大的项目或切换到 documentation 来源 |
| 置信度评分过低 | 提取的模式出现频率低 | 累计更多代码样本后重新提取 |
| 技能合成失败 | 实践状态非 PROMOTED | 确认实践置信度 >= 0.85 或手动提升状态 |
| 多语言检测冲突 | 项目包含多种清单文件 | 系统按优先级选择，可手动指定主清单文件 |

## 安全考虑

- **本地分析**: 所有技术栈检测和实践提取在本地完成，代码不上传到外部服务
- **路径访问控制**: 技术栈检测仅扫描指定目录下的清单文件，不访问敏感文件
- **置信度门控**: 仅高置信度（>= 0.85）实践可合成技能，防止低质量模式传播
- **技能来源标注**: 合成技能明确标注 `learned` 来源，与官方内置技能区分
- **数据持久化加密**: 技术栈档案和实践数据存储在加密数据库中
- **扫描深度限制**: 目录扫描最大深度 5 层、最多 500 文件，防止资源耗尽
- **模式审核**: 合成的技能在首次使用前可由用户确认，防止不当模式生效

## 相关文档

- [自主开发者](/chainlesschain/autonomous-developer) - 自主开发 AI 代理
- [协作治理](/chainlesschain/collaboration-governance) - 协作治理框架
- [Skills 系统](/chainlesschain/skills) - 138 内置技能系统
- [EvoMap GEP 协议](/chainlesschain/evomap) - 进化图谱基因协议
