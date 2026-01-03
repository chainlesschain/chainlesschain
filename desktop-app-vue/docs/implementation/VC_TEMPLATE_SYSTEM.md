# 可验证凭证模板系统实现文档

**完成时间**: 2025-12-18
**版本**: v0.7.2

---

## ✅ 概述

可验证凭证模板系统为用户提供了一种简化的方式来创建可验证凭证。通过预定义的模板和动态表单生成，用户无需手动编写 JSON 格式的声明，而是通过直观的表单界面填写信息。

### 核心特性

- ✅ **5 个内置模板**：涵盖常见凭证类型
- ✅ **自定义模板**：用户可创建自己的模板
- ✅ **动态表单生成**：根据模板字段自动生成表单
- ✅ **字段类型支持**：文本、数字、选择、日期、多行文本
- ✅ **字段验证**：必填字段、最小/最大值、选项列表
- ✅ **默认值**：预填充常用值
- ✅ **使用统计**：追踪模板使用频率
- ✅ **模板导入/导出**：JSON 格式分享和备份 ✨ NEW
- ✅ **批量导出**：一次性导出多个模板 ✨ NEW
- ✅ **模板管理界面**：集中管理所有自定义模板 ✨ NEW

---

## 🏗️ 架构设计

### 1. 模板数据模型

```javascript
{
  id: 'built-in:javascript-skill',  // 模板唯一标识
  name: 'JavaScript 技能证书',       // 模板名称
  type: 'SkillCertificate',          // 凭证类型
  description: '用于证明 JavaScript 编程能力',  // 描述
  icon: '🔧',                         // 显示图标
  isBuiltIn: true,                    // 是否内置模板
  fields: [                           // 字段定义数组
    {
      key: 'skill',                   // 字段键名
      label: '技能名称',              // 字段标签
      type: 'text',                   // 字段类型
      required: true,                 // 是否必填
      defaultValue: 'JavaScript',     // 默认值
      placeholder: '例如: JavaScript' // 占位提示
    },
    // ... 更多字段
  ]
}
```

### 2. 支持的字段类型

| 类型 | 说明 | UI 组件 | 参数 |
|------|------|---------|------|
| `text` | 单行文本 | `<a-input>` | `placeholder` |
| `number` | 数字输入 | `<a-input-number>` | `min`, `max` |
| `select` | 下拉选择 | `<a-select>` | `options: []` |
| `month` | 月份选择 | `<input type="month">` | `placeholder` |
| `textarea` | 多行文本 | `<a-textarea>` | `placeholder`, `rows` |

### 3. 数据库表结构

```sql
CREATE TABLE vc_templates (
  id TEXT PRIMARY KEY,              -- 模板 ID (custom:uuid)
  name TEXT NOT NULL,               -- 模板名称
  type TEXT NOT NULL,               -- 凭证类型
  description TEXT,                 -- 模板描述
  icon TEXT,                        -- 图标（emoji）
  fields TEXT NOT NULL,             -- 字段定义 (JSON)
  created_by_did TEXT NOT NULL,    -- 创建者 DID
  is_public INTEGER DEFAULT 0,     -- 是否公开
  usage_count INTEGER DEFAULT 0,   -- 使用次数
  created_at INTEGER NOT NULL      -- 创建时间
);

-- 索引
CREATE INDEX idx_template_type ON vc_templates(type);
CREATE INDEX idx_template_creator ON vc_templates(created_by_did);
CREATE INDEX idx_template_public ON vc_templates(is_public);
```

---

## 📦 内置模板

### 1. JavaScript 技能证书 (`javascript-skill`)

**凭证类型**: `SkillCertificate`
**图标**: 🔧

**字段**:
- `skill` (文本, 必填): 技能名称，默认 "JavaScript"
- `level` (选择, 必填): 熟练程度 - Beginner/Intermediate/Advanced/Expert
- `yearsOfExperience` (数字, 必填): 工作年限，范围 0-50
- `certifications` (文本, 可选): 相关认证

### 2. 学历证书 (`education-degree`)

**凭证类型**: `EducationCredential`
**图标**: 🎓

**字段**:
- `degree` (选择, 必填): 学位 - 高中/专科/本科/硕士/博士
- `major` (文本, 必填): 专业
- `institution` (文本, 必填): 学校
- `graduationYear` (数字, 必填): 毕业年份，范围 1950-当前年份+10
- `gpa` (文本, 可选): GPA

### 3. 工作经历 (`work-experience`)

**凭证类型**: `WorkExperience`
**图标**: 💼

**字段**:
- `position` (文本, 必填): 职位
- `company` (文本, 必填): 公司
- `startDate` (月份, 必填): 开始时间
- `endDate` (月份, 可选): 结束时间（留空表示至今）
- `responsibilities` (多行文本, 必填): 工作职责
- `achievements` (多行文本, 可选): 主要成就

### 4. 信任背书 (`trust-endorsement`)

**凭证类型**: `TrustEndorsement`
**图标**: 🤝

**字段**:
- `trustLevel` (选择, 必填): 信任级别 - Low/Medium/High/Very High
- `relationship` (选择, 必填): 关系 - 同事/朋友/合作伙伴/客户/导师/学生
- `endorsement` (多行文本, 必填): 背书内容
- `duration` (文本, 可选): 认识时长

### 5. 自我声明 (`self-declaration`)

**凭证类型**: `SelfDeclaration`
**图标**: 📝

**字段**:
- `statement` (多行文本, 必填): 声明内容
- `category` (选择, 可选): 类别 - 职业/兴趣/技能/观点/其他
- `details` (多行文本, 可选): 补充说明

---

## 🔧 技术实现

### 1. 模板管理器 (`vc-template-manager.js`)

#### 核心方法

```javascript
class VCTemplateManager {
  // 获取所有模板（内置 + 自定义）
  getAllTemplates(filters = {}) {
    // 返回过滤后的模板列表
  }

  // 根据 ID 获取模板
  getTemplateById(id) {
    // 内置模板从 BUILT_IN_TEMPLATES 获取
    // 自定义模板从数据库查询
  }

  // 创建自定义模板
  async createTemplate(templateData) {
    // 生成 ID: custom:uuid
    // 保存到数据库
  }

  // 更新模板（仅自定义模板）
  async updateTemplate(id, updates) {
    // 不能更新内置模板
  }

  // 删除模板（仅自定义模板）
  async deleteTemplate(id) {
    // 不能删除内置模板
  }

  // 填充模板值
  fillTemplateValues(templateId, values) {
    // 验证必填字段
    // 使用用户值或默认值
    // 返回 claims 对象
  }

  // 增加使用次数
  async incrementUsageCount(id) {
    // 更新 usage_count
  }

  // 获取统计信息
  getStatistics() {
    return {
      builtIn: 5,    // 内置模板数量
      custom: 0,     // 自定义模板数量
      public: 0,     // 公开模板数量
      total: 5       // 总数
    };
  }
}
```

### 2. IPC 处理器 (8 个)

| IPC 通道 | 功能 | 参数 |
|---------|------|------|
| `vc-template:get-all` | 获取所有模板 | `filters` |
| `vc-template:get` | 获取单个模板 | `id` |
| `vc-template:create` | 创建模板 | `templateData` |
| `vc-template:update` | 更新模板 | `id`, `updates` |
| `vc-template:delete` | 删除模板 | `id` |
| `vc-template:fill-values` | 填充模板值 | `templateId`, `values` |
| `vc-template:increment-usage` | 增加使用次数 | `id` |
| `vc-template:get-statistics` | 获取统计 | 无 |

### 3. Preload API

```javascript
window.electronAPI.vcTemplate = {
  getAll: (filters) => ipcRenderer.invoke('vc-template:get-all', filters),
  get: (id) => ipcRenderer.invoke('vc-template:get', id),
  create: (templateData) => ipcRenderer.invoke('vc-template:create', templateData),
  update: (id, updates) => ipcRenderer.invoke('vc-template:update', id, updates),
  delete: (id) => ipcRenderer.invoke('vc-template:delete', id),
  fillValues: (templateId, values) => ipcRenderer.invoke('vc-template:fill-values', templateId, values),
  incrementUsage: (id) => ipcRenderer.invoke('vc-template:increment-usage', id),
  getStatistics: () => ipcRenderer.invoke('vc-template:get-statistics'),
};
```

### 4. UI 集成 (`VCManagement.vue`)

#### 创建模式切换

```vue
<a-radio-group v-model:value="createMode">
  <a-radio-button value="template">使用模板</a-radio-button>
  <a-radio-button value="manual">手动输入</a-radio-button>
</a-radio-group>
```

#### 模板选择器

```vue
<a-select v-model:value="selectedTemplateId" @change="handleTemplateChange">
  <a-select-opt-group label="内置模板">
    <a-select-option v-for="tpl in builtInTemplates" :value="tpl.id">
      {{ tpl.icon }} {{ tpl.name }}
    </a-select-option>
  </a-select-opt-group>
  <a-select-opt-group label="自定义模板">
    <!-- 自定义模板列表 -->
  </a-select-opt-group>
</a-select>
```

#### 动态表单生成

```vue
<a-form-item
  v-for="field in selectedTemplate.fields"
  :key="field.key"
  :label="field.label"
  :required="field.required"
>
  <!-- 根据 field.type 渲染不同的输入组件 -->
  <a-input v-if="field.type === 'text'" v-model:value="templateValues[field.key]" />
  <a-input-number v-else-if="field.type === 'number'" ... />
  <a-select v-else-if="field.type === 'select'" ... />
  <a-textarea v-else-if="field.type === 'textarea'" ... />
</a-form-item>
```

#### 关键逻辑

```javascript
// 处理模板选择
async function handleTemplateChange(templateId) {
  const template = await window.electronAPI.vcTemplate.get(templateId);
  selectedTemplate.value = template;

  // 设置默认值
  template.fields.forEach(field => {
    if (field.defaultValue !== undefined) {
      templateValues[field.key] = field.defaultValue;
    }
  });

  // 自动设置凭证类型
  createForm.type = template.type;
}

// 创建凭证
async function handleCreateCredential() {
  if (createMode.value === 'template') {
    // 使用模板填充值
    claims = await window.electronAPI.vcTemplate.fillValues(
      selectedTemplateId.value,
      templateValues
    );

    // 增加使用次数
    await window.electronAPI.vcTemplate.incrementUsage(selectedTemplateId.value);
  } else {
    // 手动输入 JSON
    claims = JSON.parse(createForm.claimsText);
  }

  // 创建凭证
  await window.electronAPI.vc.create({ type, issuerDID, subjectDID, claims, ... });
}
```

---

## 📖 使用指南

### 1. 使用内置模板创建凭证

#### 步骤

1. 点击"可验证凭证"页面的"颁发凭证"按钮
2. 选择"使用模板"模式（默认）
3. 从下拉列表选择模板，例如"🔧 JavaScript 技能证书"
4. 系统自动显示该模板的说明
5. 填写动态生成的表单字段：
   - 技能名称: JavaScript
   - 熟练程度: Expert
   - 工作年限: 5
   - 相关认证: AWS Certified Developer
6. 填写主体 DID（接收凭证的人）
7. 设置有效期（可选）
8. 点击"确定"完成颁发

#### 示例代码

```javascript
// 1. 加载模板
const templates = await window.electronAPI.vcTemplate.getAll();

// 2. 选择模板
const templateId = 'built-in:javascript-skill';
const template = await window.electronAPI.vcTemplate.get(templateId);

// 3. 填写表单值
const values = {
  skill: 'JavaScript',
  level: 'Expert',
  yearsOfExperience: 5,
  certifications: 'AWS Certified Developer'
};

// 4. 填充模板
const claims = await window.electronAPI.vcTemplate.fillValues(templateId, values);

// 5. 创建凭证
await window.electronAPI.vc.create({
  type: 'SkillCertificate',
  issuerDID: 'did:chainlesschain:issuer123...',
  subjectDID: 'did:chainlesschain:subject456...',
  claims,
  expiresIn: 365 * 24 * 60 * 60 * 1000  // 1 年
});
```

### 2. 创建自定义模板

```javascript
const templateData = {
  name: '自定义技能证书',
  type: 'SkillCertificate',
  description: '用于证明特定领域的技能',
  icon: '⚡',
  createdBy: 'did:chainlesschain:creator...',
  isPublic: false,
  fields: [
    {
      key: 'skillName',
      label: '技能名称',
      type: 'text',
      required: true,
      placeholder: '例如: Python编程'
    },
    {
      key: 'proficiency',
      label: '熟练度',
      type: 'select',
      required: true,
      options: ['初级', '中级', '高级', '专家'],
      defaultValue: '中级'
    },
    {
      key: 'experience',
      label: '经验年限',
      type: 'number',
      required: true,
      min: 0,
      max: 30
    }
  ]
};

const template = await window.electronAPI.vcTemplate.create(templateData);
console.log('模板已创建:', template.id);
```

### 3. 手动输入模式

如果不想使用模板，可以切换到"手动输入"模式：

1. 选择"手动输入"模式
2. 选择凭证类型
3. 在文本框中输入 JSON 格式的声明：
   ```json
   {
     "skill": "JavaScript",
     "level": "Expert",
     "yearsOfExperience": 5
   }
   ```
4. 填写主体 DID 和有效期
5. 点击"确定"

### 4. 导出模板 ✨ NEW

#### 导出单个模板

1. 点击"模板管理"按钮打开模板管理界面
2. 在模板列表中找到要导出的模板
3. 点击该模板行的"导出"按钮
4. 系统自动下载 JSON 文件，文件名格式：`template-{模板名称}.json`

#### 批量导出模板

1. 在模板管理界面中，勾选要导出的模板（支持多选）
2. 点击顶部的"导出选中"按钮
3. 系统下载包含所有选中模板的 JSON 文件，文件名格式：`templates-{数量}.json`

#### 导出的 JSON 格式

**单个模板导出格式**:
```json
{
  "version": "1.0",
  "exportedAt": 1703001234567,
  "template": {
    "name": "自定义技能证书",
    "type": "SkillCertificate",
    "description": "用于证明特定领域的技能",
    "icon": "⚡",
    "fields": [
      {
        "key": "skillName",
        "label": "技能名称",
        "type": "text",
        "required": true,
        "placeholder": "例如: Python编程"
      }
      // ... 更多字段
    ]
  }
}
```

**批量导出格式**:
```json
{
  "version": "1.0",
  "exportedAt": 1703001234567,
  "count": 3,
  "templates": [
    {
      "name": "模板1",
      "type": "SkillCertificate",
      // ... 模板定义
    },
    {
      "name": "模板2",
      "type": "EducationCredential",
      // ... 模板定义
    }
    // ... 更多模板
  ]
}
```

### 5. 导入模板 ✨ NEW

#### 导入步骤

1. 点击"模板管理"按钮打开模板管理界面
2. 点击"导入模板"按钮
3. 选择要导入的 JSON 文件（支持单个或批量导出的文件）
4. 系统显示确认对话框，展示即将导入的模板信息
5. 点击"导入"确认

#### 导入结果

导入完成后，系统会切换到"导入结果"标签页，显示：
- **成功数量**：成功导入的模板数量
- **失败数量**：导入失败的模板数量
- **成功列表**：显示所有成功导入的模板名称
- **失败详情**：显示失败的模板名称和具体错误原因

#### 导入冲突处理

如果导入的模板与现有模板同名，系统会：
1. 默认拒绝导入，提示模板已存在
2. 可以通过 API 的 `overwrite` 选项启用覆盖模式

#### API 示例

```javascript
// 导出单个模板
const exportData = await window.electronAPI.vcTemplate.export('template-id');
console.log(exportData);

// 批量导出
const exportData = await window.electronAPI.vcTemplate.exportMultiple([
  'template-id-1',
  'template-id-2'
]);
console.log(exportData);

// 导入模板（不覆盖）
const result = await window.electronAPI.vcTemplate.import(
  importData,
  currentDID,
  { overwrite: false }
);
console.log(result);
// {
//   success: 2,
//   failed: 1,
//   errors: [{ template: '模板名', error: '模板已存在' }],
//   imported: ['模板1', '模板2']
// }

// 导入模板（覆盖模式）
const result = await window.electronAPI.vcTemplate.import(
  importData,
  currentDID,
  { overwrite: true }  // 允许覆盖同名模板
);
```

### 6. 模板管理界面 ✨ NEW

#### 功能特性

- **模板列表**：展示所有自定义模板
- **选择导出**：支持批量选择和导出
- **单个导出**：快速导出单个模板
- **导入功能**：从 JSON 文件导入模板
- **删除功能**：删除不需要的自定义模板
- **导入结果**：查看详细的导入报告

#### 表格列

| 列名 | 说明 |
|------|------|
| 模板名称 | 显示模板图标和名称 |
| 凭证类型 | 对应的凭证类型标签 |
| 字段数量 | 模板包含的字段数 |
| 使用次数 | 该模板被使用的次数 |
| 操作 | 导出和删除按钮 |

---

## 🎯 高级功能

### 1. 模板过滤

```javascript
// 按类型过滤
const skillTemplates = await window.electronAPI.vcTemplate.getAll({
  type: 'SkillCertificate'
});

// 按创建者过滤
const myTemplates = await window.electronAPI.vcTemplate.getAll({
  createdBy: 'did:chainlesschain:me...'
});

// 只获取公开模板
const publicTemplates = await window.electronAPI.vcTemplate.getAll({
  isPublic: true
});
```

### 2. 模板统计

```javascript
const stats = await window.electronAPI.vcTemplate.getStatistics();
console.log(stats);
// {
//   builtIn: 5,
//   custom: 3,
//   public: 1,
//   total: 8
// }
```

### 3. 更新自定义模板

```javascript
await window.electronAPI.vcTemplate.update('custom:123...', {
  name: '更新后的名称',
  description: '新的描述',
  isPublic: true
});
```

### 4. 删除自定义模板

```javascript
await window.electronAPI.vcTemplate.delete('custom:123...');
```

---

## 🔒 安全考虑

### 1. 内置模板保护

- ✅ 内置模板不能被修改或删除
- ✅ ID 前缀 `built-in:` 受保护
- ✅ 更新和删除操作会检查模板类型

### 2. 字段验证

- ✅ 必填字段验证
- ✅ 数字范围验证 (min/max)
- ✅ 选项列表验证（只能选择预定义的选项）
- ✅ 类型检查（文本、数字等）

### 3. 权限控制

- ✅ 只有创建者可以修改自定义模板
- ✅ 公开模板可被所有人查看和使用
- ✅ 私有模板只有创建者可访问

---

## 📊 性能优化

### 1. 缓存策略

- 内置模板存储在内存中（`BUILT_IN_TEMPLATES` 常量）
- 自定义模板从数据库按需加载
- UI 层缓存模板列表，避免重复查询

### 2. 数据库索引

```sql
-- 类型索引（用于按类型过滤）
CREATE INDEX idx_template_type ON vc_templates(type);

-- 创建者索引（用于按创建者过滤）
CREATE INDEX idx_template_creator ON vc_templates(created_by_did);

-- 公开状态索引（用于查询公开模板）
CREATE INDEX idx_template_public ON vc_templates(is_public);
```

### 3. 批量加载

```javascript
// UI 初始化时一次性加载所有模板
onMounted(async () => {
  await loadTemplates();
});
```

---

## 🚀 后续扩展

### 短期 (1-2 周)

- [x] ~~**模板导入/导出**：JSON 格式的模板文件~~ ✅ 已完成 (v0.7.2)
- [ ] **模板搜索**：按名称、描述搜索
- [ ] **模板预览**：查看模板生成的凭证示例
- [ ] **模板分类**：标签系统
- [ ] **模板分享链接**：生成可分享的模板链接

### 中期 (2-4 周)

- [ ] **模板市场**：社区共享模板
- [ ] **模板版本控制**：追踪模板变更
- [ ] **条件字段**：根据其他字段显示/隐藏
- [ ] **字段验证规则**：正则表达式、自定义函数

### 长期 (1-3 月)

- [ ] **多语言模板**：国际化支持
- [ ] **模板继承**：基于现有模板创建变体
- [ ] **可视化模板编辑器**：拖拽式界面
- [ ] **AI 辅助模板生成**：根据描述自动生成模板

---

## 🎉 总结

### 已实现功能

- ✅ **模板管理器**：完整的 CRUD 操作
- ✅ **5 个内置模板**：涵盖常见场景
- ✅ **动态表单生成**：支持 5 种字段类型
- ✅ **字段验证**：必填、范围、选项
- ✅ **UI 集成**：无缝融入凭证创建流程
- ✅ **11 个 IPC 处理器**：完整的 API 支持（含导入/导出）
- ✅ **数据库支持**：自定义模板持久化
- ✅ **导入/导出功能**：JSON 格式分享和备份 ✨ NEW
- ✅ **批量操作**：支持批量导出多个模板 ✨ NEW
- ✅ **模板管理界面**：集中管理和操作模板 ✨ NEW

### 技术亮点

- 🏆 **声明式模板定义**：JSON 配置即可创建模板
- 🎨 **自动 UI 生成**：根据字段定义动态渲染表单
- 🔐 **类型安全**：TypeScript 风格的字段类型
- 📊 **使用统计**：追踪流行模板
- 🌐 **扩展性强**：易于添加新字段类型和验证规则

### 应用价值

1. **降低使用门槛**：无需了解 W3C VC 标准细节
2. **提高效率**：预填充默认值，减少输入
3. **减少错误**：字段验证确保数据正确性
4. **标准化**：统一凭证格式，便于解析和验证
5. **可定制**：用户可创建专属模板

---

**下一步建议**：添加模板搜索功能和模板预览功能，进一步提升用户体验。

*文档版本: v0.7.2*
*更新时间: 2025-12-18*

---

## 📋 更新日志

### v0.7.2 (2025-12-18)

**新增功能**:
- ✅ 模板导出功能（单个/批量）
- ✅ 模板导入功能（支持单个和批量）
- ✅ 模板管理界面
- ✅ 导入结果详情展示
- ✅ 导入冲突检测和处理
- ✅ JSON 格式验证
- ✅ 3 个新的 IPC 处理器

**技术实现**:
- `exportTemplate(id)` - 导出单个模板
- `exportTemplates(ids)` - 批量导出模板
- `importTemplate(data, createdBy, options)` - 导入模板
- `_importSingleTemplate(data, createdBy, options)` - 内部导入方法

**UI 改进**:
- 新增"模板管理"按钮
- 模板列表表格（支持多选）
- 导入/导出操作按钮
- 导入结果标签页
- 文件选择器集成

### v0.7.1 (2025-12-18)

**初始版本**:
- 5 个内置模板
- 动态表单生成
- 模板 CRUD 操作
- 8 个 IPC 处理器
- 完整文档
