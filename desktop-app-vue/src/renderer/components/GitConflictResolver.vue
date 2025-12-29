<template>
  <a-modal
    :open="visible"
    title="解决Git合并冲突"
    :width="1000"
    :footer="null"
    @cancel="handleCancel"
  >
    <a-spin :spinning="loading">
      <div v-if="conflicts.length === 0" class="no-conflicts">
        <a-result
          status="success"
          title="没有冲突"
          sub-title="所有冲突已解决，可以完成合并"
        >
          <template #extra>
            <a-space>
              <a-button type="primary" @click="handleCompleteMerge">
                <template #icon><check-circle-outlined /></template>
                完成合并
              </a-button>
              <a-button @click="handleCancel">
                取消
              </a-button>
            </a-space>
          </template>
        </a-result>
      </div>

      <div v-else class="conflict-list">
        <a-alert
          type="warning"
          message="检测到合并冲突"
          :description="`有 ${conflicts.length} 个文件存在冲突，请逐个解决`"
          show-icon
          style="margin-bottom: 16px"
        />

        <a-collapse v-model:activeKey="activeKeys" accordion>
          <a-collapse-panel
            v-for="(conflict, index) in conflicts"
            :key="conflict.filepath"
            :header="conflict.filepath"
          >
            <template #extra>
              <a-tag v-if="resolvedFiles.includes(conflict.filepath)" color="success">
                已解决
              </a-tag>
              <a-tag v-else color="error">
                未解决
              </a-tag>
            </template>

            <div class="conflict-content">
              <!-- 冲突详情 -->
              <div v-if="conflictDetails[conflict.filepath]" class="conflict-details">
                <a-row :gutter="16">
                  <!-- 本地版本 (ours) -->
                  <a-col :span="12">
                    <div class="version-header">
                      <a-badge status="processing" text="本地版本 (Ours)" />
                    </div>
                    <div class="version-content">
                      <pre>{{ conflictDetails[conflict.filepath].ours }}</pre>
                    </div>
                    <a-button
                      type="primary"
                      size="small"
                      @click="resolveConflict(conflict.filepath, 'ours')"
                    >
                      <template #icon><arrow-left-outlined /></template>
                      使用本地版本
                    </a-button>
                  </a-col>

                  <!-- 远程版本 (theirs) -->
                  <a-col :span="12">
                    <div class="version-header">
                      <a-badge status="warning" text="远程版本 (Theirs)" />
                    </div>
                    <div class="version-content">
                      <pre>{{ conflictDetails[conflict.filepath].theirs }}</pre>
                    </div>
                    <a-button
                      type="primary"
                      size="small"
                      @click="resolveConflict(conflict.filepath, 'theirs')"
                    >
                      <template #icon><arrow-right-outlined /></template>
                      使用远程版本
                    </a-button>
                  </a-col>
                </a-row>

                <a-divider>或</a-divider>

                <!-- 手动编辑 -->
                <div class="manual-edit">
                  <div class="version-header">
                    <a-badge status="default" text="手动编辑" />
                  </div>
                  <a-textarea
                    v-model:value="manualContent[conflict.filepath]"
                    :rows="10"
                    placeholder="在此输入手动解决后的内容..."
                  />
                  <a-button
                    type="primary"
                    size="small"
                    style="margin-top: 8px"
                    :disabled="!manualContent[conflict.filepath]"
                    @click="resolveConflict(conflict.filepath, 'manual', manualContent[conflict.filepath])"
                  >
                    <template #icon><edit-outlined /></template>
                    保存手动编辑
                  </a-button>
                </div>
              </div>

              <!-- 加载中 -->
              <div v-else class="loading-details">
                <a-spin tip="加载冲突详情..." />
              </div>
            </div>
          </a-collapse-panel>
        </a-collapse>

        <!-- 底部操作 -->
        <div class="conflict-actions">
          <a-space>
            <a-button
              type="primary"
              :disabled="!allResolved"
              @click="handleCompleteMerge"
            >
              <template #icon><check-circle-outlined /></template>
              完成合并
            </a-button>
            <a-button danger @click="handleAbortMerge">
              <template #icon><close-circle-outlined /></template>
              中止合并
            </a-button>
            <a-button @click="handleCancel">
              取消
            </a-button>
          </a-space>
        </div>
      </div>
    </a-spin>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  EditOutlined,
} from '@ant-design/icons-vue';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  conflicts: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['update:open', 'resolved', 'aborted']);

const loading = ref(false);
const activeKeys = ref([]);
const conflictDetails = ref({});
const resolvedFiles = ref([]);
const manualContent = ref({});

// 所有冲突是否已解决
const allResolved = computed(() => {
  return props.conflicts.length > 0 &&
    resolvedFiles.value.length === props.conflicts.length;
});

// 监听冲突列表变化
watch(
  () => props.conflicts,
  async (newConflicts) => {
    if (newConflicts.length > 0) {
      // 自动展开第一个冲突
      activeKeys.value = [newConflicts[0].filepath];
    }
  },
  { immediate: true }
);

// 监听面板展开，加载冲突详情
watch(activeKeys, async (newKeys) => {
  for (const filepath of newKeys) {
    if (!conflictDetails.value[filepath]) {
      await loadConflictContent(filepath);
    }
  }
});

// 加载冲突文件内容
const loadConflictContent = async (filepath) => {
  try {
    const result = await window.electronAPI.git.getConflictContent(filepath);

    if (result.conflicts && result.conflicts.length > 0) {
      // 取第一个冲突块（通常一个文件只有一个冲突块）
      const conflict = result.conflicts[0];
      conflictDetails.value[filepath] = {
        ours: conflict.ours || '(无内容)',
        theirs: conflict.theirs || '(无内容)',
        fullContent: result.fullContent,
      };

      // 初始化手动编辑内容为完整内容
      manualContent.value[filepath] = result.fullContent;
    }
  } catch (error) {
    console.error('加载冲突内容失败:', error);
    message.error(`加载冲突内容失败: ${filepath}`);
  }
};

// 解决冲突
const resolveConflict = async (filepath, resolution, content = null) => {
  try {
    loading.value = true;

    await window.electronAPI.git.resolveConflict(filepath, resolution, content);

    // 添加到已解决列表
    if (!resolvedFiles.value.includes(filepath)) {
      resolvedFiles.value.push(filepath);
    }

    message.success(`冲突已解决: ${filepath}`);

    // 如果所有冲突都解决了，提示用户
    if (allResolved.value) {
      message.success('所有冲突已解决，可以完成合并');
    }
  } catch (error) {
    console.error('解决冲突失败:', error);
    message.error(`解决冲突失败: ${error.message}`);
  } finally {
    loading.value = false;
  }
};

// 完成合并
const handleCompleteMerge = async () => {
  try {
    loading.value = true;

    await window.electronAPI.git.completeMerge('Merge completed (resolved conflicts)');

    message.success('合并已完成');
    emit('resolved');
    emit('update:open', false);
  } catch (error) {
    console.error('完成合并失败:', error);
    message.error(`完成合并失败: ${error.message}`);
  } finally {
    loading.value = false;
  }
};

// 中止合并
const handleAbortMerge = async () => {
  try {
    loading.value = true;

    await window.electronAPI.git.abortMerge();

    message.info('合并已中止');
    emit('aborted');
    emit('update:open', false);
  } catch (error) {
    console.error('中止合并失败:', error);
    message.error(`中止合并失败: ${error.message}`);
  } finally {
    loading.value = false;
  }
};

// 取消
const handleCancel = () => {
  emit('update:open', false);
};
</script>

<style scoped>
.no-conflicts {
  padding: 40px 0;
}

.conflict-list {
  max-height: 70vh;
  overflow-y: auto;
}

.conflict-content {
  padding: 16px 0;
}

.conflict-details {
  width: 100%;
}

.version-header {
  margin-bottom: 8px;
  font-weight: 500;
}

.version-content {
  background: #f5f5f5;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.version-content pre {
  margin: 0;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.manual-edit {
  margin-top: 16px;
}

.loading-details {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

.conflict-actions {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: flex-end;
}
</style>
