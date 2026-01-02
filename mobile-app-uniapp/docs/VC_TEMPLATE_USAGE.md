# VC模板管理系统 - 使用指南

> 移动端可验证凭证(VC)模板管理系统 v2.0.0
> 基于W3C Verifiable Credentials标准

---

## 快速开始

```javascript
import { createVCTemplateManager } from '@/services/vc/vc-template-manager.js'

// 创建管理器实例
const db = uni.requireNativePlugin('SQLite')
const vcTemplateManager = createVCTemplateManager(db)

// 初始化
await vcTemplateManager.initialize()

// 使用内置模板
const claims = await vcTemplateManager.fillTemplateValues('built-in:javascript-skill', {
  skill: 'JavaScript',
  level: 'Expert',
  yearsOfExperience: 5
})
```

---

## 内置模板（6个）

| 模板ID | 名称 | 类型 | 用途 |
|--------|------|------|------|
| built-in:javascript-skill | JavaScript技能证书 | SkillCertificate | 证明编程能力 |
| built-in:education-degree | 学历证书 | EducationCredential | 证明教育背景 |
| built-in:work-experience | 工作经历 | WorkExperience | 证明工作经验 |
| built-in:trust-endorsement | 信任背书 | TrustEndorsement | 提供推荐 |
| built-in:self-declaration | 自我声明 | SelfDeclaration | 个人声明 |
| built-in:project-certification | 项目认证 ⭐ | ProjectCertification | 证明项目参与（移动端特有） |

---

## 核心功能

### 1. 创建自定义模板

```javascript
const template = await vcTemplateManager.createTemplate({
  name: '技术博客作者认证',
  type: 'BloggerCertificate',
  description: '证明技术博客作者身份',
  icon: '✍️',
  category: 'content',
  fields: [
    {
      key: 'blogUrl',
      label: '博客地址',
      type: 'text',
      required: true,
      placeholder: 'https://blog.example.com'
    },
    {
      key: 'articlesCount',
      label: '文章数量',
      type: 'number',
      required: true,
      min: 1
    },
    {
      key: 'topics',
      label: '主题领域',
      type: 'select',
      required: true,
      options: ['前端', '后端', 'AI', '区块链']
    }
  ],
  createdBy: 'did:example:123',
  isPublic: false
})
```

### 2. 填充模板

```javascript
const claims = await vcTemplateManager.fillTemplateValues(
  'built-in:education-degree',
  {
    degree: '本科',
    major: '计算机科学',
    institution: '清华大学',
    graduationYear: 2020,
    gpa: '3.8/4.0'
  }
)

// claims = {
//   degree: '本科',
//   major: '计算机科学',
//   institution: '清华大学',
//   graduationYear: 2020,
//   gpa: '3.8/4.0'
// }
```

### 3. 查询模板

```javascript
// 获取所有模板
const allTemplates = await vcTemplateManager.getAllTemplates()

// 按类型过滤
const skillTemplates = await vcTemplateManager.getAllTemplates({
  type: 'SkillCertificate'
})

// 按分类过滤
const educationTemplates = await vcTemplateManager.getAllTemplates({
  category: 'education'
})

// 按创建者过滤
const myTemplates = await vcTemplateManager.getAllTemplates({
  createdBy: 'did:example:123'
})
```

### 4. 搜索模板

```javascript
// 搜索会匹配：名称、描述、类型、分类
const results = await vcTemplateManager.searchTemplates('JavaScript')
```

### 5. 导入导出

```javascript
// 导出单个模板
const exportData = await vcTemplateManager.exportTemplate(templateId)

// 批量导出
const batchExport = await vcTemplateManager.exportTemplates([id1, id2, id3])

// 导入模板
const result = await vcTemplateManager.importTemplate(
  exportData,
  'did:example:123',
  { overwrite: false }
)
```

### 6. 统计信息

```javascript
const stats = await vcTemplateManager.getStatistics()

// stats = {
//   builtIn: 6,
//   custom: 10,
//   public: 5,
//   total: 16,
//   byType: {
//     SkillCertificate: 3,
//     EducationCredential: 2,
//     ...
//   }
// }
```

---

## 字段类型

| 类型 | 说明 | 示例 |
|------|------|------|
| text | 文本输入 | 姓名、地址 |
| number | 数字输入 | 年龄、分数 |
| select | 下拉选择 | 学位、级别 |
| textarea | 多行文本 | 描述、内容 |
| month | 月份选择 | 2020-01 |
| date | 日期选择 | 2020-01-01 |

---

## API参考

### 核心方法

- `initialize()` - 初始化管理器
- `getAllTemplates(filters)` - 获取所有模板
- `getTemplateById(id)` - 根据ID获取模板
- `createTemplate(templateData)` - 创建自定义模板
- `updateTemplate(id, updates)` - 更新模板
- `deleteTemplate(id)` - 删除模板（软删除）
- `fillTemplateValues(templateId, values)` - 填充模板数据
- `searchTemplates(query)` - 搜索模板
- `getStatistics()` - 获取统计信息
- `exportTemplate(id)` - 导出模板
- `importTemplate(data, createdBy, options)` - 导入模板
- `rateTemplate(id, rating)` - 评分模板
- `incrementUsageCount(id)` - 增加使用次数

---

## 最佳实践

1. **模板命名**: 使用清晰描述性的名称
2. **字段设计**: 合理设置必填项和默认值
3. **类型选择**: 选择合适的凭证类型
4. **验证规则**: 为number类型设置min/max
5. **缓存利用**: 频繁访问的模板会自动缓存

---

## 常见问题

### Q1: 如何备份所有自定义模板？

```javascript
const myTemplates = await vcTemplateManager.getAllTemplates({
  createdBy: myDID
})

const ids = myTemplates
  .filter(t => !t.isBuiltIn)
  .map(t => t.id)

const backup = await vcTemplateManager.exportTemplates(ids)

// 保存backup到文件
```

### Q2: 内置模板可以修改吗？

不可以。内置模板是只读的，但可以基于内置模板创建自定义版本。

### Q3: 如何实现模板共享？

将模板导出为JSON，通过二维码或文件分享给其他用户导入。

---

更多信息请参考完整报告: `MOBILE_VC_TEMPLATE_COMPLETE_REPORT.md`
