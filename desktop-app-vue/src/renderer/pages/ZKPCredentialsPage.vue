<template>
  <div class="zkp-credentials-page">
    <a-page-header
      title="ZKP 可验证凭证"
      sub-title="零知识证明凭证与选择性披露"
    />

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="总凭证数" :value="stats?.totalCredentials ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="活跃" :value="stats?.activeCredentials ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="已撤销" :value="stats?.revokedCredentials ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="总证明数" :value="stats?.totalProofs ?? 0" />
      </a-col>
    </a-row>

    <a-card title="凭证列表" :loading="loading">
      <template #extra>
        <a-button type="primary" @click="showIssueModal = true">
          签发凭证
        </a-button>
      </template>
      <a-table
        :data-source="credentials"
        :columns="columns"
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
            <a-space>
              <a-button
                size="small"
                :disabled="record.status !== 'active'"
                @click="handlePresent(record)"
              >
                出示
              </a-button>
              <a-popconfirm
                title="确定撤销此凭证?"
                :disabled="record.status !== 'active'"
                @confirm="handleRevoke(record.id)"
              >
                <a-button
                  size="small"
                  danger
                  :disabled="record.status !== 'active'"
                >
                  撤销
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-modal v-model:open="showIssueModal" title="签发凭证" @ok="handleIssue">
      <a-form layout="vertical">
        <a-form-item label="凭证类型">
          <a-select v-model:value="issueForm.type">
            <a-select-option value="identity"> 身份 </a-select-option>
            <a-select-option value="membership"> 会员 </a-select-option>
            <a-select-option value="qualification"> 资质 </a-select-option>
            <a-select-option value="access"> 访问权限 </a-select-option>
            <a-select-option value="custom"> 自定义 </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="签发者 DID">
          <a-input v-model:value="issueForm.issuerDid" />
        </a-form-item>
        <a-form-item label="持有者 DID">
          <a-input v-model:value="issueForm.subjectDid" />
        </a-form-item>
        <a-form-item label="声明 (JSON)">
          <a-textarea
            v-model:value="issueForm.claimsJson"
            :rows="4"
            placeholder='{"name":"Alice","role":"admin"}'
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { useZKPCredentialsStore } from "../stores/zkpCredentials";
import { message } from "ant-design-vue";

const store = useZKPCredentialsStore();
const credentials = computed(() => store.credentials);
const stats = computed(() => store.stats);
const loading = computed(() => store.loading);

const showIssueModal = ref(false);
const issueForm = reactive({
  type: "identity",
  issuerDid: "",
  subjectDid: "",
  claimsJson: "",
});

const columns = [
  { title: "类型", dataIndex: "type", key: "type" },
  { title: "签发者", dataIndex: "issuerDid", key: "issuerDid", ellipsis: true },
  {
    title: "持有者",
    dataIndex: "subjectDid",
    key: "subjectDid",
    ellipsis: true,
  },
  { title: "状态", key: "status" },
  { title: "操作", key: "actions", width: 200 },
];

onMounted(async () => {
  await Promise.all([store.loadCredentials(), store.loadStats()]);
});

async function handleIssue() {
  try {
    let claims = {};
    if (issueForm.claimsJson.trim()) {
      claims = JSON.parse(issueForm.claimsJson);
    }
    await store.issueCredential(
      issueForm.type,
      issueForm.issuerDid,
      issueForm.subjectDid,
      claims,
    );
    message.success("凭证签发成功");
    showIssueModal.value = false;
    issueForm.claimsJson = "";
  } catch {
    message.error("凭证签发失败");
  }
}

async function handleRevoke(credentialId: string) {
  await store.revokeCredential(
    credentialId,
    "did:chainless:current-user",
    "手动撤销",
  );
  message.success("凭证已撤销");
}

async function handlePresent(record: any) {
  try {
    await store.createPresentation(record.id);
    message.success("凭证出示成功");
  } catch {
    message.error("凭证出示失败");
  }
}
</script>

<style scoped>
.zkp-credentials-page {
  padding: 24px;
}
</style>
