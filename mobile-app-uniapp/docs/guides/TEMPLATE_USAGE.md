# 模板管理系统使用指南 (Template Management Usage Guide)

版本: v1.8.0 | 更新时间: 2026-01-02

## 目录

1. [快速开始](#快速开始)
2. [模板引擎](#模板引擎)
3. [内置模板](#内置模板)
4. [创建模板](#创建模板)
5. [管理模板](#管理模板)
6. [应用模板](#应用模板)
7. [查询和筛选](#查询和筛选)
8. [评分系统](#评分系统)
9. [最佳实践](#最佳实践)
10. [API参考](#api参考)

## 快速开始

### 安装和初始化

```javascript
import { getTemplateManager } from '@/services/template/template-manager'

// 获取模板管理器实例
const templateManager = getTemplateManager()

// 初始化（加载内置模板）
await templateManager.initialize()
```

### 基本使用

```javascript
// 1. 获取所有模板
const templates = await templateManager.getTemplates()
console.log('模板总数:', templates.length)

// 2. 应用模板
const result = await templateManager.applyTemplate('template_blog_post', {
  title: '我的第一篇博客',
  author: '张三',
  content: '这是博客内容...'
})

console.log(result)

// 3. 创建自定义模板
const customTemplate = await templateManager.createTemplate({
  name: 'my_template',
  display_name: '我的模板',
  category: 'custom',
  content: '标题：{{title}}\n内容：{{content}}'
})

// 4. 使用自定义模板
const output = await templateManager.applyTemplate(customTemplate.id, {
  title: '测试标题',
  content: '测试内容'
})
```

## 模板引擎

模板系统使用简化的模板引擎，支持 `{{variable}}` 语法。

### 基本语法

```javascript
// 简单变量替换
const template = '你好，{{name}}！'
const data = { name: '李四' }
const result = templateManager.engine.render(template, data)
// 结果: "你好，李四！"
```

### 嵌套对象

```javascript
// 支持嵌套对象访问
const template = '姓名：{{user.name}}，城市：{{user.address.city}}'
const data = {
  user: {
    name: '王五',
    address: {
      city: '北京'
    }
  }
}
const result = templateManager.engine.render(template, data)
// 结果: "姓名：王五，城市：北京"
```

### 提取变量

```javascript
// 从模板中提取所有变量
const template = '{{title}} - 作者：{{author}}，日期：{{date}}'
const variables = templateManager.engine.extractVariables(template)
// 结果: ['title', 'author', 'date']
```

## 内置模板

系统内置了6个常用模板：

### 1. 博客文章 (Blog Post)

```javascript
const result = await templateManager.applyTemplate('template_blog_post', {
  title: '如何高效学习',
  author: '张三',
  date: '2026-01-02',
  summary: '本文介绍高效学习的方法',
  content: '1. 制定计划\n2. 专注执行\n3. 定期复习',
  conclusion: '坚持才是关键',
  tags: '学习, 效率'
})
```

### 2. 会议记录 (Meeting Notes)

```javascript
const result = await templateManager.applyTemplate('template_meeting_notes', {
  title: '产品规划会议',
  date: '2026-01-02',
  time: '14:00',
  location: '会议室A',
  host: '李四',
  attendees: '张三、王五、赵六',
  agenda: '1. Q1规划\n2. 新功能讨论',
  discussion: '讨论了多个功能点...',
  decisions: '决定优先开发功能A',
  action_items: '- 张三：准备技术方案\n- 王五：设计原型',
  recorder: '赵六'
})
```

### 3. 项目文档 (Project Documentation)

```javascript
const result = await templateManager.applyTemplate('template_project_doc', {
  project_name: '移动端应用',
  overview: '一个功能完整的移动应用',
  tech_stack: 'uni-app, Vue3, SQLite',
  features: '1. 用户管理\n2. 数据同步\n3. 离线支持',
  version: 'v1.0.0',
  maintainer: '开发团队'
})
```

### 4. 学习笔记 (Study Notes)

```javascript
const result = await templateManager.applyTemplate('template_study_notes', {
  subject: 'JavaScript',
  topic: 'Promise和async/await',
  date: '2026-01-02',
  key_concepts: '异步编程、Promise链、错误处理',
  detailed_notes: 'Promise是处理异步操作的标准方式...',
  examples: 'async function fetchData() { ... }',
  summary: 'async/await让异步代码看起来像同步代码'
})
```

### 5. 任务清单 (Todo List)

```javascript
const result = await templateManager.applyTemplate('template_todo_list', {
  list_name: '本周工作计划',
  date: '2026-01-02',
  priority: '高',
  today_must_do: '- 完成项目方案\n- 参加团队会议',
  week_plan: '- 周一：需求分析\n- 周二：技术设计',
  todo_items: '- 编写代码\n- 写单元测试\n- Code Review'
})
```

### 6. 读书笔记 (Book Notes)

```javascript
const result = await templateManager.applyTemplate('template_book_notes', {
  book_title: 'JavaScript高级程序设计',
  author: 'Nicholas C. Zakas',
  reading_date: '2026-01-02',
  rating: 5,
  key_points: '详细讲解了JS的核心概念和高级特性',
  thoughts: '这是一本必读的JavaScript书籍',
  action_items: '实践书中的代码示例'
})
```

## 创建模板

### 创建简单模板

```javascript
const template = await templateManager.createTemplate({
  name: 'simple_note',
  display_name: '简单笔记',
  description: '一个简单的笔记模板',
  icon: '📝',
  category: 'note',
  subcategory: 'simple',
  tags: ['笔记', '简单'],
  content: `# {{title}}

日期：{{date}}

{{content}}

---
标签：{{tags}}`
})

console.log('模板ID:', template.id)
```

### 定义变量Schema

```javascript
const template = await templateManager.createTemplate({
  name: 'advanced_template',
  display_name: '高级模板',
  category: 'advanced',
  content: '标题：{{title}}\n内容：{{content}}',

  // 定义变量Schema（可选）
  variables: JSON.stringify([
    {
      name: 'title',
      label: '标题',
      type: 'text',
      required: true,
      placeholder: '请输入标题'
    },
    {
      name: 'content',
      label: '内容',
      type: 'textarea',
      required: true,
      placeholder: '请输入内容'
    },
    {
      name: 'priority',
      label: '优先级',
      type: 'select',
      required: false,
      options: ['高', '中', '低']
    }
  ])
})
```

### 支持的变量类型

- `text` - 单行文本
- `textarea` - 多行文本
- `number` - 数字
- `date` - 日期
- `time` - 时间
- `select` - 下拉选择

## 管理模板

### 获取单个模板

```javascript
const template = await templateManager.getTemplateById('template_blog_post')

if (template) {
  console.log('模板名称:', template.display_name)
  console.log('分类:', template.category)
  console.log('使用次数:', template.usage_count)
  console.log('评分:', template.rating)
}
```

### 更新模板

```javascript
// 只能更新自定义模板，不能更新内置模板
const updated = await templateManager.updateTemplate(templateId, {
  display_name: '新的名称',
  description: '新的描述',
  content: '更新后的内容：{{title}}'
})

console.log('更新成功:', updated.display_name)
```

### 删除模板

```javascript
// 软删除，只能删除自定义模板
const result = await templateManager.deleteTemplate(templateId)

if (result) {
  console.log('删除成功')
}

// 注意：内置模板不能删除
try {
  await templateManager.deleteTemplate('template_blog_post')
} catch (error) {
  console.error(error.message) // "不能删除内置模板"
}
```

## 应用模板

### 基本应用

```javascript
const result = await templateManager.applyTemplate('template_blog_post', {
  title: '模板系统使用指南',
  author: '技术团队',
  date: '2026-01-02',
  content: '详细介绍了模板系统的使用方法...'
})

console.log(result)
```

### 部分数据应用

```javascript
// 即使某些变量未提供，模板仍然可以渲染
const result = await templateManager.applyTemplate('template_blog_post', {
  title: '标题',
  content: '内容'
  // 其他变量未提供，将显示为空
})
```

### 获取模板使用统计

```javascript
// 应用模板会自动增加使用次数
await templateManager.applyTemplate(templateId, data)

const template = await templateManager.getTemplateById(templateId)
console.log('使用次数:', template.usage_count)
```

## 查询和筛选

### 获取所有模板

```javascript
const allTemplates = await templateManager.getTemplates()
console.log('总数:', allTemplates.length)
```

### 按分类查询

```javascript
const writingTemplates = await templateManager.getTemplates({
  category: 'writing'
})

console.log('写作类模板:', writingTemplates.length)
```

### 按子分类查询

```javascript
const blogTemplates = await templateManager.getTemplates({
  category: 'writing',
  subcategory: 'blog'
})
```

### 搜索模板

```javascript
// 在名称、描述、标签中搜索
const searchResults = await templateManager.getTemplates({
  search: '会议'
})

searchResults.forEach(t => {
  console.log(t.display_name, '-', t.description)
})
```

### 只获取自定义模板

```javascript
const customTemplates = await templateManager.getTemplates({
  includeBuiltin: false  // 不包含内置模板
})

console.log('自定义模板数:', customTemplates.length)
```

### 分页查询

```javascript
// 第一页（每页10条）
const page1 = await templateManager.getTemplates({
  limit: 10,
  offset: 0
})

// 第二页
const page2 = await templateManager.getTemplates({
  limit: 10,
  offset: 10
})
```

### 获取分类列表

```javascript
const categories = await templateManager.getCategories()

categories.forEach(cat => {
  console.log(`${cat.category}: ${cat.count}个模板`)
})
```

## 评分系统

### 给模板评分

```javascript
// 评分范围：1-5
const rated = await templateManager.rateTemplate(templateId, 5)

console.log('当前评分:', rated.rating)
console.log('评分人数:', rated.rating_count)
```

### 查看评分

```javascript
const template = await templateManager.getTemplateById(templateId)

if (template.rating_count > 0) {
  console.log(`平均评分: ${template.rating.toFixed(1)} (${template.rating_count}人评价)`)
} else {
  console.log('暂无评分')
}
```

### 多次评分计算平均值

```javascript
await templateManager.rateTemplate(templateId, 5)  // 第1次评分
await templateManager.rateTemplate(templateId, 3)  // 第2次评分
const result = await templateManager.rateTemplate(templateId, 4)  // 第3次评分

console.log(result.rating)  // (5 + 3 + 4) / 3 = 4.0
console.log(result.rating_count)  // 3
```

## 最佳实践

### 1. 合理组织模板分类

```javascript
// 推荐的分类结构
const categories = {
  'writing': '写作',           // 博客、文章
  'productivity': '效率',      // 会议、任务
  'education': '教育',         // 笔记、学习
  'tech-docs': '技术文档',     // 项目文档、API
  'personal': '个人',          // 日记、计划
  'business': '商务'           // 报告、方案
}
```

### 2. 使用语义化的变量名

```javascript
// ✅ 好的变量名
const template = {
  content: `
作者：{{author_name}}
日期：{{created_date}}
邮箱：{{contact_email}}
  `
}

// ❌ 不好的变量名
const template = {
  content: `
作者：{{a}}
日期：{{d}}
邮箱：{{e}}
  `
}
```

### 3. 提供完整的变量Schema

```javascript
const template = await templateManager.createTemplate({
  name: 'report',
  display_name: '报告模板',
  category: 'business',
  content: '...',

  // 完整的变量定义
  variables: JSON.stringify([
    {
      name: 'title',
      label: '报告标题',
      type: 'text',
      required: true,
      placeholder: '请输入报告标题'
    },
    {
      name: 'department',
      label: '部门',
      type: 'select',
      required: true,
      options: ['技术部', '产品部', '市场部']
    },
    {
      name: 'content',
      label: '报告内容',
      type: 'textarea',
      required: true,
      placeholder: '请输入详细内容'
    }
  ])
})
```

### 4. 使用缓存提升性能

```javascript
// 模板管理器自动缓存已获取的模板
const template1 = await templateManager.getTemplateById(id)  // 从数据库
const template2 = await templateManager.getTemplateById(id)  // 从缓存

// 需要时可以清空缓存
templateManager.clearCache()
```

### 5. 验证必需变量

```javascript
function validateTemplateData(template, data) {
  const variables = JSON.parse(template.variables)
  const required = variables.filter(v => v.required)

  const missing = []
  for (const v of required) {
    if (!data[v.name]) {
      missing.push(v.label || v.name)
    }
  }

  if (missing.length > 0) {
    throw new Error(`缺少必需字段: ${missing.join(', ')}`)
  }
}

// 使用
const template = await templateManager.getTemplateById(id)
const data = { title: '测试' }

try {
  validateTemplateData(template, data)
  const result = await templateManager.applyTemplate(id, data)
} catch (error) {
  console.error(error.message)
}
```

### 6. 模板版本管理

```javascript
// 创建模板时指定版本
const v1 = await templateManager.createTemplate({
  name: 'my_template',
  display_name: '我的模板',
  version: '1.0.0',
  content: '原始内容：{{content}}'
})

// 更新模板（创建新版本）
const v2 = await templateManager.createTemplate({
  name: 'my_template_v2',
  display_name: '我的模板 v2',
  version: '2.0.0',
  content: '改进的内容：{{title}}\n{{content}}'
})
```

### 7. 统计分析

```javascript
// 获取使用统计
const stats = await templateManager.getStats()

console.log(`
模板总数: ${stats.total}
内置模板: ${stats.builtin}
自定义模板: ${stats.custom}
`)

console.log('\n最常用的模板:')
stats.mostUsed.forEach((t, i) => {
  console.log(`${i + 1}. ${t.display_name} (使用${t.usage_count}次)`)
})
```

## API参考

### TemplateManager

#### 方法

**initialize()**
- 初始化模板管理器
- 返回: `Promise<void>`

**createTemplate(templateData, isBuiltin)**
- 创建模板
- 参数:
  - `templateData` (Object) - 模板数据
  - `isBuiltin` (boolean) - 是否内置模板，默认false
- 返回: `Promise<Object>` - 创建的模板

**getTemplateById(id)**
- 获取模板
- 参数: `id` (string) - 模板ID
- 返回: `Promise<Object|null>` - 模板对象或null

**getTemplates(options)**
- 查询模板
- 参数: `options` (Object)
  - `category` (string) - 分类
  - `subcategory` (string) - 子分类
  - `search` (string) - 搜索关键词
  - `includeBuiltin` (boolean) - 是否包含内置模板，默认true
  - `limit` (number) - 每页数量，默认100
  - `offset` (number) - 偏移量，默认0
- 返回: `Promise<Array>` - 模板列表

**getCategories()**
- 获取分类列表
- 返回: `Promise<Array>` - 分类列表

**updateTemplate(id, updates)**
- 更新模板
- 参数:
  - `id` (string) - 模板ID
  - `updates` (Object) - 更新数据
- 返回: `Promise<Object>` - 更新后的模板

**deleteTemplate(id)**
- 删除模板
- 参数: `id` (string) - 模板ID
- 返回: `Promise<boolean>` - 是否成功

**applyTemplate(templateId, data)**
- 应用模板
- 参数:
  - `templateId` (string) - 模板ID
  - `data` (Object) - 数据对象
- 返回: `Promise<string>` - 渲染结果

**rateTemplate(id, rating)**
- 评分模板
- 参数:
  - `id` (string) - 模板ID
  - `rating` (number) - 评分 (1-5)
- 返回: `Promise<Object>` - 更新后的模板

**getStats()**
- 获取统计信息
- 返回: `Promise<Object>` - 统计数据

**clearCache()**
- 清空缓存
- 返回: `void`

### SimpleTemplateEngine

#### 方法

**render(template, data)**
- 渲染模板
- 参数:
  - `template` (string) - 模板字符串
  - `data` (Object) - 数据对象
- 返回: `string` - 渲染结果

**extractVariables(template)**
- 提取变量
- 参数: `template` (string) - 模板字符串
- 返回: `Array<string>` - 变量名数组

**getNestedValue(obj, path)**
- 获取嵌套值
- 参数:
  - `obj` (Object) - 对象
  - `path` (string) - 路径 (如 'user.name')
- 返回: `*` - 值

---

**版本**: v1.8.0
**更新时间**: 2026-01-02
**文档状态**: 生产就绪

如有问题，请参考测试文件或提交Issue。
