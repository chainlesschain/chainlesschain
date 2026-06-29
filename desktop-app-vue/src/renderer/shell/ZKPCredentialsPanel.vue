<template>
  <a-modal
    :open="open"
    :width="860"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="ZKP 可验证凭证"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <SafetyCertificateOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="store.error"
      class="zk-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.clearError()"
    />

    <a-row :gutter="16" class="zk-stats">
      <a-col :span="6">
        <a-statistic
          title="总凭证数"
          :value="store.stats?.totalCredentials ?? 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="活跃"
          :value="store.stats?.activeCredentials ?? 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="已撤销"
          :value="store.stats?.revokedCredentials ?? 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="总证明数" :value="store.stats?.totalProofs ?? 0" />
      </a-col>
    </a-row>

    <a-card size="small" title="凭证列表" :loading="store.loading">
      <template #extra>
        <a-button type="primary" size="small" @click="showIssueModal = true">
          签发凭证
        </a-button>
      </template>
      <a-table
        :data-source="store.credentials"
        :columns="columns"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 8 }"
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
                ok-text="撤销"
                cancel-text="取消"
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

    <a-modal
      v-model:open="showIssueModal"
      title="签发凭证"
      :confirm-loading="issuing"
      @ok="handleIssue"
    >
      <a-form layout="vertical">
        <a-form-item label="凭证类型">
          <a-select v-model:value="issueForm.type">
            <a-select-option value="identity">身份</a-select-option>
            <a-select-option value="membership">会员</a-select-option>
            <a-select-option value="qualification">资质</a-select-option>
            <a-select-option value="access">访问权限</a-select-option>
            <a-select-option value="custom">自定义</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="签发者 DID">
          <a-input
            v-model:value="issueForm.issuerDid"
            placeholder="did:chainless:..."
          />
        </a-form-item>
        <a-form-item label="持有者 DID">
          <a-input
            v-model:value="issueForm.subjectDid"
            placeholder="did:chainless:..."
          />
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
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { message } from "ant-design-vue";
import { SafetyCertificateOutlined } from "@ant-design/icons-vue";
import {
  useZKPCredentialsStore,
  type ZKPCredential,
} from "../stores/zkpCredentials";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useZKPCredentialsStore();

const showIssueModal = ref(false);
const issuing = ref(false);
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
  { title: "操作", key: "actions", width: 160 },
];

// Load on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      Promise.all([store.loadCredentials(), store.loadStats()]);
    }
  },
  { immediate: true },
);

async function handleIssue(): Promise<void> {
  let claims: Record<string, unknown> = {};
  if (issueForm.claimsJson.trim()) {
    try {
      claims = JSON.parse(issueForm.claimsJson);
    } catch {
      message.error("声明 JSON 格式错误");
      return;
    }
  }
  issuing.value = true;
  try {
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
  } finally {
    issuing.value = false;
  }
}

async function handleRevoke(credentialId: string): Promise<void> {
  await store.revokeCredential(
    credentialId,
    "did:chainless:current-user",
    "手动撤销",
  );
  message.success("凭证已撤销");
}

async function handlePresent(record: ZKPCredential): Promise<void> {
  try {
    await store.createPresentation(record.id);
    message.success("凭证出示成功");
  } catch {
    message.error("凭证出示失败");
  }
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
.zk-error {
  margin-bottom: 12px;
}
.zk-stats {
  margin-bottom: 16px;
}
</style>
