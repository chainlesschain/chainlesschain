<template>
  <div class="webauthn-page">
    <a-page-header
      title="WebAuthn / Passkey 管理"
      sub-title="FIDO2 无密码认证"
    />

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="总 Passkey 数" :value="stats?.totalPasskeys ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="活跃" :value="stats?.activePasskeys ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="已撤销" :value="stats?.revokedPasskeys ?? 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="认证仪式" :value="stats?.totalCeremonies ?? 0" />
      </a-col>
    </a-row>

    <a-card title="Passkey 列表" :loading="loading">
      <template #extra>
        <a-button type="primary" @click="showRegisterModal = true">
          注册新 Passkey
        </a-button>
      </template>
      <a-table
        :data-source="passkeys"
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
              <a-button size="small" @click="handleBindDID(record)">
                绑定 DID
              </a-button>
              <a-popconfirm
                title="确定删除?"
                @confirm="handleDelete(record.credentialId)"
              >
                <a-button size="small" danger> 删除 </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-modal
      v-model:open="showRegisterModal"
      title="注册 Passkey"
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
          <a-input v-model:value="registerForm.userId" />
        </a-form-item>
        <a-form-item label="用户名">
          <a-input v-model:value="registerForm.userName" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from "vue";
import { useWebAuthnStore } from "../stores/webauthn";
import { message } from "ant-design-vue";

const store = useWebAuthnStore();
const passkeys = computed(() => store.passkeys);
const stats = computed(() => store.stats);
const loading = computed(() => store.loading);

const showRegisterModal = ref(false);
const registerForm = reactive({
  rpId: "chainlesschain.local",
  rpName: "ChainlessChain",
  userId: "",
  userName: "",
});

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
  { title: "操作", key: "actions", width: 200 },
];

onMounted(async () => {
  await Promise.all([store.loadPasskeys(), store.loadStats()]);
});

async function handleRegister() {
  try {
    await store.registerPasskey(
      registerForm.rpId,
      registerForm.rpName,
      registerForm.userId,
      registerForm.userName,
    );
    message.success("Passkey 注册流程已启动");
    showRegisterModal.value = false;
  } catch {
    message.error("注册失败");
  }
}

async function handleDelete(credentialId: string) {
  await store.deletePasskey(credentialId);
  message.success("Passkey 已删除");
}

async function handleBindDID(record: { credentialId: string }) {
  // In a real app this would open a DID selection modal
  await store.bindDID(record.credentialId, "did:chainless:user-bound");
  message.success("DID 已绑定");
}
</script>

<style scoped>
.webauthn-page {
  padding: 24px;
}
</style>
