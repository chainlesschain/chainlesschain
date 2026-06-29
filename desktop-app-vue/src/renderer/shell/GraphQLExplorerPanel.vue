<template>
  <a-modal
    :open="open"
    :width="900"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="GraphQL API Explorer"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ApiOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="store.error"
      class="gq-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.clearError()"
    />

    <a-row :gutter="16" class="gq-stats">
      <a-col :span="6">
        <a-statistic title="总查询数" :value="store.stats?.totalQueries ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="平均耗时(ms)"
          :value="store.stats?.avgDurationMs ?? 0"
          :precision="1"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="API Keys" :value="store.stats?.totalApiKeys ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="订阅数"
          :value="store.stats?.totalSubscriptions ?? 0"
        />
      </a-col>
    </a-row>

    <a-row :gutter="16">
      <a-col :span="12">
        <a-card size="small" title="查询编辑器">
          <a-textarea
            v-model:value="queryInput"
            :rows="9"
            placeholder="输入 GraphQL 查询..."
            class="gq-editor"
          />
          <a-button
            class="gq-run"
            type="primary"
            :loading="store.loading"
            @click="runQuery"
          >
            执行查询
          </a-button>
        </a-card>
      </a-col>
      <a-col :span="12">
        <a-card size="small" title="查询结果">
          <pre class="gq-result">{{ queryResultFormatted }}</pre>
        </a-card>
      </a-col>
    </a-row>

    <a-card size="small" title="API Keys" class="gq-section">
      <template #extra>
        <a-button type="primary" size="small" @click="showKeyModal = true">
          创建 API Key
        </a-button>
      </template>
      <a-table
        :data-source="store.apiKeys"
        :columns="keyColumns"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 5 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'active' ? 'green' : 'red'">
              {{ record.status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'actions'">
            <a-popconfirm
              title="确定撤销该 API Key?"
              ok-text="撤销"
              cancel-text="取消"
              @confirm="handleRevokeKey(record.id)"
            >
              <a-button size="small" danger>撤销</a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card size="small" title="查询日志" class="gq-section">
      <a-table
        :data-source="store.queryLog"
        :columns="logColumns"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 5 }"
      />
    </a-card>

    <a-modal
      v-model:open="showKeyModal"
      title="创建 API Key"
      :confirm-loading="creatingKey"
      @ok="handleCreateKey"
    >
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input
            v-model:value="keyForm.name"
            placeholder="例如：my-service"
          />
        </a-form-item>
        <a-form-item label="权限">
          <a-checkbox-group
            v-model:value="keyForm.permissions"
            :options="['query', 'mutation', 'subscription']"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { message } from "ant-design-vue";
import { ApiOutlined } from "@ant-design/icons-vue";
import { useGraphQLApiStore } from "../stores/graphqlApi";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useGraphQLApiStore();

const queryInput = ref(
  "{\n  stats {\n    totalPasskeys\n    totalProofs\n    totalCredentials\n  }\n}",
);
const showKeyModal = ref(false);
const creatingKey = ref(false);
const keyForm = reactive({ name: "", permissions: ["query"] as string[] });

const queryResultFormatted = computed(() =>
  store.queryResult
    ? JSON.stringify(store.queryResult, null, 2)
    : "// 结果将显示在这里",
);

const keyColumns = [
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "权限", dataIndex: "permissions", key: "permissions" },
  { title: "今日请求", dataIndex: "requestsToday", key: "requestsToday" },
  { title: "状态", key: "status" },
  { title: "操作", key: "actions", width: 90 },
];

const logColumns = [
  { title: "操作类型", dataIndex: "operationType", key: "operationType" },
  { title: "操作名称", dataIndex: "operationName", key: "operationName" },
  { title: "耗时(ms)", dataIndex: "durationMs", key: "durationMs" },
  { title: "状态", dataIndex: "status", key: "status" },
  { title: "时间", dataIndex: "createdAt", key: "createdAt" },
];

// Load on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      Promise.all([
        store.loadStats(),
        store.loadAPIKeys(),
        store.loadQueryLog(),
      ]);
    }
  },
  { immediate: true },
);

async function runQuery(): Promise<void> {
  try {
    await store.executeQuery(queryInput.value);
    message.success("查询执行成功");
  } catch {
    message.error("查询执行失败");
  }
}

async function handleCreateKey(): Promise<void> {
  if (!keyForm.name.trim()) {
    message.warning("请输入 API Key 名称");
    return;
  }
  creatingKey.value = true;
  try {
    const result = (await store.createAPIKey(
      keyForm.name.trim(),
      keyForm.permissions,
    )) as { key?: string } | undefined;
    const preview = result?.key ? `${result.key.substring(0, 8)}…` : "";
    message.success(`API Key 已创建${preview ? `: ${preview}` : ""}`);
    showKeyModal.value = false;
    keyForm.name = "";
    keyForm.permissions = ["query"];
  } catch {
    message.error("创建失败");
  } finally {
    creatingKey.value = false;
  }
}

async function handleRevokeKey(keyId: string): Promise<void> {
  await store.revokeAPIKey(keyId);
  message.success("API Key 已撤销");
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.gq-error {
  margin-bottom: 12px;
}
.gq-stats {
  margin-bottom: 16px;
}
.gq-editor {
  font-family: monospace;
}
.gq-run {
  margin-top: 12px;
}
.gq-result {
  max-height: 300px;
  overflow: auto;
  font-size: 12px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.gq-section {
  margin-top: 16px;
}
</style>
