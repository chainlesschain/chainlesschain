<template>
  <a-modal
    :open="open"
    :width="860"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="WebAuthn / Passkey 管理"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <SafetyOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="store.error"
      class="wa-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.clearError()"
    />

    <a-row :gutter="16" class="wa-stats">
      <a-col :span="6">
        <a-statistic
          title="总 Passkey 数"
          :value="store.stats?.totalPasskeys ?? 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="活跃" :value="store.stats?.activePasskeys ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="已撤销"
          :value="store.stats?.revokedPasskeys ?? 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="认证仪式"
          :value="store.stats?.totalCeremonies ?? 0"
        />
      </a-col>
    </a-row>

    <a-card size="small" title="Passkey 列表" :loading="store.loading">
      <template #extra>
        <a-button type="primary" size="small" @click="showRegisterModal = true">
          注册新 Passkey
        </a-button>
      </template>
      <a-table
        :data-source="store.passkeys"
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
              <a-button size="small" @click="openBind(record)">
                绑定 DID
              </a-button>
              <a-popconfirm
                title="确定删除该 Passkey?"
                ok-text="删除"
                cancel-text="取消"
                @confirm="handleDelete(record.credentialId)"
              >
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-modal
      v-model:open="showRegisterModal"
      title="注册 Passkey"
      :confirm-loading="registering"
      @ok="handleRegister"
    >
      <a-form layout="vertical">
        <a-form-item label="RP ID">
          <a-input v-model:value="registerForm.rpId" />
        </a-form-item>
        <a-form-item label="RP 名称">
          <a-input v-model:value="registerForm.rpName" />
        </a-form-item>
        <a-form-item label="用户 ID">
          <a-input
            v-model:value="registerForm.userId"
            placeholder="用户唯一标识"
          />
        </a-form-item>
        <a-form-item label="用户名">
          <a-input v-model:value="registerForm.userName" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="showBindModal"
      title="绑定 DID"
      :confirm-loading="binding"
      @ok="handleBind"
    >
      <a-form layout="vertical">
        <a-form-item label="Credential ID">
          <a-input :value="bindTarget?.credentialId" disabled />
        </a-form-item>
        <a-form-item label="DID">
          <a-input
            v-model:value="bindDidValue"
            placeholder="did:chainless:..."
            @press-enter="handleBind"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from "vue";
import { message } from "ant-design-vue";
import { SafetyOutlined } from "@ant-design/icons-vue";
import { useWebAuthnStore, type Passkey } from "../stores/webauthn";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useWebAuthnStore();

const showRegisterModal = ref(false);
const registering = ref(false);
const registerForm = reactive({
  rpId: "chainlesschain.local",
  rpName: "ChainlessChain",
  userId: "",
  userName: "",
});

const showBindModal = ref(false);
const binding = ref(false);
const bindTarget = ref<Passkey | null>(null);
const bindDidValue = ref("");

const columns = [
  {
    title: "Credential ID",
    dataIndex: "credentialId",
    key: "credentialId",
    ellipsis: true,
  },
  { title: "RP", dataIndex: "rpId", key: "rpId" },
  { title: "用户", dataIndex: "userName", key: "userName" },
  {
    title: "DID 绑定",
    dataIndex: "didBinding",
    key: "didBinding",
    ellipsis: true,
  },
  { title: "状态", key: "status" },
  { title: "操作", key: "actions", width: 170 },
];

// Load on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      Promise.all([store.loadPasskeys(), store.loadStats()]);
    }
  },
  { immediate: true },
);

async function handleRegister(): Promise<void> {
  if (!registerForm.userName.trim()) {
    message.warning("请输入用户名");
    return;
  }
  registering.value = true;
  try {
    await store.registerPasskey(
      registerForm.rpId,
      registerForm.rpName,
      registerForm.userId || registerForm.userName,
      registerForm.userName,
    );
    message.success("Passkey 注册流程已启动（需在认证器上完成）");
    showRegisterModal.value = false;
  } catch {
    message.error("注册失败");
  } finally {
    registering.value = false;
  }
}

async function handleDelete(credentialId: string): Promise<void> {
  await store.deletePasskey(credentialId);
  message.success("Passkey 已删除");
}

function openBind(record: Passkey): void {
  bindTarget.value = record;
  bindDidValue.value = record.didBinding || "";
  showBindModal.value = true;
}

async function handleBind(): Promise<void> {
  const did = bindDidValue.value.trim();
  if (!did || !bindTarget.value) {
    message.warning("请输入 DID");
    return;
  }
  binding.value = true;
  try {
    await store.bindDID(bindTarget.value.credentialId, did);
    message.success("DID 已绑定");
    showBindModal.value = false;
  } catch {
    message.error("绑定失败");
  } finally {
    binding.value = false;
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
.wa-error {
  margin-bottom: 12px;
}
.wa-stats {
  margin-bottom: 16px;
}
</style>
