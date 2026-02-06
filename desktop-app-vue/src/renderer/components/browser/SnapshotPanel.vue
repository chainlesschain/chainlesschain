<template>
  <div class="snapshot-panel">
    <a-card title="页面快照" :bordered="false">
      <!-- 快照控制栏 -->
      <div class="snapshot-controls">
        <a-space>
          <a-button
            type="primary"
            @click="handleTakeSnapshot"
            :loading="loading.snapshot"
            :disabled="!targetId"
          >
            <template #icon><ScanOutlined /></template>
            获取快照
          </a-button>

          <a-button
            @click="handleClearSnapshot"
            :disabled="!snapshot"
          >
            <template #icon><ClearOutlined /></template>
            清除
          </a-button>

          <a-statistic
            v-if="snapshot"
            title="元素数量"
            :value="snapshot.elementsCount"
            prefix=""
            :value-style="{ fontSize: '14px' }"
          />

          <a-tag v-if="snapshot" color="green">
            {{ new Date(snapshot.timestamp).toLocaleTimeString() }}
          </a-tag>
        </a-space>
      </div>

      <a-divider v-if="snapshot" />

      <!-- 元素列表 -->
      <div v-if="snapshot && snapshot.elements.length > 0" class="elements-list">
        <a-table
          :dataSource="snapshot.elements"
          :columns="columns"
          :pagination="{ pageSize: 10, showSizeChanger: true, showQuickJumper: true }"
          size="small"
          :scroll="{ y: 400 }"
        >
          <template #bodyCell="{ column, record }">
            <!-- 引用列 -->
            <template v-if="column.key === 'ref'">
              <a-tag
                color="blue"
                style="cursor: pointer"
                @click="handleCopyRef(record.ref)"
              >
                {{ record.ref }}
              </a-tag>
            </template>

            <!-- 角色列 -->
            <template v-if="column.key === 'role'">
              <a-tag :color="getRoleColor(record.role)">
                {{ record.role }}
              </a-tag>
            </template>

            <!-- 标签列 -->
            <template v-if="column.key === 'label'">
              <a-tooltip :title="record.label">
                <span class="label-text">{{ record.label }}</span>
              </a-tooltip>
            </template>

            <!-- 操作列 -->
            <template v-if="column.key === 'actions'">
              <a-space size="small">
                <a-tooltip title="点击">
                  <a-button
                    type="text"
                    size="small"
                    @click="handleClick(record.ref)"
                    :loading="loading.action === record.ref"
                  >
                    <AimOutlined />
                  </a-button>
                </a-tooltip>

                <a-tooltip title="输入">
                  <a-button
                    type="text"
                    size="small"
                    @click="handleShowTypeDialog(record)"
                    :disabled="!isTypable(record)"
                  >
                    <EditOutlined />
                  </a-button>
                </a-tooltip>

                <a-tooltip title="详情">
                  <a-button
                    type="text"
                    size="small"
                    @click="handleShowDetails(record)"
                  >
                    <InfoCircleOutlined />
                  </a-button>
                </a-tooltip>
              </a-space>
            </template>
          </template>
        </a-table>
      </div>

      <!-- 空状态 -->
      <a-empty
        v-else-if="!snapshot"
        description="暂无快照，点击上方按钮获取"
      />
    </a-card>

    <!-- 输入文本对话框 -->
    <a-modal
      v-model:open="typeDialog.visible"
      title="输入文本"
      @ok="handleTypeSubmit"
      :confirmLoading="loading.action !== null"
    >
      <a-form layout="vertical">
        <a-form-item label="元素">
          <a-tag color="blue">{{ typeDialog.ref }}</a-tag>
          <span class="ml-2">{{ typeDialog.label }}</span>
        </a-form-item>

        <a-form-item label="文本">
          <a-input
            v-model:value="typeDialog.text"
            placeholder="输入文本内容"
            @keyup.enter="handleTypeSubmit"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 元素详情对话框 -->
    <a-modal
      v-model:open="detailsModal.visible"
      title="元素详情"
      :footer="null"
      width="600px"
    >
      <a-descriptions
        v-if="detailsModal.element"
        :column="1"
        bordered
        size="small"
      >
        <a-descriptions-item label="引用">
          {{ detailsModal.element.ref }}
        </a-descriptions-item>
        <a-descriptions-item label="标签">
          {{ detailsModal.element.tag }}
        </a-descriptions-item>
        <a-descriptions-item label="角色">
          {{ detailsModal.element.role }}
        </a-descriptions-item>
        <a-descriptions-item label="文本">
          {{ detailsModal.element.label }}
        </a-descriptions-item>
        <a-descriptions-item label="选择器">
          <code style="font-size: 11px">{{ detailsModal.element.selector }}</code>
        </a-descriptions-item>
        <a-descriptions-item label="位置">
          x: {{ Math.round(detailsModal.element.position.x) }},
          y: {{ Math.round(detailsModal.element.position.y) }},
          w: {{ Math.round(detailsModal.element.position.width) }},
          h: {{ Math.round(detailsModal.element.position.height) }}
        </a-descriptions-item>
        <a-descriptions-item label="属性">
          <a-tag v-for="[key, value] in detailAttributes" :key="key">
            {{ key }}: {{ value }}
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { message } from 'ant-design-vue';
import {
  ScanOutlined,
  ClearOutlined,
  AimOutlined,
  EditOutlined,
  InfoCircleOutlined
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  targetId: {
    type: String,
    default: null
  }
});

// 状态
const snapshot = ref(null);
const loading = reactive({
  snapshot: false,
  action: null
});

const typeDialog = reactive({
  visible: false,
  ref: '',
  label: '',
  text: ''
});

const detailsModal = reactive({
  visible: false,
  element: null
});

const detailAttributes = computed(() => {
  const attrs = detailsModal.element?.attributes || {};
  return Object.entries(attrs).filter(([, value]) => Boolean(value));
});

// 表格列定义
const columns = [
  { title: '引用', dataIndex: 'ref', key: 'ref', width: 80, fixed: 'left' },
  { title: '角色', dataIndex: 'role', key: 'role', width: 120 },
  { title: '标签', dataIndex: 'tag', key: 'tag', width: 80 },
  { title: '文本', dataIndex: 'label', key: 'label', ellipsis: true },
  { title: '操作', key: 'actions', width: 120, fixed: 'right' }
];

// 方法
const handleTakeSnapshot = async () => {
  if (!props.targetId) {
    message.warning('请先选择一个标签页');
    return;
  }

  loading.snapshot = true;
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:snapshot', props.targetId, {
      interactive: true,
      visible: true,
      roleRefs: true
    });

    snapshot.value = result;
    message.success(`快照成功，捕获 ${result.elementsCount} 个元素`);
  } catch (error) {
    message.error('快照失败: ' + error.message);
    console.error('Snapshot error:', error);
  } finally {
    loading.snapshot = false;
  }
};

const handleClearSnapshot = () => {
  snapshot.value = null;
  message.success('快照已清除');
};

const handleClick = async (ref) => {
  loading.action = ref;
  try {
    await window.electron.ipcRenderer.invoke('browser:act', props.targetId, 'click', ref, {
      waitFor: 'networkidle'
    });

    message.success(`已点击元素 ${ref}`);

    // 点击后可能导航，刷新快照
    setTimeout(() => {
      handleTakeSnapshot();
    }, 1000);
  } catch (error) {
    message.error('点击失败: ' + error.message);
    console.error('Click error:', error);
  } finally {
    loading.action = null;
  }
};

const handleShowTypeDialog = (element) => {
  typeDialog.ref = element.ref;
  typeDialog.label = element.label;
  typeDialog.text = '';
  typeDialog.visible = true;
};

const handleTypeSubmit = async () => {
  if (!typeDialog.text.trim()) {
    message.warning('请输入文本');
    return;
  }

  loading.action = typeDialog.ref;
  try {
    await window.electron.ipcRenderer.invoke('browser:act', props.targetId, 'type', typeDialog.ref, {
      text: typeDialog.text
    });

    message.success(`已输入文本到 ${typeDialog.ref}`);
    typeDialog.visible = false;
  } catch (error) {
    message.error('输入失败: ' + error.message);
    console.error('Type error:', error);
  } finally {
    loading.action = null;
  }
};

const handleShowDetails = (element) => {
  detailsModal.element = element;
  detailsModal.visible = true;
};

const handleCopyRef = (ref) => {
  navigator.clipboard.writeText(ref);
  message.success(`已复制引用: ${ref}`);
};

const getRoleColor = (role) => {
  const colorMap = {
    button: 'blue',
    link: 'green',
    textbox: 'orange',
    checkbox: 'purple',
    combobox: 'cyan',
    heading: 'red',
    img: 'magenta',
    list: 'geekblue'
  };
  return colorMap[role] || 'default';
};

const isTypable = (element) => {
  return ['textbox', 'searchbox', 'combobox'].includes(element.role);
};

// 暴露方法给父组件
defineExpose({
  takeSnapshot: handleTakeSnapshot,
  clearSnapshot: handleClearSnapshot
});
</script>

<style scoped lang="less">
.snapshot-panel {
  .snapshot-controls {
    margin-bottom: 16px;
  }

  .elements-list {
    .label-text {
      display: inline-block;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .ml-2 {
    margin-left: 8px;
  }
}

:deep(.ant-table-small) {
  font-size: 12px;
}

:deep(.ant-statistic-title) {
  font-size: 12px;
  margin-bottom: 0;
}
</style>
