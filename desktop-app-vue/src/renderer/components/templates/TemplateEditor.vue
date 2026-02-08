<template>
  <div class="template-editor">
    <a-form ref="formRef" :model="formData" :rules="rules" layout="vertical">
      <a-tabs v-model:active-key="activeTab">
        <!-- 基本信息 -->
        <a-tab-pane key="basic" tab="基本信息">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="模板名称" name="name" required>
                <a-input
                  v-model:value="formData.name"
                  placeholder="请输入模板名称（英文标识）"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="显示名称" name="display_name" required>
                <a-input
                  v-model:value="formData.display_name"
                  placeholder="请输入显示名称（中文）"
                />
              </a-form-item>
            </a-col>
          </a-row>

          <a-form-item label="描述" name="description">
            <a-textarea
              v-model:value="formData.description"
              placeholder="请输入模板描述"
              :rows="3"
            />
          </a-form-item>

          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="分类" name="category" required>
                <a-select
                  v-model:value="formData.category"
                  placeholder="请选择分类"
                >
                  <a-select-option value="writing"> 写作 </a-select-option>
                  <a-select-option value="ppt"> PPT演示 </a-select-option>
                  <a-select-option value="excel"> Excel数据 </a-select-option>
                  <a-select-option value="web"> 网页开发 </a-select-option>
                  <a-select-option value="design"> 设计 </a-select-option>
                  <a-select-option value="podcast"> 播客 </a-select-option>
                  <a-select-option value="resume"> 简历 </a-select-option>
                  <a-select-option value="research"> 研究 </a-select-option>
                  <a-select-option value="marketing"> 营销 </a-select-option>
                  <a-select-option value="education"> 教育 </a-select-option>
                  <a-select-option value="lifestyle"> 生活 </a-select-option>
                  <a-select-option value="travel"> 旅游 </a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="项目类型" name="project_type" required>
                <a-select
                  v-model:value="formData.project_type"
                  placeholder="请选择项目类型"
                >
                  <a-select-option value="document"> 文档 </a-select-option>
                  <a-select-option value="presentation">
                    演示文稿
                  </a-select-option>
                  <a-select-option value="spreadsheet">
                    电子表格
                  </a-select-option>
                  <a-select-option value="web"> Web应用 </a-select-option>
                  <a-select-option value="app"> 应用程序 </a-select-option>
                  <a-select-option value="data"> 数据分析 </a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>

          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="子分类" name="subcategory">
                <a-input
                  v-model:value="formData.subcategory"
                  placeholder="请输入子分类（可选）"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="图标" name="icon">
                <a-input
                  v-model:value="formData.icon"
                  placeholder="请输入图标名称（可选）"
                />
              </a-form-item>
            </a-col>
          </a-row>

          <a-form-item label="标签" name="tags">
            <a-select
              v-model:value="formData.tags"
              mode="tags"
              placeholder="请输入标签，按Enter添加"
              :token-separators="[',']"
            />
          </a-form-item>

          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="作者" name="author">
                <a-input
                  v-model:value="formData.author"
                  placeholder="请输入作者名称"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="版本" name="version">
                <a-input
                  v-model:value="formData.version"
                  placeholder="请输入版本号（如: 1.0.0）"
                />
              </a-form-item>
            </a-col>
          </a-row>
        </a-tab-pane>

        <!-- 提示词模板 -->
        <a-tab-pane key="prompt" tab="提示词模板">
          <a-form-item label="提示词模板" name="prompt_template">
            <a-textarea
              v-model:value="formData.prompt_template"
              placeholder="请输入提示词模板，使用 {{variableName}} 作为变量占位符"
              :rows="15"
              class="monospace-textarea"
            />
            <div class="helper-text">
              <InfoCircleOutlined />
              <span>{{ helpText }}</span>
            </div>
          </a-form-item>

          <a-button type="dashed" block @click="showVariableHelper = true">
            <template #icon>
              <QuestionCircleOutlined />
            </template>
            查看变量语法帮助
          </a-button>
        </a-tab-pane>

        <!-- 变量定义 -->
        <a-tab-pane key="variables" tab="变量定义">
          <div class="variables-section">
            <div class="section-header">
              <span>变量列表</span>
              <a-button type="primary" size="small" @click="addVariable">
                <template #icon>
                  <PlusOutlined />
                </template>
                添加变量
              </a-button>
            </div>

            <div class="variables-list">
              <div
                v-for="(variable, index) in formData.variables_schema"
                :key="index"
                class="variable-item"
              >
                <a-card size="small">
                  <template #extra>
                    <a-button
                      type="text"
                      danger
                      size="small"
                      @click="removeVariable(index)"
                    >
                      <template #icon>
                        <DeleteOutlined />
                      </template>
                    </a-button>
                  </template>

                  <a-row :gutter="12">
                    <a-col :span="8">
                      <a-input
                        v-model:value="variable.name"
                        placeholder="变量名（英文）"
                        addon-before="name"
                      />
                    </a-col>
                    <a-col :span="8">
                      <a-input
                        v-model:value="variable.label"
                        placeholder="显示标签（中文）"
                        addon-before="label"
                      />
                    </a-col>
                    <a-col :span="8">
                      <a-select
                        v-model:value="variable.type"
                        placeholder="类型"
                      >
                        <a-select-option value="text"> 文本 </a-select-option>
                        <a-select-option value="textarea">
                          多行文本
                        </a-select-option>
                        <a-select-option value="number"> 数字 </a-select-option>
                        <a-select-option value="date"> 日期 </a-select-option>
                        <a-select-option value="select">
                          下拉选择
                        </a-select-option>
                        <a-select-option value="array"> 数组 </a-select-option>
                      </a-select>
                    </a-col>
                  </a-row>

                  <a-row :gutter="12" style="margin-top: 8px">
                    <a-col :span="12">
                      <a-input
                        v-model:value="variable.default"
                        placeholder="默认值（可选）"
                        addon-before="default"
                      />
                    </a-col>
                    <a-col :span="6">
                      <a-checkbox v-model:checked="variable.required">
                        必填
                      </a-checkbox>
                    </a-col>
                    <a-col :span="6">
                      <a-input
                        v-model:value="variable.placeholder"
                        placeholder="提示文本"
                      />
                    </a-col>
                  </a-row>
                </a-card>
              </div>
            </div>
          </div>
        </a-tab-pane>

        <!-- 文件结构（高级） -->
        <a-tab-pane key="files" tab="文件结构">
          <a-alert
            message="高级功能"
            description="定义项目生成时的文件结构和默认文件内容（JSON格式）"
            type="info"
            show-icon
            style="margin-bottom: 16px"
          />

          <a-form-item label="文件结构" name="file_structure">
            <a-textarea
              v-model:value="fileStructureJson"
              placeholder='例如: { "src": { "index.html": "", "styles": {} } }'
              :rows="8"
              class="monospace-textarea"
            />
          </a-form-item>

          <a-form-item label="默认文件" name="default_files">
            <a-textarea
              v-model:value="defaultFilesJson"
              placeholder='例如: [{ "path": "README.md", "content": "# {{title}}" }]'
              :rows="8"
              class="monospace-textarea"
            />
          </a-form-item>
        </a-tab-pane>
      </a-tabs>
    </a-form>

    <!-- 变量语法帮助对话框 -->
    <a-modal
      v-model:open="showVariableHelper"
      title="Handlebars 变量语法帮助"
      :footer="null"
      width="700px"
    >
      <div v-pre class="helper-content">
        <h4>基本变量</h4>
        <pre>{{ variableName }}</pre>

        <h4>条件判断</h4>
        <pre
          >{{#if condition}}
  显示的内容
{{else}}
  其他内容
{{/if}}</pre
        >

        <h4>循环遍历</h4>
        <pre
          >{{#each items}}
  - {{ this.name }}
{{/each}}</pre
        >

        <h4>内置 Helpers</h4>
        <ul>
          <li>
            <code>{{formatDate date 'yyyy-MM-dd'}}</code> - 格式化日期
          </li>
          <li>
            <code>{{uppercase text}}</code> - 转大写
          </li>
          <li>
            <code>{{lowercase text}}</code> - 转小写
          </li>
          <li>
            <code>{{capitalize text}}</code> - 首字母大写
          </li>
          <li>
            <code>{{default value 'defaultValue'}}</code> - 默认值
          </li>
          <li>
            <code>{{add a b}}</code> - 加法
          </li>
          <li>
            <code>{{subtract a b}}</code> - 减法
          </li>
        </ul>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, computed, watch, onMounted } from "vue";
import {
  InfoCircleOutlined,
  QuestionCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { message } from "ant-design-vue";

const props = defineProps({
  template: {
    type: Object,
    default: null,
  },
  mode: {
    type: String,
    default: "create", // 'create' or 'edit'
  },
});

const emit = defineEmits(["save", "cancel"]);

const formRef = ref(null);
const activeTab = ref("basic");
const showVariableHelper = ref(false);

// Help text for Handlebars syntax
const helpText = computed(
  () =>
    "支持 Handlebars 语法，例如: {{title}}, {{#if condition}}...{{/if}}, {{#each items}}...{{/each}}",
);

// 表单数据
const formData = reactive({
  name: "",
  display_name: "",
  description: "",
  category: "",
  subcategory: "",
  project_type: "",
  icon: "",
  tags: [],
  prompt_template: "",
  variables_schema: [],
  file_structure: {},
  default_files: [],
  author: "",
  version: "1.0.0",
});

// JSON 字段的字符串表示
const fileStructureJson = ref("{}");
const defaultFilesJson = ref("[]");

// 表单验证规则
const rules = {
  name: [
    { required: true, message: "请输入模板名称", trigger: "blur" },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: "仅支持字母、数字、下划线和连字符",
      trigger: "blur",
    },
  ],
  display_name: [
    { required: true, message: "请输入显示名称", trigger: "blur" },
  ],
  category: [{ required: true, message: "请选择分类", trigger: "change" }],
  project_type: [
    { required: true, message: "请选择项目类型", trigger: "change" },
  ],
};

// 监听 JSON 字段变化
watch(fileStructureJson, (val) => {
  try {
    formData.file_structure = JSON.parse(val);
  } catch (e) {
    // 忽略解析错误，用户输入时可能不完整
  }
});

watch(defaultFilesJson, (val) => {
  try {
    formData.default_files = JSON.parse(val);
  } catch (e) {
    // 忽略解析错误
  }
});

// 添加变量
function addVariable() {
  formData.variables_schema.push({
    name: "",
    label: "",
    type: "text",
    required: false,
    default: "",
    placeholder: "",
  });
}

// 删除变量
function removeVariable(index) {
  formData.variables_schema.splice(index, 1);
}

// 保存模板
async function save() {
  try {
    await formRef.value.validate();

    // 验证 JSON 字段
    try {
      JSON.parse(fileStructureJson.value);
      JSON.parse(defaultFilesJson.value);
    } catch (e) {
      message.error("文件结构或默认文件的 JSON 格式不正确");
      return;
    }

    emit("save", { ...formData });
  } catch (error) {
    logger.error("表单验证失败:", error);
    message.error("请检查必填项");
  }
}

// 重置表单
function reset() {
  formRef.value?.resetFields();
  formData.variables_schema = [];
  fileStructureJson.value = "{}";
  defaultFilesJson.value = "[]";
}

// 加载模板数据（编辑模式）
function loadTemplate(template) {
  if (!template) {
    return;
  }

  Object.assign(formData, {
    name: template.name || "",
    display_name: template.display_name || "",
    description: template.description || "",
    category: template.category || "",
    subcategory: template.subcategory || "",
    project_type: template.project_type || "",
    icon: template.icon || "",
    tags: template.tags || [],
    prompt_template: template.prompt_template || "",
    variables_schema: template.variables_schema || [],
    file_structure: template.file_structure || {},
    default_files: template.default_files || [],
    author: template.author || "",
    version: template.version || "1.0.0",
  });

  fileStructureJson.value = JSON.stringify(
    template.file_structure || {},
    null,
    2,
  );
  defaultFilesJson.value = JSON.stringify(
    template.default_files || [],
    null,
    2,
  );
}

// 初始化
onMounted(() => {
  if (props.mode === "edit" && props.template) {
    loadTemplate(props.template);
  }
});

// 暴露方法给父组件
defineExpose({
  save,
  reset,
  loadTemplate,
});
</script>

<style scoped>
.template-editor :deep(.ant-tabs .ant-tabs-nav) {
  margin-bottom: 24px;
}

.template-editor .monospace-textarea {
  font-family: "Courier New", Consolas, monospace;
  font-size: 13px;
}

.template-editor .helper-text {
  margin-top: 8px;
  color: #999;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.variables-section .section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  font-weight: 500;
}

.variables-section .variables-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.variable-item :deep(.ant-card-head) {
  min-height: 36px;
  padding: 0 12px;
}

.variable-item :deep(.ant-card-body) {
  padding: 12px;
}

.helper-content h4 {
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}

.helper-content pre {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  font-size: 13px;
  overflow-x: auto;
}

.helper-content ul {
  padding-left: 20px;
}

.helper-content ul li {
  margin-bottom: 6px;
}

.helper-content ul li code {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
