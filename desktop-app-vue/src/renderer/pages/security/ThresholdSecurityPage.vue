<template>
  <div class="threshold-security-page">
    <a-page-header
      title="Threshold Security"
      sub-title="2-of-3 Shamir Threshold Signatures & Biometric Binding"
    >
      <template #extra>
        <a-button
          type="primary"
          @click="showSetupModal = true"
        >
          Setup New Key
        </a-button>
      </template>
    </a-page-header>

    <a-tabs v-model:active-key="activeTab">
      <!-- Key Shares Tab -->
      <a-tab-pane
        key="shares"
        tab="Key Shares"
      >
        <a-spin :spinning="store.loading">
          <a-empty
            v-if="store.keys.length === 0"
            description="No threshold keys configured"
          />
          <a-row
            v-else
            :gutter="[16, 16]"
          >
            <a-col
              v-for="key in store.keys"
              :key="key.key_id"
              :span="8"
            >
              <a-card
                :title="key.key_id"
                size="small"
              >
                <a-descriptions
                  :column="1"
                  size="small"
                >
                  <a-descriptions-item label="Shares">
                    {{ key.share_count }} / 3
                  </a-descriptions-item>
                  <a-descriptions-item label="Created">
                    {{ formatDate(key.created_at) }}
                  </a-descriptions-item>
                  <a-descriptions-item label="Public Key">
                    <a-typography-text
                      code
                      copyable
                      :content="key.public_key"
                    >
                      {{ truncate(key.public_key) }}
                    </a-typography-text>
                  </a-descriptions-item>
                </a-descriptions>
                <template #actions>
                  <a-button
                    size="small"
                    @click="handleSign(key.key_id)"
                  >
                    Sign
                  </a-button>
                  <a-button
                    size="small"
                    @click="handleBindBiometric(key.key_id)"
                  >
                    Bind Biometric
                  </a-button>
                </template>
              </a-card>
            </a-col>
          </a-row>
        </a-spin>
      </a-tab-pane>

      <!-- Biometric Bindings Tab -->
      <a-tab-pane
        key="biometrics"
        tab="Biometric Bindings"
      >
        <a-table
          :columns="biometricColumns"
          :data-source="store.bindings"
          :loading="store.loading"
          row-key="id"
          size="small"
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
                  type="link"
                  @click="handleVerify(record)"
                >
                  Verify
                </a-button>
                <a-popconfirm
                  title="Unbind this biometric?"
                  @confirm="handleUnbind(record)"
                >
                  <a-button
                    size="small"
                    type="link"
                    danger
                  >
                    Unbind
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- Setup Modal -->
    <a-modal
      v-model:open="showSetupModal"
      title="Setup Threshold Key"
      :confirm-loading="store.loading"
      @ok="handleSetup"
    >
      <a-form layout="vertical">
        <a-form-item label="Key ID">
          <a-input
            v-model:value="setupForm.keyId"
            placeholder="Enter a unique key identifier"
          />
        </a-form-item>
        <a-form-item label="Share Sources">
          <a-checkbox-group
            v-model:value="setupForm.sources"
            :options="sourceOptions"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useThresholdSecurityStore } from '../../stores/thresholdSecurity';

const store = useThresholdSecurityStore();
const activeTab = ref('shares');
const showSetupModal = ref(false);

const setupForm = ref({
  keyId: '',
  sources: ['ukey', 'simkey', 'tee'],
});

const sourceOptions = [
  { label: 'U-Key', value: 'ukey' },
  { label: 'SIMKey', value: 'simkey' },
  { label: 'TEE', value: 'tee' },
];

const biometricColumns = [
  { title: 'Key ID', dataIndex: 'key_id', key: 'key_id' },
  { title: 'Type', dataIndex: 'biometric_type', key: 'biometric_type' },
  { title: 'Status', key: 'status' },
  { title: 'Bound At', dataIndex: 'bound_at', key: 'bound_at', customRender: ({ text }: any) => formatDate(text) },
  { title: 'Verifications', dataIndex: 'verification_count', key: 'verification_count' },
  { title: 'Actions', key: 'actions' },
];

function formatDate(ts: number) {
  if (!ts) {return '-';}
  return new Date(ts * 1000).toLocaleDateString();
}

function truncate(s: string) {
  if (!s) {return '';}
  return s.length > 20 ? s.slice(0, 20) + '...' : s;
}

async function handleSetup() {
  if (!setupForm.value.keyId) {
    message.warning('Please enter a key ID');
    return;
  }
  const result = await store.setupKeys(setupForm.value.keyId, setupForm.value.sources);
  if (result.success) {
    message.success('Threshold key created');
    showSetupModal.value = false;
    setupForm.value.keyId = '';
  } else {
    message.error(result.error || 'Setup failed');
  }
}

async function handleSign(keyId: string) {
  message.info(`Sign with key ${keyId} - select 2 share sources`);
}

async function handleBindBiometric(keyId: string) {
  message.info(`Bind biometric to key ${keyId}`);
}

async function handleVerify(record: any) {
  message.info(`Verify ${record.biometric_type} for key ${record.key_id}`);
}

async function handleUnbind(record: any) {
  message.info(`Unbinding ${record.biometric_type} from key ${record.key_id}`);
}

onMounted(async () => {
  await store.loadKeys();
  await store.loadBindings();
});
</script>

<style lang="less" scoped>
.threshold-security-page {
  padding: 24px;
}
</style>
