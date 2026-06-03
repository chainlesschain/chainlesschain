<template>
  <div class="graphql-explorer-page">
    <a-page-header title="GraphQL API Explorer" sub-title="统一查询接口" />

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="总查询数" :value="stats?.totalQueries ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="平均耗时(ms)"
          :value="stats?.avgDurationMs ?? 0"
          :precision="1"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="API Keys" :value="stats?.totalApiKeys ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="订阅数" :value="stats?.totalSubscriptions ?? 0" />
      </a-col>
    </a-row>

    <a-row :gutter="16">
      <a-col :span="12">
        <a-card title="查询编辑器">
          <a-textarea
            v-model:value="queryInput"
            :rows="10"
            placeholder="输入 GraphQL 查询..."
            style="font-family: monospace"
          />
          <div style="margin-top: 12px">
            <a-button type="primary" :loading="loading" @click="runQuery">
              执行查询
            </a-button>
          </div>
        </a-card>
      </a-col>
      <a-col :span="12">
        <a-card title="查询结果">
          <pre style="max-height: 400px; overflow: auto; font-size: 12px">{{
            queryResultFormatted
          }}</pre>
        </a-card>
      </a-col>
    </a-row>

    <a-card title="API Keys" style="margin-top: 16px">
      <template #extra>
        <a-button type="primary" @click="showKeyModal = true">
          创建 API Key
        </a-button>
      </template>
      <a-table
        :data-source="apiKeys"
        :columns="keyColumns"
        row-key="id"
        :pagination="{ pageSize: 10 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <a-tag :color="record.status === 'active' ? 'green' : 'red'">
              {{ record.status }}
            </a-tag>
          </template>
          <template v-if="column.key === 'actions'">
            <a-popconfirm
              title="确定撤销?"
              @confirm="handleRevokeKey(record.id)"
            >
              <a-button size="small" danger> 撤销 </a-button>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card title="查询日志" style="margin-top: 16px">
      <a-table
        :data-source="queryLog"
        :columns="logColumns"
        row-key="id"
        :pagination="{ pageSize: 10 }"
      />
    </a-card>

    <a-modal
      v-model:open="showKeyModal"
      title="创建 API Key"
      @ok="handleCreateKey"
    >
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input v-model:value="keyForm.name" />
        </a-form-item>
        <a-form-item label="权限">
          <a-checkbox-group
            v-model:value="keyForm.permissions"
            :options="['query', 'mutation', 'subscription']"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { useGraphQLApiStore } from "../stores/graphqlApi";
import { message } from "ant-design-vue";

const store = useGraphQLApiStore();
const stats = computed(() => store.stats);
const apiKeys = computed(() => store.apiKeys);
const queryLog = computed(() => store.queryLog);
const loading = computed(() => store.loading);
const queryResultFormatted = computed(() =>
  store.queryResult
    ? JSON.stringify(store.queryResult, null, 2)
    : "// 结果将显示在这里",
);

const queryInput = ref(
  "{\n  stats {\n    totalPasskeys\n    totalProofs\n    totalCredentials\n  }\n}",
);
const showKeyModal = ref(false);
const keyForm = reactive({ name: "", permissions: ["query"] as string[] });

const keyColumns = [
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "权限", dataIndex: "permissions", key: "permissions" },
  { title: "今日请求", dataIndex: "requestsToday", key: "requestsToday" },
  { title: "状态", key: "status" },
  { title: "操作", key: "actions", width: 100 },
];

const logColumns = [
  { title: "操作类型", dataIndex: "operationType", key: "operationType" },
  { title: "操作名称", dataIndex: "operationName", key: "operationName" },
  { title: "耗时(ms)", dataIndex: "durationMs", key: "durationMs" },
  { title: "状态", dataIndex: "status", key: "status" },
  { title: "时间", dataIndex: "createdAt", key: "createdAt" },
];

onMounted(async () => {
  await Promise.all([
    store.loadStats(),
    store.loadAPIKeys(),
    store.loadQueryLog(),
  ]);
});

async function runQuery() {
  try {
    await store.executeQuery(queryInput.value);
    message.success("查询执行成功");
  } catch {
    message.error("查询执行失败");
  }
}

async function handleCreateKey() {
  try {
    const result = await store.createAPIKey(keyForm.name, keyForm.permissions);
    message.success(`API Key 已创建: ${result.key?.substring(0, 8)}...`);
    showKeyModal.value = false;
    keyForm.name = "";
    keyForm.permissions = ["query"];
  } catch {
    message.error("创建失败");
  }
}

async function handleRevokeKey(keyId: string) {
  await store.revokeAPIKey(keyId);
  message.success("API Key 已撤销");
}
</script>

<style scoped>
.graphql-explorer-page {
  padding: 24px;
}
</style>
