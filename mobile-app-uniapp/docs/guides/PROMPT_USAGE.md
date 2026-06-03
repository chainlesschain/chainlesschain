# Prompt模板管理系统 - 使用指南

> 移动端AI提示词模板管理系统 v1.9.0
> 支持模板创建、变量替换、分类管理、评分、导入导出等功能

---

## 目录

- [快速开始](#快速开始)
- [核心功能](#核心功能)
- [模板结构](#模板结构)
- [CRUD操作](#crud操作)
- [模板填充](#模板填充)
- [查询与搜索](#查询与搜索)
- [评分系统](#评分系统)
- [统计信息](#统计信息)
- [导入导出](#导入导出)
- [缓存机制](#缓存机制)
- [内置模板](#内置模板)
- [最佳实践](#最佳实践)
- [API参考](#api参考)

---

## 快速开始

### 初始化

```javascript
import { createPromptManager } from '@/services/prompt/prompt-manager.js'

// 创建管理器实例（假设已有数据库实例）
const db = uni.requireNativePlugin('SQLite')
const promptManager = createPromptManager(db)

// 初始化（创建表、插入内置模板）
await promptManager.initialize()
```

### 基本使用

```javascript
// 1. 创建自定义模板
const template = await promptManager.createTemplate({
  name: '文章润色',
  description: '优化文章表达和语言',
  template: `请帮我润色以下文章：

{{content}}

润色要求：
- 优化语言表达
- 保持原意不变
- 提升可读性`,
  variables: ['content'],
  category: 'writing',
  tags: ['写作', '润色']
})

// 2. 填充模板
const prompt = await promptManager.fillTemplate(template.id, {
  content: '这是我的原始文章内容...'
})

// 3. 使用填充后的提示词调用LLM
// const result = await llmService.chat(prompt)
```

---

## 核心功能

### 功能列表

- ✅ **CRUD操作** - 创建、读取、更新、删除模板
- ✅ **变量替换** - 支持 `{{variable}}` 语法
- ✅ **分类管理** - 12种分类（writing, translation, analysis等）
- ✅ **标签系统** - 多标签支持，便于组织
- ✅ **评分系统** - 用户评分，计算平均分
- ✅ **使用统计** - 自动跟踪使用次数
- ✅ **搜索功能** - 按名称、描述、内容、标签搜索
- ✅ **导入导出** - JSON格式导入导出
- ✅ **软删除** - 删除不会物理移除数据
- ✅ **缓存优化** - 多级缓存，提升性能
- ✅ **内置模板** - 12个常用模板开箱即用

### 与PC版对比

| 功能 | 移动端 | PC版 | 备注 |
|------|--------|------|------|
| 基础CRUD | ✅ | ✅ | 完全一致 |
| 变量替换 | ✅ | ✅ | 相同语法 |
| 分类管理 | ✅ | ✅ | 分类略有不同 |
| 评分系统 | ✅ | ❌ | 移动端新增 |
| 标签系统 | ✅ | ❌ | 移动端新增 |
| 缓存机制 | ✅ (Map) | ❌ | 移动端优化 |
| 软删除 | ✅ | ❌ | 移动端新增 |
| 内置模板数量 | 12个 | 10个 | 移动端多2个 |
| 导入导出 | ✅ | ✅ | 格式相同 |

---

## 模板结构

### 数据库表结构

```sql
CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL,               -- 模板名称
  description TEXT,                 -- 描述
  template TEXT NOT NULL,           -- 模板内容
  variables TEXT,                   -- 变量列表（JSON）
  category TEXT DEFAULT 'general',  -- 分类
  tags TEXT,                        -- 标签（JSON）
  is_system INTEGER DEFAULT 0,      -- 是否系统模板
  usage_count INTEGER DEFAULT 0,    -- 使用次数
  rating REAL DEFAULT 0,            -- 平均评分
  rating_count INTEGER DEFAULT 0,   -- 评分次数
  author TEXT,                      -- 作者
  version TEXT DEFAULT '1.0.0',     -- 版本
  created_at INTEGER NOT NULL,      -- 创建时间
  updated_at INTEGER NOT NULL,      -- 更新时间
  deleted INTEGER DEFAULT 0         -- 软删除标记
)
```

### 模板对象示例

```javascript
{
  id: 'builtin-summarize',
  name: '内容摘要',
  description: '为长文本生成简洁摘要',
  template: '请为以下内容生成一个简洁的摘要：\n\n{{content}}\n\n要求：...',
  variables: ['content'],
  category: 'writing',
  tags: ['摘要', '总结', '写作'],
  is_system: true,
  usage_count: 156,
  rating: 4.5,
  rating_count: 32,
  author: 'system',
  version: '1.0.0',
  created_at: 1704067200000,
  updated_at: 1704067200000,
  deleted: false
}
```

---

## CRUD操作

### 创建模板

```javascript
const template = await promptManager.createTemplate({
  name: '代码审查',
  description: '审查代码质量和潜在问题',
  template: `请审查以下{{language}}代码：

\`\`\`{{language}}
{{code}}
\`\`\`

请检查：
1. 代码规范
2. 潜在bug
3. 性能问题
4. 安全漏洞`,
  variables: ['code', 'language'],
  category: 'programming',
  tags: ['代码审查', '质量', '安全'],
  author: 'user'
})

console.log('模板已创建:', template.id)
```

### 读取模板

```javascript
// 按ID读取
const template = await promptManager.getTemplateById('builtin-summarize')

// 读取所有模板
const allTemplates = await promptManager.getTemplates()

// 按分类读取
const writingTemplates = await promptManager.getTemplates({
  category: 'writing'
})

// 只读取系统模板
const systemTemplates = await promptManager.getTemplates({
  isSystem: true
})

// 分页读取
const page1 = await promptManager.getTemplates({
  limit: 10,
  offset: 0
})
```

### 更新模板

```javascript
const updated = await promptManager.updateTemplate(templateId, {
  name: '新名称',
  description: '新描述',
  template: '新内容：{{var}}',
  variables: ['var'],
  category: 'custom',
  tags: ['新标签']
})

// 注意：系统模板不能修改
// await promptManager.updateTemplate('builtin-summarize', {...}) // 抛出错误
```

### 删除模板

```javascript
// 软删除（不会物理删除）
await promptManager.deleteTemplate(templateId)

// 删除后无法查询到
const deleted = await promptManager.getTemplateById(templateId)
console.log(deleted) // null

// 注意：系统模板不能删除
// await promptManager.deleteTemplate('builtin-summarize') // 抛出错误
```

---

## 模板填充

### 基本填充

```javascript
// 填充单个变量
const prompt = await promptManager.fillTemplate('builtin-summarize', {
  content: '这是一篇很长的文章内容...'
})

// 填充多个变量
const translationPrompt = await promptManager.fillTemplate('builtin-translate', {
  content: 'Hello, World!',
  target_language: '中文'
})
```

### 高级填充

```javascript
// 使用对象数据填充
const data = {
  code: 'function add(a, b) { return a + b }',
  language: 'javascript'
}

const codePrompt = await promptManager.fillTemplate('builtin-code-explain', data)

// 填充后自动增加使用次数
const template = await promptManager.getTemplateById('builtin-code-explain')
console.log('使用次数:', template.usage_count) // +1
```

### 缺失变量处理

```javascript
// 如果变量未提供，占位符会被替换为空字符串
const prompt = await promptManager.fillTemplate('builtin-expand', {
  content: '简短内容'
  // 缺少 length 变量
})

// 结果: "目标长度约  字" (length被替换为空)
```

---

## 查询与搜索

### 按分类查询

```javascript
const categories = await promptManager.getCategories()
console.log('所有分类:', categories)
// ['writing', 'translation', 'analysis', 'qa', 'creative', 'programming', 'rag', 'mobile', 'general', 'custom']

const writingTemplates = await promptManager.getTemplates({
  category: 'writing'
})
```

### 全文搜索

```javascript
// 搜索会匹配：名称、描述、模板内容、标签
const results = await promptManager.searchTemplates('翻译')

// 限制搜索结果数量
const top10 = await promptManager.searchTemplates('代码', {
  limit: 10
})
```

### 按标签查询

```javascript
const ratedTemplates = await promptManager.getTemplates({
  tags: ['写作']
})
```

---

## 评分系统

### 添加评分

```javascript
// 评分范围: 1-5
await promptManager.rateTemplate('builtin-summarize', 5)

// 查看评分结果
const template = await promptManager.getTemplateById('builtin-summarize')
console.log('平均评分:', template.rating)
console.log('评分次数:', template.rating_count)
```

### 评分计算

评分使用移动平均算法：

```
新平均分 = (旧平均分 × 旧评分次数 + 新评分) / (旧评分次数 + 1)
```

示例：
```javascript
// 初始: rating = 0, rating_count = 0

await promptManager.rateTemplate(templateId, 5)
// 结果: rating = 5.0, rating_count = 1

await promptManager.rateTemplate(templateId, 3)
// 结果: rating = 4.0, rating_count = 2

await promptManager.rateTemplate(templateId, 4)
// 结果: rating = 4.0, rating_count = 3
```

---

## 统计信息

### 获取统计数据

```javascript
const stats = await promptManager.getStatistics()

console.log(stats)
// {
//   total: 25,           // 总模板数
//   system: 12,          // 系统模板数
//   custom: 13,          // 用户模板数
//   byCategory: {        // 按分类统计
//     writing: 6,
//     translation: 2,
//     programming: 3,
//     ...
//   },
//   mostUsed: [          // 最常用的5个模板
//     { id: 'builtin-summarize', name: '内容摘要', usage_count: 156 },
//     { id: 'builtin-translate', name: '翻译助手', usage_count: 89 },
//     ...
//   ]
// }
```

### 统计数据用途

```javascript
// 1. 显示仪表盘
<Dashboard>
  <StatCard title="总模板数" value={stats.total} />
  <StatCard title="系统模板" value={stats.system} />
  <StatCard title="自定义模板" value={stats.custom} />
</Dashboard>

// 2. 分类分布图表
<PieChart data={stats.byCategory} />

// 3. 热门模板推荐
<HotTemplates templates={stats.mostUsed} />
```

---

## 导入导出

### 导出模板

```javascript
// 导出单个模板
const exportData = await promptManager.exportTemplate('builtin-summarize')

console.log(exportData)
// {
//   version: '1.0',
//   exported_at: '2024-01-01T12:00:00.000Z',
//   template: {
//     name: '内容摘要',
//     description: '为长文本生成简洁摘要',
//     template: '...',
//     variables: ['content'],
//     category: 'writing',
//     tags: ['摘要', '总结'],
//     author: 'system'
//   }
// }

// 保存为JSON文件
const json = JSON.stringify(exportData, null, 2)
// 使用文件系统API保存
```

### 导入模板

```javascript
// 从JSON导入
const importData = {
  version: '1.0',
  exported_at: '2024-01-01T12:00:00.000Z',
  template: {
    name: '自定义模板',
    description: '描述...',
    template: '内容：{{var}}',
    variables: ['var'],
    category: 'custom',
    tags: ['自定义']
  }
}

const imported = await promptManager.importTemplate(importData)
console.log('导入成功:', imported.id)
```

### 批量导入导出

```javascript
// 导出所有自定义模板
async function exportAllCustomTemplates() {
  const templates = await promptManager.getTemplates({ isSystem: false })
  const exports = []

  for (const template of templates) {
    const exportData = await promptManager.exportTemplate(template.id)
    exports.push(exportData)
  }

  return exports
}

// 批量导入
async function importTemplates(exportsList) {
  const results = []

  for (const exportData of exportsList) {
    try {
      const imported = await promptManager.importTemplate(exportData)
      results.push({ success: true, id: imported.id })
    } catch (error) {
      results.push({ success: false, error: error.message })
    }
  }

  return results
}
```

---

## 缓存机制

### 缓存层级

1. **模板缓存** - 按ID缓存单个模板（5分钟过期）
2. **统计缓存** - 缓存统计信息（5分钟过期）
3. **分类缓存** - 缓存分类列表（5分钟过期）

### 缓存策略

```javascript
// 查询时自动使用缓存
const template = await promptManager.getTemplateById(id)
// 第一次: 从数据库读取，写入缓存
// 第二次: 从缓存读取（< 5分钟）

// 更新/删除时自动清除相关缓存
await promptManager.updateTemplate(id, {...})
// 清除该模板缓存 + 统计缓存 + 分类缓存

// 手动清除所有缓存
promptManager.clearAllCache()
```

### 缓存性能

| 操作 | 无缓存 | 有缓存 | 提升 |
|------|--------|--------|------|
| getTemplateById | ~15ms | ~1ms | 15x |
| getStatistics | ~50ms | ~1ms | 50x |
| getCategories | ~20ms | ~1ms | 20x |

---

## 内置模板

### 模板列表（12个）

| ID | 名称 | 分类 | 变量 | 用途 |
|----|------|------|------|------|
| builtin-summarize | 内容摘要 | writing | content | 生成文本摘要 |
| builtin-expand | 内容扩写 | writing | content, length | 扩展简短内容 |
| builtin-translate | 翻译助手 | translation | content, target_language | 翻译文本 |
| builtin-proofread | 文本校对 | writing | content | 检查文本错误 |
| builtin-extract-keywords | 关键词提取 | analysis | content | 提取关键词 |
| builtin-qa | 问答助手 | qa | context, question | 基于上下文回答 |
| builtin-brainstorm | 头脑风暴 | creative | topic, count | 生成创意想法 |
| builtin-code-explain | 代码解释 | programming | code, language | 解释代码逻辑 |
| builtin-outline | 大纲生成 | writing | topic, sections | 生成文章大纲 |
| builtin-rag-query | RAG增强查询 | rag | retrieved_docs, question | RAG问答 |
| builtin-sentiment-analysis | 情感分析 | analysis | content | 分析情感倾向 |
| builtin-mobile-note | 移动快记 | mobile | title, datetime, location, tags, content, todo_1, todo_2, notes | 移动端快速笔记 |

### 使用示例

```javascript
// 1. 内容摘要
const summary = await promptManager.fillTemplate('builtin-summarize', {
  content: '长文本内容...'
})

// 2. 翻译
const translation = await promptManager.fillTemplate('builtin-translate', {
  content: 'Hello, World!',
  target_language: '中文'
})

// 3. 代码解释
const explanation = await promptManager.fillTemplate('builtin-code-explain', {
  code: 'function add(a, b) { return a + b }',
  language: 'javascript'
})

// 4. RAG查询
const ragAnswer = await promptManager.fillTemplate('builtin-rag-query', {
  retrieved_docs: '文档1...\n文档2...',
  question: '用户问题'
})

// 5. 移动快记（移动端特有）
const mobileNote = await promptManager.fillTemplate('builtin-mobile-note', {
  title: '今日工作',
  datetime: new Date().toLocaleString(),
  location: '办公室',
  tags: '#工作 #会议',
  content: '今天参加了项目评审会...',
  todo_1: '完成需求文档',
  todo_2: '更新项目计划',
  notes: '明天继续跟进'
})
```

---

## 最佳实践

### 1. 模板命名规范

```javascript
// ✅ 好的命名
'代码审查 - JavaScript'
'文章润色 - 学术论文'
'翻译 - 中译英（技术文档）'

// ❌ 不好的命名
'模板1'
'test'
'新模板'
```

### 2. 变量命名

```javascript
// ✅ 清晰的变量名
variables: ['source_code', 'target_language', 'user_context']

// ❌ 不清晰的变量名
variables: ['var1', 'x', 'data']
```

### 3. 描述撰写

```javascript
// ✅ 详细的描述
description: '将技术文档从中文翻译成英文，保持术语准确性和专业性'

// ❌ 空泛的描述
description: '翻译'
```

### 4. 合理使用分类和标签

```javascript
// ✅ 合理的分类和标签
{
  category: 'programming',
  tags: ['代码审查', 'JavaScript', '质量', '安全']
}

// ❌ 过多或不相关的标签
{
  category: 'general',
  tags: ['标签1', '标签2', '标签3', ...] // 过多
}
```

### 5. 模板内容格式

```javascript
// ✅ 清晰的格式
template: `请审查以下代码：

\`\`\`{{language}}
{{code}}
\`\`\`

审查重点：
1. 代码规范
2. 性能优化
3. 安全问题

请提供：
- 问题列表
- 改进建议
- 优化方案`

// ❌ 混乱的格式
template: `审查代码{{code}}看看有什么问题吧`
```

### 6. 性能优化

```javascript
// ✅ 利用缓存
const template = await promptManager.getTemplateById(id) // 使用缓存
const template2 = await promptManager.getTemplateById(id) // 命中缓存

// ✅ 批量操作
const templates = await promptManager.getTemplates({ category: 'writing' })
// 一次查询多个模板

// ❌ 循环查询
for (const id of ids) {
  const template = await promptManager.getTemplateById(id) // 多次查询
}
```

### 7. 错误处理

```javascript
// ✅ 完善的错误处理
try {
  const template = await promptManager.createTemplate({
    name: '新模板',
    template: '内容：{{var}}'
  })
} catch (error) {
  if (error.message === '模板名称和内容不能为空') {
    console.error('请提供完整的模板信息')
  } else {
    console.error('创建失败:', error.message)
  }
}

// ❌ 忽略错误
const template = await promptManager.createTemplate({...}) // 可能失败
```

---

## API参考

### 初始化

```javascript
initialize(): Promise<boolean>
```

### CRUD操作

```javascript
createTemplate(templateData: Object): Promise<Object>
getTemplateById(id: string): Promise<Object|null>
getTemplates(options?: Object): Promise<Array<Object>>
updateTemplate(id: string, updates: Object): Promise<Object>
deleteTemplate(id: string): Promise<boolean>
```

### 模板操作

```javascript
fillTemplate(id: string, values: Object): Promise<string>
incrementUsage(id: string): Promise<void>
rateTemplate(id: string, rating: number): Promise<Object>
```

### 查询与搜索

```javascript
searchTemplates(query: string, options?: Object): Promise<Array<Object>>
getCategories(): Promise<Array<string>>
getStatistics(): Promise<Object>
```

### 导入导出

```javascript
exportTemplate(id: string): Promise<Object>
importTemplate(importData: Object): Promise<Object>
```

### 缓存管理

```javascript
invalidateCache(): void
clearAllCache(): void
```

---

## 常见问题

### Q1: 如何备份所有模板？

```javascript
async function backupAllTemplates() {
  const allTemplates = await promptManager.getTemplates()
  const backups = []

  for (const template of allTemplates) {
    const exportData = await promptManager.exportTemplate(template.id)
    backups.push(exportData)
  }

  // 保存为JSON文件
  const json = JSON.stringify(backups, null, 2)
  // 使用文件系统保存
}
```

### Q2: 如何恢复已删除的模板？

软删除的模板可以通过直接修改数据库恢复：

```sql
UPDATE prompt_templates SET deleted = 0 WHERE id = 'template-id'
```

### Q3: 如何清理长期不用的模板？

```javascript
async function cleanupUnusedTemplates(daysThreshold = 90) {
  const allTemplates = await promptManager.getTemplates({ isSystem: false })
  const now = Date.now()
  const threshold = daysThreshold * 24 * 60 * 60 * 1000

  for (const template of allTemplates) {
    if (template.usage_count === 0 && now - template.created_at > threshold) {
      await promptManager.deleteTemplate(template.id)
      console.log('已删除:', template.name)
    }
  }
}
```

### Q4: 如何实现模板版本控制？

```javascript
async function createTemplateVersion(baseId, updates) {
  const base = await promptManager.getTemplateById(baseId)

  // 增加版本号
  const [major, minor, patch] = base.version.split('.').map(Number)
  const newVersion = `${major}.${minor}.${patch + 1}`

  // 创建新版本
  return await promptManager.createTemplate({
    ...base,
    ...updates,
    version: newVersion,
    name: `${base.name} v${newVersion}`
  })
}
```

---

## 更新日志

### v1.9.0 (2024-01-02)
- ✅ 初始版本发布
- ✅ 12个内置模板
- ✅ 完整的CRUD功能
- ✅ 评分系统
- ✅ 标签系统
- ✅ 缓存优化
- ✅ 软删除
- ✅ 导入导出

---

## 技术支持

- 文档: `/docs/PROMPT_USAGE.md`
- 测试: `/test/prompt-test.js`
- 源码: `/src/services/prompt/prompt-manager.js`
- 报告: `/MOBILE_PROMPT_COMPLETE_REPORT.md`
