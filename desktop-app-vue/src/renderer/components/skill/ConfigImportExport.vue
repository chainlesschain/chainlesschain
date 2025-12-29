<template>
  <div class="config-import-export">
    <a-tabs v-model:activeKey="activeTab">
      <!-- 导出Tab -->
      <a-tab-pane key="export" tab="导出配置">
        <a-space direction="vertical" style="width: 100%" :size="16">
          <!-- 导出类型选择 -->
          <a-card title="选择导出内容" size="small">
            <a-radio-group v-model:value="exportType">
              <a-radio-button value="skills">技能</a-radio-button>
              <a-radio-button value="tools">工具</a-radio-button>
              <a-radio-button value="all">全部</a-radio-button>
            </a-radio-group>
          </a-card>

          <!-- 导出选项 -->
          <a-card title="导出选项" size="small">
            <a-space direction="vertical" style="width: 100%">
              <a-checkbox v-model:checked="exportOptions.includeTools" :disabled="exportType === 'tools'">
                包含关联的工具
              </a-checkbox>
              <a-checkbox v-model:checked="exportOptions.includeBuiltin">
                包含内置技能/工具
              </a-checkbox>
              <a-checkbox v-model:checked="exportOptions.includeStats">
                包含统计数据
              </a-checkbox>
            </a-space>
          </a-card>

          <!-- 选择要导出的项 -->
          <a-card v-if="exportType !== 'all'" title="选择要导出的项" size="small">
            <a-transfer
              v-if="exportType === 'skills'"
              v-model:target-keys="selectedSkills"
              :data-source="availableSkills"
              :titles="['可用技能', '已选择']"
              :render="item => item.title"
              show-search
              :filter-option="filterOption"
            />
            <a-transfer
              v-else-if="exportType === 'tools'"
              v-model:target-keys="selectedTools"
              :data-source="availableTools"
              :titles="['可用工具', '已选择']"
              :render="item => item.title"
              show-search
              :filter-option="filterOption"
            />
          </a-card>

          <!-- 导出预览 -->
          <a-card v-if="exportPreview" title="导出预览" size="small">
            <pre style="max-height: 300px; overflow-y: auto">{{ JSON.stringify(exportPreview, null, 2) }}</pre>
          </a-card>

          <!-- 导出按钮 -->
          <a-space>
            <a-button type="primary" @click="handleGeneratePreview" :loading="generating">
              <EyeOutlined /> 生成预览
            </a-button>
            <a-button type="primary" @click="handleExportToFile" :disabled="!exportPreview" :loading="exporting">
              <DownloadOutlined /> 导出到文件
            </a-button>
            <a-button @click="handleCopyToClipboard" :disabled="!exportPreview">
              <CopyOutlined /> 复制到剪贴板
            </a-button>
          </a-space>
        </a-space>
      </a-tab-pane>

      <!-- 导入Tab -->
      <a-tab-pane key="import" tab="导入配置">
        <a-space direction="vertical" style="width: 100%" :size="16">
          <!-- 导入方式 -->
          <a-card title="选择导入方式" size="small">
            <a-radio-group v-model:value="importMethod">
              <a-radio-button value="file">从文件导入</a-radio-button>
              <a-radio-button value="json">粘贴JSON</a-radio-button>
              <a-radio-button value="template">使用模板</a-radio-button>
            </a-radio-group>
          </a-card>

          <!-- 文件导入 -->
          <a-card v-if="importMethod === 'file'" title="选择文件" size="small">
            <a-upload
              :before-upload="handleBeforeUpload"
              :file-list="fileList"
              @remove="handleFileRemove"
              accept=".json,.yaml,.yml"
            >
              <a-button>
                <UploadOutlined /> 选择配置文件
              </a-button>
            </a-upload>
          </a-card>

          <!-- JSON导入 -->
          <a-card v-if="importMethod === 'json'" title="粘贴JSON配置" size="small">
            <a-textarea
              v-model:value="importJson"
              placeholder="粘贴配置JSON..."
              :rows="10"
              @change="handleJsonChange"
            />
          </a-card>

          <!-- 模板导入 -->
          <a-card v-if="importMethod === 'template'" title="选择模板" size="small">
            <a-select v-model:value="templateType" style="width: 200px" @change="loadTemplate">
              <a-select-option value="skill">技能模板</a-select-option>
              <a-select-option value="tool">工具模板</a-select-option>
              <a-select-option value="complete">完整模板</a-select-option>
            </a-select>
            <a-button type="link" @click="loadTemplate">加载模板</a-button>
          </a-card>

          <!-- 导入选项 -->
          <a-card title="导入选项" size="small">
            <a-space direction="vertical" style="width: 100%">
              <a-checkbox v-model:checked="importOptions.overwrite">
                覆盖现有配置
              </a-checkbox>
              <a-checkbox v-model:checked="importOptions.skipInvalid">
                跳过无效项
              </a-checkbox>
              <a-checkbox v-model:checked="importOptions.validateOnly">
                仅验证不导入
              </a-checkbox>
            </a-space>
          </a-card>

          <!-- 验证结果 -->
          <a-card v-if="validationResult" :title="validationResult.valid ? '✅ 验证通过' : '❌ 验证失败'" size="small">
            <p>{{ validationResult.message }}</p>
          </a-card>

          <!-- 导入结果 -->
          <a-card v-if="importResult" title="导入结果" size="small">
            <a-descriptions :column="2" size="small">
              <a-descriptions-item label="导入的技能">
                {{ importResult.imported?.skills || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="导入的工具">
                {{ importResult.imported?.tools || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="跳过的技能">
                {{ importResult.skipped?.skills?.length || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="跳过的工具">
                {{ importResult.skipped?.tools?.length || 0 }}
              </a-descriptions-item>
            </a-descriptions>

            <a-collapse v-if="importResult.skipped && (importResult.skipped.skills.length > 0 || importResult.skipped.tools.length > 0)" style="margin-top: 12px">
              <a-collapse-panel header="查看跳过的项">
                <a-list :data-source="[...importResult.skipped.skills, ...importResult.skipped.tools]" size="small">
                  <template #renderItem="{ item }">
                    <a-list-item>
                      {{ item.id }}: {{ item.reason }}
                    </a-list-item>
                  </template>
                </a-list>
              </a-collapse-panel>
            </a-collapse>
          </a-card>

          <!-- 导入按钮 -->
          <a-space>
            <a-button type="primary" @click="handleValidate" :disabled="!importData" :loading="validating">
              <CheckCircleOutlined /> 验证配置
            </a-button>
            <a-button type="primary" @click="handleImport" :disabled="!importData" :loading="importing">
              <ImportOutlined /> 导入配置
            </a-button>
          </a-space>
        </a-space>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  DownloadOutlined,
  UploadOutlined,
  EyeOutlined,
  CopyOutlined,
  ImportOutlined,
  CheckCircleOutlined
} from '@ant-design/icons-vue';

// 响应式数据
const activeTab = ref('export');
const exportType = ref('skills');
const exportOptions = ref({
  includeTools: true,
  includeBuiltin: false,
  includeStats: false
});

const availableSkills = ref([]);
const availableTools = ref([]);
const selectedSkills = ref([]);
const selectedTools = ref([]);
const exportPreview = ref(null);
const generating = ref(false);
const exporting = ref(false);

// 导入相关
const importMethod = ref('file');
const importJson = ref('');
const importData = ref(null);
const fileList = ref([]);
const templateType = ref('skill');
const importOptions = ref({
  overwrite: false,
  skipInvalid: true,
  validateOnly: false
});
const validationResult = ref(null);
const importResult = ref(null);
const validating = ref(false);
const importing = ref(false);

// 方法
const loadAvailableItems = async () => {
  try {
    // 加载技能
    const skillsResult = await window.electron.invoke('skill:get-all', {});
    if (skillsResult.success) {
      availableSkills.value = skillsResult.data.map(skill => ({
        key: skill.id,
        title: skill.name,
        description: skill.description
      }));
    }

    // 加载工具
    const toolsResult = await window.electron.invoke('tool:get-all', {});
    if (toolsResult.success) {
      availableTools.value = toolsResult.data.map(tool => ({
        key: tool.id,
        title: tool.name,
        description: tool.description
      }));
    }
  } catch (error) {
    message.error('加载数据失败');
  }
};

const filterOption = (inputValue, option) => {
  return option.title.toLowerCase().includes(inputValue.toLowerCase());
};

const handleGeneratePreview = async () => {
  generating.value = true;
  try {
    let result;

    if (exportType.value === 'skills') {
      result = await window.electron.invoke('config:export-skills',
        selectedSkills.value.length > 0 ? selectedSkills.value : null,
        exportOptions.value
      );
    } else if (exportType.value === 'tools') {
      result = await window.electron.invoke('config:export-tools',
        selectedTools.value.length > 0 ? selectedTools.value : null,
        { includeBuiltin: exportOptions.value.includeBuiltin, includeStats: exportOptions.value.includeStats }
      );
    } else {
      // 导出全部
      const skillsResult = await window.electron.invoke('config:export-skills', null, exportOptions.value);
      const toolsResult = await window.electron.invoke('config:export-tools', null, exportOptions.value);

      result = {
        success: true,
        data: {
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          skills: skillsResult.data?.skills || [],
          tools: toolsResult.data?.tools || []
        }
      };
    }

    if (result.success) {
      exportPreview.value = result.data;
      message.success('预览生成成功');
    } else {
      message.error(`生成失败: ${result.error}`);
    }
  } finally {
    generating.value = false;
  }
};

const handleExportToFile = async () => {
  if (!exportPreview.value) return;

  exporting.value = true;
  try {
    // 使用Electron的dialog选择保存位置
    const savePath = await window.electron.invoke('dialog:showSaveDialog', {
      defaultPath: `skill-tool-config-${Date.now()}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (savePath.canceled) {
      return;
    }

    const result = await window.electron.invoke('config:export-to-file', exportPreview.value, savePath.filePath);

    if (result.success) {
      message.success(`配置已导出到: ${savePath.filePath}`);
    } else {
      message.error(`导出失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`导出失败: ${error.message}`);
  } finally {
    exporting.value = false;
  }
};

const handleCopyToClipboard = () => {
  if (!exportPreview.value) return;

  navigator.clipboard.writeText(JSON.stringify(exportPreview.value, null, 2));
  message.success('已复制到剪贴板');
};

const handleBeforeUpload = (file) => {
  fileList.value = [file];

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      importData.value = JSON.parse(e.target.result);
      importJson.value = e.target.result;
      message.success('文件读取成功');
    } catch (error) {
      message.error('文件格式错误');
    }
  };
  reader.readAsText(file);

  return false; // 阻止自动上传
};

const handleFileRemove = () => {
  fileList.value = [];
  importData.value = null;
  importJson.value = '';
};

const handleJsonChange = () => {
  try {
    importData.value = JSON.parse(importJson.value);
    validationResult.value = null;
  } catch (error) {
    importData.value = null;
  }
};

const loadTemplate = async () => {
  try {
    const result = await window.electron.invoke('config:create-template', templateType.value);
    if (result.success) {
      importJson.value = JSON.stringify(result.data, null, 2);
      importData.value = result.data;
      message.success('模板加载成功');
    }
  } catch (error) {
    message.error('加载模板失败');
  }
};

const handleValidate = async () => {
  if (!importData.value) return;

  validating.value = true;
  try {
    const result = await window.electron.invoke('config:import', importData.value, {
      ...importOptions.value,
      validateOnly: true
    });

    if (result.success) {
      validationResult.value = result.data;
      if (result.data.valid) {
        message.success('配置验证通过');
      } else {
        message.error('配置验证失败');
      }
    }
  } finally {
    validating.value = false;
  }
};

const handleImport = async () => {
  if (!importData.value) return;

  importing.value = true;
  try {
    const result = await window.electron.invoke('config:import', importData.value, importOptions.value);

    if (result.success) {
      importResult.value = result.data;
      message.success(`导入完成: ${result.data.imported.skills} 个技能, ${result.data.imported.tools} 个工具`);

      // 刷新列表
      await loadAvailableItems();
    } else {
      message.error(`导入失败: ${result.error}`);
    }
  } finally {
    importing.value = false;
  }
};

onMounted(() => {
  loadAvailableItems();
});
</script>

<style scoped>
.config-import-export {
  padding: 16px;
}

pre {
  background-color: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
