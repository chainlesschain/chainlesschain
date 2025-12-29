# 模板组件系统实施计划

## 项目概述

为 ChainlessChain 桌面应用添加完整的项目模板浏览和使用功能，集成到 HomePage 和 ProjectsPage 中。

**目标**：让用户能够快速浏览13个内置模板，填写模板变量，一键创建项目。

**策略**：MVP快速上线 → 后续迭代高级功能

---

## 系统架构

### 组件层级结构

```
HomePage.vue / ProjectsPage.vue
├── TemplateGallery.vue (模板网格容器)
│   ├── TemplateCard.vue (模板卡片 × N)
│   └── Empty state (无模板时)
│
└── TemplateVariableModal.vue (点击卡片后弹出)
    ├── 变量表单 (动态生成)
    ├── 实时预览面板 (可选)
    └── 创建/取消按钮
```

### 数据流

```
IPC API (window.electronAPI.template.*)
  ↓
Pinia Store (useTemplateStore)
  ↓
TemplateGallery (过滤和展示)
  ↓
TemplateCard (用户点击)
  ↓
TemplateVariableModal (填写变量)
  ↓
ProjectStore.createProjectStream() (创建项目)
```

---

## MVP阶段 (Phase 1) - 核心功能

### 1. Pinia Store - `useTemplateStore`

**文件路径**: `desktop-app-vue/src/renderer/stores/template.js`

**State**:
```javascript
{
  templates: [],           // 所有模板列表
  loading: false,          // 加载状态
  currentCategory: null,   // 当前选中的分类
  currentSubcategory: null // 当前选中的子分类
}
```

**Actions**:
```javascript
// 加载所有模板
async fetchTemplates(filters = {})

// 根据当前选择的分类过滤模板
async loadTemplatesByCategory(category, subcategory)

// 记录模板使用
async recordUsage(templateId, projectId, variables)
```

**Getters**:
```javascript
// 根据分类过滤的模板
filteredTemplates(state)

// 按分类分组的模板
templatesByCategory(state)
```

---

### 2. TemplateCard 组件

**文件路径**: `desktop-app-vue/src/renderer/components/templates/TemplateCard.vue`

**Props**:
```typescript
{
  template: Object,      // 模板对象 { id, display_name, description, icon, cover_image, category, usage_count, rating }
  compact: Boolean       // 紧凑模式（可选）
}
```

**UI结构**:
```html
<div class="template-card" @click="handleClick">
  <!-- 封面图或占位符 -->
  <div class="card-cover">
    <img v-if="template.cover_image" :src="template.cover_image" />
    <div v-else class="placeholder-icon">{{ template.icon }}</div>
  </div>

  <!-- 卡片内容 -->
  <div class="card-content">
    <h4 class="card-title">{{ template.display_name }}</h4>
    <p class="card-description">{{ template.description }}</p>

    <!-- 元数据 -->
    <div class="card-meta">
      <span class="usage-count">
        <FireOutlined /> {{ template.usage_count || 0 }}次使用
      </span>
      <span v-if="template.rating" class="rating">
        <StarFilled /> {{ template.rating.toFixed(1) }}
      </span>
    </div>

    <!-- 操作按钮 -->
    <a-button type="primary" class="use-btn" @click.stop="handleUse">
      使用模板
    </a-button>
  </div>
</div>
```

**Events**:
```javascript
emit('use', template)  // 点击"使用模板"按钮
```

**样式要点**:
- 卡片大小: 260px宽，自动高度
- 悬停效果: 轻微上浮 + 阴影增强
- 圆角: 12px
- 封面高度: 140-160px
- 紫色渐变主题色

---

### 3. TemplateGallery 组件

**文件路径**: `desktop-app-vue/src/renderer/components/templates/TemplateGallery.vue`

**Props**:
```typescript
{
  category: String,      // 当前选中的项目类型 (write/ppt/design/excel/web/podcast)
  subcategory: String    // 当前选中的子分类 (office/creative/social等)
}
```

**功能**:
1. 监听 `category` 和 `subcategory` 变化
2. 调用 `templateStore.loadTemplatesByCategory()`
3. 展示过滤后的模板网格
4. 处理空状态（无模板时）
5. 处理加载状态

**UI结构**:
```html
<div class="template-gallery">
  <!-- 加载状态 -->
  <a-spin v-if="templateStore.loading" />

  <!-- 模板网格 -->
  <div v-else-if="filteredTemplates.length > 0" class="template-grid">
    <TemplateCard
      v-for="template in filteredTemplates"
      :key="template.id"
      :template="template"
      @use="handleTemplateUse"
    />
  </div>

  <!-- 空状态 -->
  <a-empty v-else description="暂无该分类的模板">
    <template #extra>
      <a-button type="primary" @click="handleCreateCustom">
        创建自定义项目
      </a-button>
    </template>
  </a-empty>
</div>
```

**Methods**:
```javascript
// 处理模板使用
function handleTemplateUse(template) {
  selectedTemplate.value = template
  showVariableModal.value = true
}

// 监听分类变化
watch([() => props.category, () => props.subcategory], async ([cat, subcat]) => {
  await templateStore.loadTemplatesByCategory(cat, subcat)
})
```

**样式**:
```scss
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 20px;
  padding: 24px 0;
}
```

---

### 4. TemplateVariableModal 组件

**文件路径**: `desktop-app-vue/src/renderer/components/templates/TemplateVariableModal.vue`

**Props**:
```typescript
{
  visible: Boolean,
  template: Object       // 包含 variables_schema, prompt_template
}
```

**核心功能**:
1. **动态表单生成**: 解析 `template.variables_schema`，生成对应的表单控件
2. **变量类型支持**:
   - `string` → a-input
   - `number` → a-input-number (支持 min/max)
   - `select` → a-select (使用 options)
   - `array` → a-select (mode="tags")
   - `boolean` → a-switch
3. **表单验证**: 处理 `required` 字段，显示错误提示
4. **提交处理**: 验证通过后调用项目创建流程

**UI结构**:
```html
<a-modal
  v-model:open="visible"
  :title="`使用模板：${template?.display_name}`"
  width="700px"
  @ok="handleSubmit"
  @cancel="handleCancel"
>
  <a-form ref="formRef" :model="formData" layout="vertical">
    <!-- 动态生成的表单项 -->
    <template v-for="variable in template.variables_schema" :key="variable.name">
      <!-- String 类型 -->
      <a-form-item
        v-if="variable.type === 'string'"
        :label="variable.label"
        :name="variable.name"
        :rules="[{ required: variable.required, message: `请输入${variable.label}` }]"
      >
        <a-input
          v-model:value="formData[variable.name]"
          :placeholder="variable.placeholder"
        />
      </a-form-item>

      <!-- Number 类型 -->
      <a-form-item
        v-if="variable.type === 'number'"
        :label="variable.label"
        :name="variable.name"
      >
        <a-input-number
          v-model:value="formData[variable.name]"
          :min="variable.min"
          :max="variable.max"
          :placeholder="variable.placeholder"
          style="width: 100%"
        />
      </a-form-item>

      <!-- Select 类型 -->
      <a-form-item
        v-if="variable.type === 'select'"
        :label="variable.label"
        :name="variable.name"
      >
        <a-select v-model:value="formData[variable.name]">
          <a-select-option
            v-for="option in variable.options"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </a-select-option>
        </a-select>
      </a-form-item>

      <!-- Array 类型 -->
      <a-form-item
        v-if="variable.type === 'array'"
        :label="variable.label"
        :name="variable.name"
      >
        <a-select
          v-model:value="formData[variable.name]"
          mode="tags"
          :placeholder="variable.placeholder"
        />
      </a-form-item>
    </template>
  </a-form>

  <template #footer>
    <a-button @click="handleCancel">取消</a-button>
    <a-button type="primary" :loading="creating" @click="handleSubmit">
      创建项目
    </a-button>
  </template>
</a-modal>
```

**Methods**:
```javascript
// 初始化表单（使用默认值）
function initFormData() {
  const data = {}
  template.value.variables_schema?.forEach(variable => {
    data[variable.name] = variable.default || (variable.type === 'array' ? [] : '')
  })
  formData.value = data
}

// 提交表单
async function handleSubmit() {
  try {
    // 1. 验证表单
    await formRef.value.validate()

    // 2. 渲染 prompt
    const renderedPrompt = await window.electronAPI.template.renderPrompt(
      template.value.id,
      formData.value
    )

    // 3. 创建项目
    creating.value = true
    const projectStore = useProjectStore()
    const project = await projectStore.createProjectStream({
      name: formData.value[template.value.variables_schema[0]?.name] || template.value.display_name,
      userPrompt: renderedPrompt,
      // ... 其他参数
    })

    // 4. 记录使用
    const templateStore = useTemplateStore()
    await templateStore.recordUsage(template.value.id, project.id, formData.value)

    // 5. 关闭对话框并提示
    emit('success', project)
    visible.value = false
    message.success('项目创建成功！')

  } catch (error) {
    message.error(error.message || '创建失败')
  } finally {
    creating.value = false
  }
}
```

---

## 集成到现有页面

### HomePage.vue 集成

**修改位置**: Line ~150-180 (模板网格区域)

**修改内容**:
```vue
<!-- 当前代码（空状态） -->
<div class="templates-grid">
  <a-empty description="暂无模板" />
</div>

<!-- 修改为 -->
<TemplateGallery
  :category="selectedType"
  :subcategory="activeCategory"
/>

<!-- 添加模态对话框 -->
<TemplateVariableModal
  :visible="showTemplateModal"
  :template="selectedTemplate"
  @success="handleTemplateSuccess"
  @cancel="showTemplateModal = false"
/>
```

**导入组件**:
```javascript
import TemplateGallery from '@/components/templates/TemplateGallery.vue'
import TemplateVariableModal from '@/components/templates/TemplateVariableModal.vue'
import { useTemplateStore } from '@/stores/template'

const templateStore = useTemplateStore()
const showTemplateModal = ref(false)
const selectedTemplate = ref(null)

// 处理模板创建成功
function handleTemplateSuccess(project) {
  router.push(`/projects/${project.id}`)
}
```

### ProjectsPage.vue 集成

**修改位置**: Line ~200-230 (模板网格区域)

**修改内容**: 与 HomePage 相同

---

## 文件清单

### 需要创建的文件

1. `desktop-app-vue/src/renderer/stores/template.js` (Pinia Store)
2. `desktop-app-vue/src/renderer/components/templates/TemplateCard.vue`
3. `desktop-app-vue/src/renderer/components/templates/TemplateGallery.vue`
4. `desktop-app-vue/src/renderer/components/templates/TemplateVariableModal.vue`

### 需要修改的文件

1. `desktop-app-vue/src/renderer/pages/HomePage.vue` (集成 TemplateGallery, Line ~150-180)
2. `desktop-app-vue/src/renderer/pages/projects/ProjectsPage.vue` (集成 TemplateGallery, Line ~200-230)

---

## MVP 实施步骤

### Step 1: 创建 Pinia Store (30分钟)
- 创建 `template.js` store
- 实现 `fetchTemplates`, `loadTemplatesByCategory`, `recordUsage`
- 添加 `filteredTemplates` getter

### Step 2: 创建 TemplateCard 组件 (45分钟)
- 实现卡片UI（封面、标题、描述、元数据）
- 添加悬停效果和点击事件
- 处理图标占位符（无 cover_image 时）

### Step 3: 创建 TemplateGallery 组件 (30分钟)
- 实现网格布局
- 监听 category/subcategory props
- 处理加载和空状态
- 集成 TemplateCard

### Step 4: 创建 TemplateVariableModal 组件 (90分钟)
- 实现动态表单生成逻辑
- 支持所有变量类型 (string, number, select, array)
- 实现表单验证
- 实现提交流程（渲染 → 创建项目 → 记录使用）

### Step 5: 集成到 HomePage (20分钟)
- 导入组件
- 替换空白模板区域
- 测试交互流程

### Step 6: 集成到 ProjectsPage (20分钟)
- 同 Step 5

### Step 7: 测试和优化 (30分钟)
- 测试所有13个模板
- 测试不同变量类型组合
- 优化加载性能
- 修复样式问题

**MVP 总耗时**: 约 4-5 小时

---

## Phase 2 - 高级功能（后续迭代）

### 1. 搜索和过滤功能

**组件**: `TemplateSearchBar.vue`

**功能**:
- 关键词搜索（调用 `template.search` API）
- 多维度过滤：按分类、标签、评分、使用量
- 排序选项：最新、最热、评分最高

**集成位置**: TemplateGallery 顶部

### 2. 评分和收藏功能

**组件**: `TemplateRating.vue`, `TemplateFavorites.vue`

**功能**:
- 5星评分系统（使用 `template.rate` API）
- 收藏模板到"我的收藏"
- 显示其他用户的评分统计

**数据扩展**:
- Store 添加 `favorites` state
- 新增 `addFavorite`, `removeFavorite` actions

### 3. 实时预览功能

**组件扩展**: TemplateVariableModal

**功能**:
- 右侧面板显示渲染后的 prompt
- 表单值变化时实时调用 `template.renderPrompt`
- Markdown 格式化显示

**UI调整**: Modal 宽度增加到 1000px，左右分栏布局

### 4. 模板使用历史

**组件**: `TemplateHistory.vue`

**功能**:
- 显示"最近使用"的模板
- 快速复用之前的变量值
- 使用统计图表

**数据来源**: `template.getRecent` API

---

## 技术规范

### 命名约定
- 组件名: PascalCase (TemplateCard, TemplateGallery)
- 文件名: kebab-case (template-card.vue)
- CSS类: kebab-case (template-card, card-title)

### 样式指南
- 使用 SCSS with scoped styles
- 主题色: 紫色渐变 `#667eea → #764ba2`
- 卡片圆角: 12px
- 间距单位: 8的倍数 (8px, 16px, 24px)
- 过渡动画: `transition: all 0.3s ease`

### 性能优化
- 使用 `v-show` 而不是 `v-if` 对频繁切换的内容
- 模板列表使用虚拟滚动（如果模板数量超过50个）
- 图片懒加载 (`loading="lazy"`)
- Debounce 搜索输入（300ms）

### 错误处理
- API 调用失败显示友好错误提示
- 表单验证失败高亮错误字段
- 网络超时自动重试

---

## 测试计划

### 单元测试
- TemplateCard: Props 渲染、事件触发
- TemplateVariableModal: 表单生成、验证逻辑
- useTemplateStore: Actions 和 Getters

### 集成测试
- 完整流程: 浏览模板 → 选择 → 填写变量 → 创建项目
- 边界情况: 无模板、网络失败、验证失败

### 手动测试清单
- [ ] 所有13个模板能正常显示
- [ ] 每种变量类型表单正确生成
- [ ] 必填字段验证生效
- [ ] 项目创建成功并正确渲染 prompt
- [ ] 使用量统计正确递增
- [ ] 空状态和加载状态正常显示

---

## 风险和注意事项

1. **Handlebars 渲染错误**:
   - 风险: 用户输入的变量值可能包含特殊字符导致渲染失败
   - 缓解: 在后端 `template.renderPrompt` 中做好转义处理

2. **模板封面图缺失**:
   - 风险: 13个模板的 `cover_image` 可能尚未准备
   - 缓解: 使用 emoji icon + 渐变背景作为占位符

3. **项目创建流程复杂**:
   - 风险: 涉及 StreamProgressModal, TaskExecutionMonitor 等多个组件
   - 缓解: 复用 ProjectsPage 现有的创建流程，只需替换 userPrompt

4. **性能问题**:
   - 风险: 动态表单生成可能较慢
   - 缓解: 使用 computed 缓存生成的表单配置

---

## 成功指标

MVP 阶段完成标准:
- ✅ 用户能在 HomePage 和 ProjectsPage 看到模板卡片
- ✅ 点击模板能弹出变量表单
- ✅ 填写变量后能成功创建项目
- ✅ 项目内容与模板预期一致
- ✅ 所有13个模板可用

Phase 2 完成标准:
- ✅ 搜索和过滤功能可用
- ✅ 评分和收藏功能可用
- ✅ 实时预览功能可用
- ✅ 使用历史功能可用

---

## 参考资料

- 现有代码:
  - `desktop-app-vue/src/main/template/template-manager.js` (后端逻辑)
  - `desktop-app-vue/src/renderer/components/PromptTemplates.vue` (类似UI参考)
  - `desktop-app-vue/src/renderer/pages/HomePage.vue` (集成目标)

- 设计参考:
  - `C:\code\chainlesschain\参考资料\*.png` (41张设计图)
  - 扣子空间风格的卡片和布局设计

- API文档:
  - IPC APIs: `window.electronAPI.template.*`
  - 后端方法: ProjectTemplateManager class

---

**计划完成时间**: 2025-12-27
**预计实施时间**: MVP阶段 4-5小时，Phase 2 额外 3-4小时
