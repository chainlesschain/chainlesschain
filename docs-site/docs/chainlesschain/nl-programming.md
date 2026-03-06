# 自然语言编程

> **版本: v1.1.0+ | NL→代码管道 | 需求解析 | 项目风格分析 (10 IPC)**

自然语言编程系统将自然语言需求描述转化为可执行代码，通过需求解析、规范翻译、风格分析实现从描述到代码的完整管道。

## 系统概述

### NL→代码管道

```
自然语言需求
     │
     ▼
┌─────────────────┐
│ RequirementParser│ ← 需求分类、用户故事提取、验收标准
└────────┬────────┘
         ▼
┌─────────────────┐
│ SpecTranslator   │ ← NL → 结构化 Spec JSON
└────────┬────────┘
         ▼
┌─────────────────┐
│ ProjectStyle     │ ← 分析项目约定（命名、架构、风格）
│ Analyzer         │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Code Generation  │ ← 按规范 + 风格生成代码
└────────┬────────┘
         ▼
┌─────────────────┐
│ Verification     │ ← 构建 + 类型检查 + 测试 + 审查
│ Loop             │
└─────────────────┘
```

---

## 需求解析

### 需求分类

| 类型            | 关键词                   | 说明       |
| --------------- | ------------------------ | ---------- |
| `feature`       | 添加、新增、实现、创建   | 新功能开发 |
| `bugfix`        | 修复、��正、解���、bug   | 缺陷修复   |
| `refactor`      | 重构、优化结构、整理     | 代码重构   |
| `optimization`  | 优化、提升、加速、性能   | 性能优化   |
| `security`      | 安全、漏洞、权限、认证   | 安全增强   |
| `documentation` | 文档、注释、说明、README | 文档编写   |

### 解析输出

```json
{
  "type": "feature",
  "userStory": "作为用户，我希望有一个资料编辑页面，以便修改个人信息",
  "acceptanceCriteria": [
    "可以上传和裁剪头像",
    "可以修改昵称（2-20字符）",
    "保存后立即生效"
  ],
  "boundaryConditions": ["昵称长度校验", "图片格式限制", "并发编辑冲突"],
  "dependencies": ["UserService", "FileUpload"],
  "techStack": ["vue", "api", "storage"]
}
```

### 双语支持

同时支持中文和英文关键词识别：

```
中文: "添加用户资料页面"
英文: "Add user profile page"
→ 都能正确识别为 feature 类型
```

---

## 规范翻译

### 翻译流程

```
NL 输入 → 意图识别 → 上下文补全 → 规范生成 → 验证
   │          │           │            │          │
   │          │           │            │          └─ 规范完整性检查
   │          │           │            └─ 生成 Spec JSON
   │          │           └─ CKG 补全依赖/接口信息
   │          └─ 9 种意图分类
   └─ 自然语言描述
```

### 规范验证

```json
{
  "valid": true,
  "errors": [],
  "warnings": ["建议添加错误处理说明"],
  "completeness": 0.85,
  "suggestions": ["可以参考现有的 ProfilePage 组件"]
}
```

### 多轮消歧

当需求模糊时自动提出问题：

```
状态: draft → translating → ambiguous → validated → completed
```

- `ambiguous` 状态下自动生成澄清问题
- 用户回答后继续翻译
- 支持多轮对话迭代完善规范

---

## 项目风格分析

### 分析维度

| 维度           | 分析内容 | 示例                                         |
| -------------- | -------- | -------------------------------------------- |
| `NAMING`       | 命名约定 | `camelCase` 变量，`PascalCase` 组件          |
| `ARCHITECTURE` | 架构模式 | `src/main/` 主进程，`src/renderer/` 渲染进程 |
| `TESTING`      | 测试约定 | Vitest, `__tests__/` 目录，`.test.js` 后缀   |
| `STYLE`        | 代码风格 | 2空格缩进，单引号，无分号                    |
| `IMPORTS`      | 导入规范 | Node 内置 → 第三方 → 本地模块                |
| `COMPONENTS`   | 组件规范 | SFC 结构，Props 定义方式                     |

### 风格报告

```json
{
  "naming": {
    "variables": "camelCase",
    "functions": "camelCase",
    "classes": "PascalCase",
    "files": "kebab-case",
    "confidence": 0.92
  },
  "architecture": {
    "pattern": "electron-main-renderer",
    "moduleSystem": "commonjs (main) / esm (renderer)",
    "confidence": 0.95
  },
  "testing": {
    "framework": "vitest",
    "pattern": "__tests__/*.test.js",
    "confidence": 0.88
  }
}
```

### 集成

- **代码知识图谱**: 提供模块依赖和结构信息
- **Instinct 学习**: 利用历史编码行为模式
- **缓存**: 分析结果缓存 10 分钟，避免重复扫描
- **目录扫描**: 最大深度 5 层，最多 500 文件

---

## 端到端示例

```
用户: "帮我创建一个社交通知设置页面，可以开关各种通知类型"

Step 1 - 需求解析:
  类型: feature
  用户故事: 作为用户，我希望可以管理社交通知偏好
  验收标准: 可以单独开关每种通知类型，设置立即保存

Step 2 - 规范翻译:
  意图: create-component
  组件: NotificationSettings
  功能: 通知类型列表 + 开关控件

Step 3 - 风格分析:
  组件放置: src/renderer/pages/NotificationSettingsPage.vue
  状态管理: src/renderer/stores/notificationSettings.ts
  IPC: src/main/social/notification-settings-ipc.js

Step 4 - 代码生成:
  生成 Vue SFC + Pinia Store + IPC Handler

Step 5 - 验证:
  构建 ✓ → 类型检查 ✓ → Lint ✓ → 测试 ✓
```

---

## 关键文件

| 文件                                                  | 职责               |
| ----------------------------------------------------- | ------------------ |
| `src/main/ai-engine/cowork/requirement-parser.js`     | 需求解析器         |
| `src/main/ai-engine/cowork/spec-translator.js`        | NL → Spec 规范翻译 |
| `src/main/ai-engine/cowork/project-style-analyzer.js` | 项目风格分析       |
| `src/main/ai-engine/cowork/evolution-ipc.js`          | IPC 处理器         |
