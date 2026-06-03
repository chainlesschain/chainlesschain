# 自然语言编程

> v1.1.0 新功能

## 概述

自然语言编程系统允许用户使用自然语言描述需求，系统自动将其翻译为结构化 Spec（包含意图、实体和验收条件），并结合项目代码风格和框架约定生成符合团队规范的高质量代码。支持用户反馈驱动的迭代优化和完整的翻译历史追溯。

## 核心特性

- 🗣️ **自然语言转 Spec**: 自然语言描述自动翻译为结构化 Spec（意图、实体、验收条件）
- 🔄 **迭代优化**: 用户反馈驱动的 Spec 迭代精化，渐进式提升完整度
- 📐 **项目约定感知**: 自动分析项目代码风格、框架、命名规范，生成代码符合团队标准
- 💻 **高质量代码生成**: 基于 Spec + 约定生成可直接使用的代码，支持多语言多框架
- 📜 **完整历史追溯**: 翻译和生成历史记录完整保存，支持回溯对比

## 系统架构

```
┌──────────────────────────────────────────────┐
│            用户输入 (自然语言描述)             │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│           Spec Translator (意图翻译器)        │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ 意图提取  │  │ 实体识别  │  │ 验收条件   │ │
│  └──────────┘  └──────────┘  └────────────┘ │
└──────────────────────┬───────────────────────┘
                       │ 结构化 Spec
                       ▼
┌──────────────────────────────────────────────┐
│           Project Style Analyzer              │
│  ┌────────────────┐  ┌────────────────────┐  │
│  │ 框架/风格检测   │  │ 命名规范提取       │  │
│  └────────────────┘  └────────────────────┘  │
└──────────────────────┬───────────────────────┘
                       │ Spec + 约定
                       ▼
┌──────────────────────────────────────────────┐
│            Code Generator (代码生成器)        │
│       Spec + Conventions → Source Code        │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/cowork/spec-translator.js` | 自然语言到结构化 Spec 的翻译引擎 |
| `src/main/ai-engine/cowork/project-style-analyzer.js` | 项目代码风格与约定分析 |
| `src/main/ai-engine/cowork/code-generator.js` | 基于 Spec 的代码生成器 |
| `src/renderer/stores/nlProgramming.ts` | Pinia 状态管理 |
| `src/renderer/pages/NLProgramming.vue` | 自然语言编程前端页面 |

## 系统概述

自然语言编程系统（NL Programming）允许用户使用自然语言描述需求，系统自动将其翻译为结构化 Spec，并基于项目约定生成符合规范的代码。

### 核心能力

- **意图翻译**：自然语言 → 结构化 Spec（意图、实体、验收条件）
- **迭代优化**：用户反馈驱动的 Spec 迭代精化
- **项目约定**：自动分析项目代码风格、框架、命名规范
- **代码生成**：基于 Spec + 约定生成高质量代码
- **历史追溯**：完整的翻译和生成历史记录

## IPC 通道

| 通道                      | 说明                |
| ------------------------- | ------------------- |
| `nl-prog:translate`       | 翻译自然语言为 Spec |
| `nl-prog:validate`        | 验证 Spec 完整性    |
| `nl-prog:refine`          | 根据反馈优化 Spec   |
| `nl-prog:get-history`     | 获取翻译历史        |
| `nl-prog:generate`        | 基于 Spec 生成代码  |
| `nl-prog:get-conventions` | 获取项目约定        |
| `nl-prog:analyze-project` | 分析项目结构和约定  |
| `nl-prog:get-stats`       | 获取统计数据        |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "nlProgramming": {
    "enabled": true,
    "model": "default",
    "maxSpecEntities": 20,
    "autoValidate": true,
    "conventionSources": ["package.json", ".eslintrc", "tsconfig.json"]
  }
}
```

## 使用示例

### 基本流程

1. 在「自然语言编程」页面输入需求描述
2. 点击「翻译为 Spec」，系统提取意图、实体、验收条件
3. 查看完整度进度条，如不足可补充反馈优化
4. 确认 Spec 后点击「生成代码」
5. 在代码预览区查看生成结果，点击「应用到工作区」

### 示例输入

```
创建一个用户登录表单组件，使用 Vue3 + Ant Design，
包含用户名和密码字段，支持记住密码，
表单验证要求用户名不为空、密码至少8位
```

### Spec 输出示例

```json
{
  "intent": "create-component",
  "entities": [
    { "name": "LoginForm", "type": "component", "description": "用户登录表单" },
    { "name": "username", "type": "field", "description": "用户名输入" },
    { "name": "password", "type": "field", "description": "密码输入" }
  ],
  "acceptanceCriteria": [
    "表单包含用户名和密码字段",
    "支持记住密码复选框",
    "用户名不为空验证",
    "密码至少8位验证"
  ],
  "completeness": 85
}
```

## 故障排除

| 问题                   | 解决方案                           |
| ---------------------- | ---------------------------------- |
| Spec 完整度低          | 补充更多细节描述，使用反馈优化功能 |
| 生成代码不符合项目风格 | 先运行「分析当前项目」更新约定     |
| 翻译超时               | 检查 LLM 服务连接状态              |

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| Spec 完整度低于 50% | 自然语言描述过于简略 | 补充具体细节（字段名、验证规则、交互行为），使用反馈优化功能迭代 |
| 生成代码不符合项目风格 | 项目约定未分析或已过期 | 先运行 `nl-prog:analyze-project` 更新约定，确认检测到正确的框架和规范 |
| 翻译请求超时 | LLM 服务未启动或连接异常 | 检查 Ollama/LLM Provider 连接状态，确认 `OLLAMA_HOST` 配置正确 |
| 实体识别不准确 | 描述中存在歧义表达 | 使用明确的技术术语（如"Vue3 组件"而非"页面模块"），避免模糊用词 |
| 验收条件缺失 | 描述中未包含具体要求 | 在描述中明确列出验证规则、边界条件和预期行为 |
| 代码生成后编译报错 | 约定与实际项目版本不匹配 | 检查 `conventionSources` 配置是否包含 `package.json` 和 `tsconfig.json` |
| 历史记录查询为空 | 未执行过翻译操作 | 先通过 `nl-prog:translate` 完成至少一次翻译，历史记录会自动保存 |

---

## 配置参考

### 完整配置项

在 `.chainlesschain/config.json` 中配置：

```json
{
  "nlProgramming": {
    "enabled": true,
    "model": "default",
    "maxSpecEntities": 20,
    "autoValidate": true,
    "conventionSources": ["package.json", ".eslintrc", "tsconfig.json"],
    "maxInputLength": 2000,
    "completenessThreshold": 70,
    "historyMaxEntries": 200,
    "iterationMaxRounds": 5,
    "codeGenerator": {
      "temperature": 0.2,
      "maxTokens": 4096,
      "includeComments": true,
      "includeTests": false
    }
  }
}
```

### 配置项说明

| 配置项                  | 类型    | 默认值                          | 说明                             |
| ----------------------- | ------- | ------------------------------- | -------------------------------- |
| `enabled`               | boolean | `true`                          | 是否启用自然语言编程功能         |
| `model`                 | string  | `"default"`                     | 使用的 LLM 模型（`default` 跟随全局配置）|
| `maxSpecEntities`       | number  | `20`                            | 单次翻译最大实体数量             |
| `autoValidate`          | boolean | `true`                          | 翻译完成后自动验证 Spec 完整性   |
| `conventionSources`     | array   | `["package.json", ".eslintrc"]` | 项目约定分析的来源文件           |
| `maxInputLength`        | number  | `2000`                          | 自然语言输入最大字符数           |
| `completenessThreshold` | number  | `70`                            | Spec 完整度达标阈值（百分比）    |
| `historyMaxEntries`     | number  | `200`                           | 翻译历史最大保存条数             |
| `iterationMaxRounds`    | number  | `5`                             | 反馈迭代最大轮次                 |
| `codeGenerator.temperature` | number | `0.2`                       | 代码生成温度（越低越确定性越强） |

### 环境变量

| 变量                       | 默认值  | 说明                       |
| -------------------------- | ------- | -------------------------- |
| `NL_PROG_MODEL`            | —       | 覆盖配置文件中的 `model`   |
| `NL_PROG_MAX_INPUT`        | `2000`  | 最大输入长度               |
| `NL_PROG_COMPLETENESS_THR` | `70`    | Spec 完整度阈值            |

---

## 性能指标

### 基准测试结果

> 测试环境：Intel Core i7-12700K / 32GB RAM / Ollama qwen2:7b / Windows 10 Pro

| 操作                         | 典型耗时 | P95 耗时 | 目标上限 |
| ---------------------------- | -------- | -------- | -------- |
| 自然语言 → Spec 翻译         | 1.8 s    | 4.2 s    | 8 s      |
| Spec 完整性验证              | < 50 ms  | 120 ms   | 300 ms   |
| 反馈迭代优化（单轮）         | 1.5 s    | 3.8 s    | 7 s      |
| 项目约定分析（中型项目）     | 220 ms   | 650 ms   | 1500 ms  |
| 代码生成（单组件，~100 行）  | 3.2 s    | 7.5 s    | 15 s     |
| 历史记录查询（200 条）       | < 10 ms  | 25 ms    | 50 ms    |

### 翻译质量指标

基于 500 条标注样本的内部测试数据：

| 指标                      | 得分   |
| ------------------------- | ------ |
| 意图识别准确率            | 94.2%  |
| 实体提取 F1               | 88.7%  |
| 验收条件召回率            | 82.3%  |
| 生成代码首次编译通过率    | 78.5%  |
| 一轮迭代后代码通过率      | 91.2%  |
| Spec 完整度均值           | 81.4%  |

### 资源消耗

| 阶段            | CPU 占用（峰值） | 内存增量  |
| --------------- | ---------------- | --------- |
| 翻译请求期间    | 15–40%           | ~20 MB    |
| 代码生成期间    | 20–55%           | ~35 MB    |
| 项目约定分析    | 5–15%            | ~8 MB     |
| 空闲状态        | < 1%             | ~3 MB     |

---

## 测试覆盖率

### 测试文件

| 测试文件                                                          | 测试数 | 覆盖模块                       |
| ----------------------------------------------------------------- | ------ | ------------------------------ |
| `tests/unit/ai-engine/cowork/spec-translator.test.js`            | 28     | 意图提取、实体识别、验收条件   |
| `tests/unit/ai-engine/cowork/project-style-analyzer.test.js`     | 19     | 框架检测、命名规范提取         |
| `tests/unit/ai-engine/cowork/code-generator.test.js`             | 22     | Spec 驱动代码生成、多语言框架  |
| `tests/unit/renderer/stores/nlProgramming.test.ts`               | 14     | Pinia store 状态管理与 IPC     |
| `tests/integration/nl-programming/translate-generate.test.js`    | 11     | 翻译→生成端到端流程            |

**总计: 94 个测试**

### 覆盖率摘要

| 模块                          | 语句覆盖率 | 分支覆盖率 | 函数覆盖率 |
| ----------------------------- | ---------- | ---------- | ---------- |
| `spec-translator.js`          | 97%        | 93%        | 100%       |
| `project-style-analyzer.js`   | 92%        | 87%        | 95%        |
| `code-generator.js`           | 95%        | 90%        | 100%       |
| `nlProgramming.ts` (store)    | 91%        | 86%        | 100%       |

### 运行测试

```bash
# 单元测试
cd desktop-app-vue && npx vitest run tests/unit/ai-engine/cowork/

# Store 测试
cd desktop-app-vue && npx vitest run tests/unit/renderer/stores/nlProgramming.test.ts

# 集成测试
cd desktop-app-vue && npx vitest run tests/integration/nl-programming/

# 全部 NL 编程测试
cd desktop-app-vue && npx vitest run tests/unit/ai-engine/cowork/ tests/unit/renderer/stores/nlProgramming.test.ts tests/integration/nl-programming/
```

---

## 安全考虑

1. **输入过滤**: 自然语言输入在翻译前经过长度限制和敏感词过滤，防止注入攻击
2. **代码审查**: 生成的代码不会自动执行，需用户在预览区确认后手动应用到工作区
3. **约定隔离**: 项目约定分析仅读取配置文件元信息，不会扫描或上传源代码内容
4. **LLM 隐私**: 翻译和生成请求发送到本地 LLM（Ollama），默认不依赖云端服务
5. **历史保护**: 翻译历史存储在本地数据库，使用 SQLCipher 加密保护
6. **模板安全**: Spec 中的实体和验收条件经过参数化处理，防止模板注入风险

---

## 相关文档

- [Context Engineering](/chainlesschain/context-engineering)
- [Cowork 多智能体协作](/chainlesschain/cowork)
