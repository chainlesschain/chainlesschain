<template>
  <div class="template-management-page">
    <!-- 顶部工具栏 -->
    <div class="page-header">
      <div class="header-left">
        <h2>模板管理</h2>
        <a-tag color="blue">
          {{ templateStats.total || 0 }} 个模板
        </a-tag>
      </div>
      <div class="header-right">
        <a-space>
          <a-input-search
            v-model:value="searchKeyword"
            placeholder="搜索模板..."
            style="width: 300px"
            @search="handleSearch"
          />
          <a-button
            type="primary"
            @click="showCreateModal"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            创建模板
          </a-button>
          <a-button @click="refreshTemplates">
            <template #icon>
              <ReloadOutlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <a-space>
        <span>分类：</span>
        <a-select
          v-model:value="filterCategory"
          placeholder="全部分类"
          style="width: 150px"
          @change="handleFilterChange"
        >
          <a-select-option value="">
            全部分类
          </a-select-option>
          <a-select-option value="writing">
            写作
          </a-select-option>
          <a-select-option value="ppt">
            PPT演示
          </a-select-option>
          <a-select-option value="excel">
            Excel数据
          </a-select-option>
          <a-select-option value="web">
            网页开发
          </a-select-option>
          <a-select-option value="design">
            设计
          </a-select-option>
          <a-select-option value="podcast">
            播客
          </a-select-option>
          <a-select-option value="resume">
            简历
          </a-select-option>
          <a-select-option value="research">
            研究
          </a-select-option>
          <a-select-option value="marketing">
            营销
          </a-select-option>
          <a-select-option value="education">
            教育
          </a-select-option>
          <a-select-option value="lifestyle">
            生活
          </a-select-option>
          <a-select-option value="travel">
            旅游
          </a-select-option>
          <a-select-option value="video">
            视频
          </a-select-option>
          <a-select-option value="social-media">
            社交媒体
          </a-select-option>
          <a-select-option value="code-project">
            代码项目
          </a-select-option>
          <a-select-option value="creative-writing">
            创意写作
          </a-select-option>
          <a-select-option value="data-science">
            数据科学
          </a-select-option>
          <a-select-option value="ecommerce">
            电商
          </a-select-option>
          <a-select-option value="health">
            健康
          </a-select-option>
          <a-select-option value="learning">
            学习
          </a-select-option>
          <a-select-option value="legal">
            法律
          </a-select-option>
          <a-select-option value="time-management">
            时间管理
          </a-select-option>
          <a-select-option value="tech-docs">
            技术文档
          </a-select-option>
          <a-select-option value="productivity">
            效率
          </a-select-option>
          <a-select-option value="career">
            职业
          </a-select-option>
          <a-select-option value="marketing-pro">
            营销推广
          </a-select-option>
        </a-select>

        <span>项目类型：</span>
        <a-select
          v-model:value="filterProjectType"
          placeholder="全部类型"
          style="width: 150px"
          @change="handleFilterChange"
        >
          <a-select-option value="">
            全部类型
          </a-select-option>
          <a-select-option value="document">
            文档
          </a-select-option>
          <a-select-option value="presentation">
            演示文稿
          </a-select-option>
          <a-select-option value="spreadsheet">
            电子表格
          </a-select-option>
          <a-select-option value="web">
            Web应用
          </a-select-option>
          <a-select-option value="app">
            应用程序
          </a-select-option>
          <a-select-option value="data">
            数据分析
          </a-select-option>
        </a-select>

        <span>来源：</span>
        <a-radio-group
          v-model:value="filterBuiltin"
          @change="handleFilterChange"
        >
          <a-radio-button value="">
            全部
          </a-radio-button>
          <a-radio-button :value="1">
            内置
          </a-radio-button>
          <a-radio-button :value="0">
            自定义
          </a-radio-button>
        </a-radio-group>
      </a-space>
    </div>

    <!-- 统计信息 -->
    <div class="stats-bar">
      <a-row :gutter="16">
        <a-col :span="6">
          <a-statistic
            title="总模板数"
            :value="templateStats.total || 0"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="内置模板"
            :value="templateStats.builtin || 0"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="自定义模板"
            :value="templateStats.custom || 0"
          />
        </a-col>
        <a-col :span="6">
          <a-button
            type="link"
            @click="showStatsModal = true"
          >
            查看详细统计
          </a-button>
        </a-col>
      </a-row>
    </div>

    <!-- 模板列表 -->
    <div class="template-list">
      <a-spin :spinning="loading">
        <a-table
          :columns="columns"
          :data-source="displayTemplates"
          :pagination="pagination"
          :row-key="record => record.id"
          @change="handleTableChange"
        >
          <!-- 模板名称 -->
          <template #name="{ record }">
            <div class="template-name-cell">
              <div class="template-title">
                {{ record.display_name }}
              </div>
              <div class="template-subtitle">
                {{ record.name }}
              </div>
            </div>
          </template>

          <!-- 分类 -->
          <template #category="{ record }">
            <a-tag color="blue">
              {{ getCategoryLabel(record.category) }}
            </a-tag>
            <a-tag
              v-if="record.subcategory"
              color="cyan"
            >
              {{ record.subcategory }}
            </a-tag>
          </template>

          <!-- 项目类型 -->
          <template #project_type="{ record }">
            <a-tag color="purple">
              {{ getProjectTypeLabel(record.project_type) }}
            </a-tag>
          </template>

          <!-- 来源 -->
          <template #is_builtin="{ record }">
            <a-tag :color="record.is_builtin ? 'green' : 'orange'">
              {{ record.is_builtin ? '内置' : '自定义' }}
            </a-tag>
          </template>

          <!-- 使用次数 -->
          <template #usage_count="{ record }">
            {{ record.usage_count || 0 }}
          </template>

          <!-- 评分 -->
          <template #rating="{ record }">
            <a-rate
              :value="record.rating || 0"
              disabled
              allow-half
            />
            <span style="margin-left: 8px">({{ record.rating_count || 0 }})</span>
          </template>

          <!-- 操作 -->
          <template #action="{ record }">
            <a-space>
              <a-button
                type="link"
                size="small"
                @click="viewTemplate(record)"
              >
                <template #icon>
                  <EyeOutlined />
                </template>
                查看
              </a-button>
              <a-button
                type="link"
                size="small"
                :disabled="record.is_builtin"
                @click="editTemplate(record)"
              >
                <template #icon>
                  <EditOutlined />
                </template>
                编辑
              </a-button>
              <a-button
                type="link"
                size="small"
                @click="duplicateTemplate(record)"
              >
                <template #icon>
                  <CopyOutlined />
                </template>
                复制
              </a-button>
              <a-popconfirm
                title="确定要删除这个模板吗？"
                ok-text="确定"
                cancel-text="取消"
                @confirm="deleteTemplate(record)"
              >
                <a-button
                  type="link"
                  size="small"
                  danger
                  :disabled="record.is_builtin"
                >
                  <template #icon>
                    <DeleteOutlined />
                  </template>
                  删除
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </a-table>
      </a-spin>
    </div>

    <!-- 创建/编辑模板对话框 -->
    <a-modal
      v-model:open="showEditorModal"
      :title="editorMode === 'create' ? '创建模板' : '编辑模板'"
      width="900px"
      :footer="null"
      :mask-closable="false"
    >
      <TemplateEditor
        ref="editorRef"
        :template="currentTemplate"
        :mode="editorMode"
      />
      <div style="margin-top: 24px; text-align: right">
        <a-space>
          <a-button @click="closeEditorModal">
            取消
          </a-button>
          <a-button
            type="primary"
            :loading="saving"
            @click="saveTemplate"
          >
            保存
          </a-button>
        </a-space>
      </div>
    </a-modal>

    <!-- 模板详情对话框 -->
    <a-modal
      v-model:open="showDetailModal"
      title="模板详情"
      width="800px"
      :footer="null"
    >
      <div
        v-if="currentTemplate"
        class="template-detail"
      >
        <a-descriptions
          bordered
          :column="2"
        >
          <a-descriptions-item label="模板名称">
            {{ currentTemplate.name }}
          </a-descriptions-item>
          <a-descriptions-item label="显示名称">
            {{ currentTemplate.display_name }}
          </a-descriptions-item>
          <a-descriptions-item
            label="分类"
            :span="2"
          >
            {{ getCategoryLabel(currentTemplate.category) }}
            <span v-if="currentTemplate.subcategory"> / {{ currentTemplate.subcategory }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="项目类型">
            {{ getProjectTypeLabel(currentTemplate.project_type) }}
          </a-descriptions-item>
          <a-descriptions-item label="来源">
            {{ currentTemplate.is_builtin ? '内置' : '自定义' }}
          </a-descriptions-item>
          <a-descriptions-item
            label="作者"
            :span="2"
          >
            {{ currentTemplate.author || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="版本">
            {{ currentTemplate.version || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="使用次数">
            {{ currentTemplate.usage_count || 0 }}
          </a-descriptions-item>
          <a-descriptions-item
            label="描述"
            :span="2"
          >
            {{ currentTemplate.description || '-' }}
          </a-descriptions-item>
          <a-descriptions-item
            label="标签"
            :span="2"
          >
            <a-tag
              v-for="tag in currentTemplate.tags"
              :key="tag"
              color="blue"
            >
              {{ tag }}
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <a-divider>提示词模板</a-divider>
        <pre class="template-content">{{ currentTemplate.prompt_template || '无' }}</pre>

        <a-divider>变量定义</a-divider>
        <a-table
          v-if="currentTemplate.variables_schema && currentTemplate.variables_schema.length"
          :columns="variableColumns"
          :data-source="currentTemplate.variables_schema"
          :pagination="false"
          size="small"
        />
        <div
          v-else
          class="empty-text"
        >
          未定义变量
        </div>
      </div>
    </a-modal>

    <!-- 统计详情对话框 -->
    <a-modal
      v-model:open="showStatsModal"
      title="模板统计"
      width="600px"
      :footer="null"
    >
      <div class="stats-detail">
        <h4>按分类统计</h4>
        <a-list
          :data-source="templateStats.byCategory || []"
          size="small"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <span>{{ getCategoryLabel(item.category) }}</span>
              <template #extra>
                <a-tag color="blue">
                  {{ item.count }} 个
                </a-tag>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  PlusOutlined,
  ReloadOutlined,
  EyeOutlined,
  EditOutlined,
  CopyOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue'
import { useTemplateStore } from '@/stores/template'
import TemplateEditor from '@/components/templates/TemplateEditor.vue'

const templateStore = useTemplateStore()

// 状态
const loading = ref(false)
const saving = ref(false)
const searchKeyword = ref('')
const filterCategory = ref('')
const filterProjectType = ref('')
const filterBuiltin = ref('')

const showEditorModal = ref(false)
const showDetailModal = ref(false)
const showStatsModal = ref(false)

const editorMode = ref('create') // 'create' or 'edit'
const currentTemplate = ref(null)
const editorRef = ref(null)

const templateStats = ref({
  total: 0,
  builtin: 0,
  custom: 0,
  byCategory: []
})

// 表格配置
const columns = [
  {
    title: '模板名称',
    dataIndex: 'display_name',
    key: 'name',
    width: 200
  },
  {
    title: '分类',
    dataIndex: 'category',
    key: 'category',
    width: 180
  },
  {
    title: '项目类型',
    dataIndex: 'project_type',
    key: 'project_type',
    width: 120
  },
  {
    title: '来源',
    dataIndex: 'is_builtin',
    key: 'is_builtin',
    width: 80
  },
  {
    title: '使用次数',
    dataIndex: 'usage_count',
    key: 'usage_count',
    width: 100,
    sorter: (a, b) => (a.usage_count || 0) - (b.usage_count || 0)
  },
  {
    title: '评分',
    dataIndex: 'rating',
    key: 'rating',
    width: 180,
    sorter: (a, b) => (a.rating || 0) - (b.rating || 0)
  },
  {
    title: '操作',
    key: 'action',
    width: 260,
    fixed: 'right'
  }
]

const variableColumns = [
  { title: '变量名', dataIndex: 'name', key: 'name' },
  { title: '标签', dataIndex: 'label', key: 'label' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '必填', dataIndex: 'required', key: 'required', customRender: ({ text }) => text ? '是' : '否' },
  { title: '默认值', dataIndex: 'default', key: 'default' }
]

const pagination = reactive({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`
})

// 计算属性
const displayTemplates = computed(() => {
  let templates = templateStore.templates

  // 应用筛选
  if (filterCategory.value) {
    templates = templates.filter(t => t.category === filterCategory.value)
  }
  if (filterProjectType.value) {
    templates = templates.filter(t => t.project_type === filterProjectType.value)
  }
  if (filterBuiltin.value !== '') {
    templates = templates.filter(t => t.is_builtin === filterBuiltin.value)
  }

  // 应用搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    templates = templates.filter(t =>
      t.display_name?.toLowerCase().includes(keyword) ||
      t.name?.toLowerCase().includes(keyword) ||
      t.description?.toLowerCase().includes(keyword)
    )
  }

  pagination.total = templates.length
  return templates
})

// 方法
function getCategoryLabel(category) {
  const categoryMap = {
    writing: '写作',
    ppt: 'PPT演示',
    excel: 'Excel数据',
    web: '网页开发',
    design: '设计',
    podcast: '播客',
    resume: '简历',
    research: '研究',
    marketing: '营销',
    education: '教育',
    lifestyle: '生活',
    travel: '旅游',
    video: '视频',
    'social-media': '社交媒体',
    'code-project': '代码项目',
    'creative-writing': '创意写作',
    'data-science': '数据科学',
    ecommerce: '电商',
    'marketing-pro': '营销推广',
    health: '健康',
    learning: '学习',
    legal: '法律',
    'time-management': '时间管理',
    'tech-docs': '技术文档',
    productivity: '效率',
    career: '职业'
  }
  return categoryMap[category] || category
}

function getProjectTypeLabel(type) {
  const typeMap = {
    document: '文档',
    presentation: '演示文稿',
    spreadsheet: '电子表格',
    web: 'Web应用',
    app: '应用程序',
    data: '数据分析'
  }
  return typeMap[type] || type
}

async function refreshTemplates() {
  loading.value = true
  try {
    await templateStore.fetchTemplates()
    await loadStats()
    message.success('刷新成功')
  } catch (error) {
    message.error('刷新失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const stats = await templateStore.getTemplateStats()
    templateStats.value = stats
  } catch (error) {
    logger.error('加载统计信息失败:', error)
  }
}

function handleSearch() {
  pagination.current = 1
}

function handleFilterChange() {
  pagination.current = 1
}

function handleTableChange(pag) {
  pagination.current = pag.current
  pagination.pageSize = pag.pageSize
}

function showCreateModal() {
  editorMode.value = 'create'
  currentTemplate.value = null
  showEditorModal.value = true
}

function viewTemplate(template) {
  currentTemplate.value = template
  showDetailModal.value = true
}

function editTemplate(template) {
  if (template.is_builtin) {
    message.warning('内置模板不可编辑，可以复制后修改')
    return
  }
  editorMode.value = 'edit'
  currentTemplate.value = template
  showEditorModal.value = true
}

async function duplicateTemplate(template) {
  try {
    const newName = prompt('请输入新模板的名称:', `${template.display_name} (副本)`)
    if (!newName) {return}

    loading.value = true
    await templateStore.duplicateTemplate(template.id, newName)
    message.success('复制成功')
    await refreshTemplates()
  } catch (error) {
    message.error('复制失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

async function deleteTemplate(template) {
  if (template.is_builtin) {
    message.warning('内置模板不可删除')
    return
  }

  try {
    loading.value = true
    await templateStore.deleteTemplate(template.id)
    message.success('删除成功')
    await refreshTemplates()
  } catch (error) {
    message.error('删除失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

async function saveTemplate() {
  try {
    saving.value = true

    // 调用编辑器的保存方法
    await editorRef.value.save()

    // 这里会触发编辑器的 @save 事件
    // 我们直接从编辑器获取数据
    const formData = editorRef.value.formData

    if (editorMode.value === 'create') {
      await templateStore.createTemplate(formData)
      message.success('创建成功')
    } else {
      await templateStore.updateTemplate(currentTemplate.value.id, formData)
      message.success('更新成功')
    }

    closeEditorModal()
    await refreshTemplates()
  } catch (error) {
    message.error(`保存失败: ${error.message}`)
  } finally {
    saving.value = false
  }
}

function closeEditorModal() {
  showEditorModal.value = false
  currentTemplate.value = null
  editorRef.value?.reset()
}

// 初始化
onMounted(async () => {
  await refreshTemplates()
})
</script>

<style scoped>
.template-management-page {
  padding: 24px;
  background: #fff;
  min-height: 100vh;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header .header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-header .header-left h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.filter-bar {
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
  margin-bottom: 16px;
}

.stats-bar {
  margin-bottom: 24px;
}

.template-name-cell .template-title {
  font-weight: 500;
  margin-bottom: 4px;
}

.template-name-cell .template-subtitle {
  font-size: 12px;
  color: #999;
}

.template-detail .template-content {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'Courier New', Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 400px;
  overflow-y: auto;
}

.template-detail .empty-text {
  text-align: center;
  color: #999;
  padding: 24px;
}

.stats-detail h4 {
  margin-bottom: 16px;
  font-weight: 600;
}
</style>
