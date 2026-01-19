<template>
  <a-modal
    :open="visible"
    title="路径迁移向导"
    :width="700"
    :footer="null"
    @cancel="handleCancel"
  >
    <a-steps
      :current="currentStep"
      size="small"
      class="migration-steps"
    >
      <a-step title="选择类型" />
      <a-step title="设置路径" />
      <a-step title="确认迁移" />
      <a-step title="完成" />
    </a-steps>

    <div class="migration-content">
      <!-- 步骤0: 选择迁移类型 -->
      <div
        v-if="currentStep === 0"
        class="step-panel"
      >
        <a-typography-title :level="4">
          选择要迁移的内容
        </a-typography-title>
        <a-radio-group
          v-model:value="migrationType"
          button-style="solid"
          size="large"
        >
          <a-radio-button value="project">
            项目文件
          </a-radio-button>
          <a-radio-button value="database">
            数据库
          </a-radio-button>
          <a-radio-button value="both">
            全部迁移
          </a-radio-button>
        </a-radio-group>

        <a-alert
          v-if="migrationType"
          :message="getMigrationTypeDescription()"
          type="info"
          show-icon
          class="migration-alert"
        />
      </div>

      <!-- 步骤1: 设置新路径 -->
      <div
        v-if="currentStep === 1"
        class="step-panel"
      >
        <a-typography-title :level="4">
          设置新路径
        </a-typography-title>

        <a-form layout="vertical">
          <a-form-item
            v-if="migrationType === 'project' || migrationType === 'both'"
            label="当前项目路径"
          >
            <a-input
              :value="currentPaths.project"
              disabled
            />
          </a-form-item>

          <a-form-item
            v-if="migrationType === 'project' || migrationType === 'both'"
            label="新项目路径"
            required
          >
            <a-input-group compact>
              <a-input
                v-model:value="newPaths.project"
                style="width: calc(100% - 100px)"
                placeholder="选择新的项目路径"
              />
              <a-button
                style="width: 100px"
                @click="browseProjectPath"
              >
                浏览...
              </a-button>
            </a-input-group>
          </a-form-item>

          <a-form-item
            v-if="migrationType === 'database' || migrationType === 'both'"
            label="当前数据库路径"
          >
            <a-input
              :value="currentPaths.database"
              disabled
            />
          </a-form-item>

          <a-form-item
            v-if="migrationType === 'database' || migrationType === 'both'"
            label="新数据库路径"
            required
          >
            <a-input-group compact>
              <a-input
                v-model:value="newPaths.database"
                style="width: calc(100% - 100px)"
                placeholder="选择新的数据库路径"
              />
              <a-button
                style="width: 100px"
                @click="browseDatabasePath"
              >
                浏览...
              </a-button>
            </a-input-group>
          </a-form-item>
        </a-form>
      </div>

      <!-- 步骤2: 确认迁移 -->
      <div
        v-if="currentStep === 2"
        class="step-panel"
      >
        <a-typography-title :level="4">
          确认迁移信息
        </a-typography-title>

        <a-descriptions
          bordered
          :column="1"
        >
          <a-descriptions-item
            v-if="migrationType === 'project' || migrationType === 'both'"
            label="项目文件迁移"
          >
            <div>从: {{ currentPaths.project }}</div>
            <div>到: {{ newPaths.project }}</div>
          </a-descriptions-item>

          <a-descriptions-item
            v-if="migrationType === 'database' || migrationType === 'both'"
            label="数据库迁移"
          >
            <div>从: {{ currentPaths.database }}</div>
            <div>到: {{ newPaths.database }}</div>
          </a-descriptions-item>
        </a-descriptions>

        <a-alert
          message="重要提示"
          description="迁移过程将复制所有文件到新位置。建议在迁移前备份重要数据。迁移完成后，应用将自动重启。"
          type="warning"
          show-icon
          class="migration-alert"
        />

        <a-checkbox
          v-model:checked="confirmed"
          class="migration-checkbox"
        >
          我已阅读并理解上述提示，确认开始迁移
        </a-checkbox>
      </div>

      <!-- 步骤3: 迁移进度 -->
      <div
        v-if="currentStep === 3"
        class="step-panel"
      >
        <a-result
          :status="migrationStatus"
          :title="getMigrationStatusTitle()"
          :sub-title="migrationMessage"
        >
          <template #icon>
            <a-spin
              v-if="migrating"
              size="large"
            />
          </template>
        </a-result>

        <a-progress
          v-if="migrating"
          :percent="migrationProgress"
          :status="migrationProgress === 100 ? 'success' : 'active'"
        />
      </div>
    </div>

    <div class="migration-actions">
      <a-button
        v-if="currentStep > 0 && currentStep < 3"
        @click="prevStep"
      >
        上一步
      </a-button>
      <a-button
        v-if="currentStep < 2"
        type="primary"
        :disabled="!canProceed()"
        @click="nextStep"
      >
        下一步
      </a-button>
      <a-button
        v-if="currentStep === 2"
        type="primary"
        :disabled="!confirmed"
        :loading="migrating"
        @click="handleMigrate"
      >
        开始迁移
      </a-button>
      <a-button
        v-if="currentStep === 3 && !migrating"
        type="primary"
        @click="handleClose"
      >
        完成
      </a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'complete']);

const currentStep = ref(0);
const migrationType = ref('project');
const confirmed = ref(false);
const migrating = ref(false);
const migrationProgress = ref(0);
const migrationStatus = ref('info');
const migrationMessage = ref('');

const currentPaths = reactive({
  project: '',
  database: '',
});

const newPaths = reactive({
  project: '',
  database: '',
});

onMounted(async () => {
  try {
    // 加载当前路径
    const projectPath = await window.electronAPI.config.get('project.rootPath');
    currentPaths.project = projectPath || '未设置';

    const dbConfig = await window.electronAPI.db.getConfig();
    currentPaths.database = dbConfig.path || '未设置';
  } catch (error) {
    console.error('加载当前路径失败:', error);
  }
});

const getMigrationTypeDescription = () => {
  const descriptions = {
    project: '将所有项目文件迁移到新位置。包括知识库文件、附件、导出的文档等。',
    database: '将数据库文件迁移到新位置。包括所有笔记、标签、配置等数据。',
    both: '同时迁移项目文件和数据库到新位置。这是最完整的迁移方式。',
  };
  return descriptions[migrationType.value] || '';
};

const browseProjectPath = async () => {
  try {
    const result = await window.electronAPI.dialog.selectFolder({
      title: '选择新的项目路径',
      defaultPath: currentPaths.project,
    });

    if (result && !result.canceled && result.filePaths.length > 0) {
      newPaths.project = result.filePaths[0];
    }
  } catch (error) {
    console.error('选择路径失败:', error);
    message.error('打开文件夹选择对话框失败');
  }
};

const browseDatabasePath = async () => {
  try {
    const result = await window.electronAPI.dialog.selectFolder({
      title: '选择新的数据库路径',
      defaultPath: currentPaths.database.substring(0, currentPaths.database.lastIndexOf('/')),
    });

    if (result && !result.canceled && result.filePaths.length > 0) {
      newPaths.database = result.filePaths[0] + '/chainlesschain.db';
    }
  } catch (error) {
    console.error('选择路径失败:', error);
    message.error('打开文件夹选择对话框失败');
  }
};

const canProceed = () => {
  if (currentStep.value === 0) {
    return !!migrationType.value;
  }
  if (currentStep.value === 1) {
    if (migrationType.value === 'project') {
      return !!newPaths.project;
    }
    if (migrationType.value === 'database') {
      return !!newPaths.database;
    }
    if (migrationType.value === 'both') {
      return !!newPaths.project && !!newPaths.database;
    }
  }
  return true;
};

const nextStep = () => {
  if (currentStep.value < 3) {
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
};

const handleMigrate = async () => {
  try {
    migrating.value = true;
    migrationProgress.value = 0;
    currentStep.value = 3;

    // 模拟迁移进度（实际应该调用后端API）
    const progressInterval = setInterval(() => {
      if (migrationProgress.value < 90) {
        migrationProgress.value += 10;
      }
    }, 500);

    // 执行迁移
    if (migrationType.value === 'database' || migrationType.value === 'both') {
      migrationMessage.value = '正在迁移数据库...';
      await window.electronAPI.db.migrate(newPaths.database);
    }

    if (migrationType.value === 'project' || migrationType.value === 'both') {
      migrationMessage.value = '正在迁移项目文件...';
      await window.electronAPI.config.set('project.rootPath', newPaths.project);
    }

    clearInterval(progressInterval);
    migrationProgress.value = 100;
    migrationStatus.value = 'success';
    migrationMessage.value = '迁移完成！应用将在3秒后重启...';

    // 3秒后重启应用
    setTimeout(async () => {
      await window.electronAPI.app.restart();
    }, 3000);

    emit('complete');
  } catch (error) {
    console.error('迁移失败:', error);
    migrationStatus.value = 'error';
    migrationMessage.value = '迁移失败: ' + error.message;
    message.error('迁移失败: ' + error.message);
  } finally {
    migrating.value = false;
  }
};

const getMigrationStatusTitle = () => {
  if (migrating.value) {
    return '正在迁移...';
  }
  if (migrationStatus.value === 'success') {
    return '迁移成功';
  }
  if (migrationStatus.value === 'error') {
    return '迁移失败';
  }
  return '';
};

const handleCancel = () => {
  if (!migrating.value) {
    emit('close');
  }
};

const handleClose = () => {
  emit('close');
};
</script>

<style scoped>
.migration-steps {
  margin-bottom: 30px;
}

.migration-content {
  min-height: 300px;
  padding: 20px 0;
}

.step-panel {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.migration-alert {
  margin-top: 20px;
}

.migration-checkbox {
  margin-top: 20px;
  display: block;
}

.migration-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
}
</style>
