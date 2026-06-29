<template>
  <a-modal
    :open="open"
    :width="900"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="身份关联管理"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <LinkOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="il-toolbar">
      <span class="il-sub">将 DID 身份与 SSO 提供商关联</span>
      <a-button type="primary" size="small" @click="openLinkModal">
        <template #icon><LinkOutlined /></template>
        关联新身份
      </a-button>
    </div>

    <a-card size="small" class="il-section">
      <a-descriptions title="当前 DID 身份" :column="1" size="small">
        <a-descriptions-item label="DID 标识">
          <a-typography-text copyable>
            {{ currentDID || "未设置" }}
          </a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="身份状态">
          <a-badge
            :status="currentDID ? 'success' : 'default'"
            :text="currentDID ? '已激活' : '未激活'"
          />
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-card size="small" title="已关联身份" class="il-section">
      <a-table
        :columns="columns"
        :data-source="ssoStore.linkedIdentities"
        :loading="ssoStore.loading"
        row-key="id"
        size="small"
        :pagination="{ pageSize: 8 }"
        :scroll="{ x: 800 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'provider_name'">
            <a-tag :color="providerColor(record.provider_type)">
              {{ providerLabel(record.provider_type) }}
            </a-tag>
            {{ record.provider_name }}
          </template>
          <template v-else-if="column.key === 'sso_subject'">
            <a-typography-text
              ellipsis
              :content="record.sso_subject"
              style="max-width: 200px"
            />
          </template>
          <template v-else-if="column.key === 'verified'">
            <CheckCircleOutlined
              v-if="record.verified"
              :style="{ color: '#52c41a' }"
            />
            <CloseCircleOutlined v-else :style="{ color: '#ff4d4f' }" />
          </template>
          <template v-else-if="column.key === 'created_at'">
            {{ formatTime(record.created_at) }}
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                v-if="!record.verified"
                type="link"
                size="small"
                @click="verifyLink(record)"
              >
                验证
              </a-button>
              <a-popconfirm
                title="确定取消此身份关联?取消后需重新验证。"
                ok-text="确认取消"
                cancel-text="返回"
                @confirm="unlink(record.did, record.provider_id)"
              >
                <a-button type="link" size="small" danger>取消关联</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- link modal -->
    <a-modal
      v-model:open="linkModalVisible"
      title="关联新身份"
      :width="520"
      :confirm-loading="linking"
      :ok-button-props="{ disabled: !linkForm.providerId }"
      @ok="startLinking"
      @cancel="closeLinkModal"
    >
      <a-form
        :model="linkForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="SSO 提供商" required>
          <a-select
            v-model:value="linkForm.providerId"
            placeholder="选择要关联的 SSO 提供商"
            :loading="ssoStore.loading"
          >
            <a-select-option
              v-for="p in availableProviders"
              :key="p.id"
              :value="p.id"
            >
              <a-tag :color="providerColor(p.provider_type)">
                {{ providerLabel(p.provider_type) }}
              </a-tag>
              {{ p.provider_name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
          <a-alert
            type="info"
            show-icon
            message="身份关联流程"
            description="选择提供商后，系统将发起 SSO 登录以验证您的身份。验证成功后自动创建身份关联。"
          />
        </a-form-item>
      </a-form>
      <div v-if="linkingInProgress" class="il-progress">
        <a-spin tip="正在通过 SSO 验证身份…" />
        <a-button type="link" @click="cancelLinking">取消</a-button>
      </div>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import {
  LinkOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons-vue";
import dayjs from "dayjs";
import { useSSOStore } from "../stores/sso";
import { useAppStore } from "../stores/app";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const ssoStore = useSSOStore();
const appStore = useAppStore();

const linkModalVisible = ref(false);
const linking = ref(false);
const linkingInProgress = ref(false);
const linkForm = ref<{ providerId: string | undefined }>({
  providerId: undefined,
});

const currentDID = computed(() => appStore.deviceId || "");
const availableProviders = computed(() =>
  ssoStore.providers.filter((p: { enabled?: boolean }) => p.enabled),
);

const columns = [
  { title: "提供商", key: "provider_name", width: 200 },
  { title: "SSO 主体标识", key: "sso_subject", width: 220, ellipsis: true },
  { title: "验证状态", key: "verified", width: 90, align: "center" as const },
  { title: "关联时间", key: "created_at", width: 170 },
  { title: "操作", key: "actions", width: 160, fixed: "right" as const },
];

function providerColor(type?: string): string {
  return (
    { saml: "purple", oauth: "blue", oidc: "green" }[type || ""] || "default"
  );
}
function providerLabel(type?: string): string {
  return (
    { saml: "SAML", oauth: "OAuth 2.0", oidc: "OIDC" }[type || ""] || type || ""
  );
}
function formatTime(ts?: string | number): string {
  return ts ? dayjs(ts).format("YYYY-MM-DD HH:mm:ss") : "-";
}

function openLinkModal(): void {
  if (!currentDID.value) {
    message.warning("请先创建 DID 身份后再进行关联");
    return;
  }
  linkForm.value.providerId = undefined;
  linkingInProgress.value = false;
  linkModalVisible.value = true;
}
function closeLinkModal(): void {
  linkModalVisible.value = false;
  linkingInProgress.value = false;
}

async function startLinking(): Promise<void> {
  if (!linkForm.value.providerId) {
    message.warning("请选择 SSO 提供商");
    return;
  }
  linking.value = true;
  linkingInProgress.value = true;
  try {
    const res = await ssoStore.initiateLogin(linkForm.value.providerId);
    if (res.success && res.authUrl) {
      const w = window as unknown as {
        electronAPI?: {
          shell?: { openExternal?: (u: string) => Promise<unknown> };
        };
        electron?: {
          shell?: { openExternal?: (u: string) => Promise<unknown> };
        };
      };
      const opener =
        w.electronAPI?.shell?.openExternal || w.electron?.shell?.openExternal;
      if (opener) {
        await opener(res.authUrl);
      } else {
        window.open(res.authUrl, "_blank");
      }
    } else {
      message.error(res.error || "无法发起身份验证");
      linkingInProgress.value = false;
    }
  } catch {
    message.error("身份关联失败");
    linkingInProgress.value = false;
  } finally {
    linking.value = false;
  }
}

function cancelLinking(): void {
  linkingInProgress.value = false;
  message.info("已取消身份关联");
}

async function verifyLink(record: { id: string }): Promise<void> {
  try {
    const res = await ssoStore.verifyLink(record.id);
    if (res.success) {
      message.success("身份验证成功");
      await ssoStore.fetchLinkedIdentities();
    } else {
      message.error(res.error || "身份验证失败");
    }
  } catch {
    message.error("验证失败");
  }
}

async function unlink(did: string, providerId: string): Promise<void> {
  try {
    await ssoStore.unlinkIdentity(did, providerId);
    message.success("已取消身份关联");
  } catch {
    message.error("取消关联失败");
  }
}

// SSO callback listener — on success during a link flow, create the link
let callbackCleanup: (() => void) | null = null;
function setupCallbackListener(): void {
  const ipcRenderer = (
    window as unknown as {
      electron?: {
        ipcRenderer?: {
          on: (c: string, h: (...a: unknown[]) => void) => void;
          removeListener: (c: string, h: (...a: unknown[]) => void) => void;
        };
      };
    }
  ).electron?.ipcRenderer;
  if (!ipcRenderer) {
    return;
  }

  const handler = async (
    _event: unknown,
    result: { success?: boolean; ssoSubject?: string; error?: string },
  ): Promise<void> => {
    linkingInProgress.value = false;
    if (result.success && linkForm.value.providerId) {
      try {
        const linkRes = await ssoStore.createLink({
          providerId: linkForm.value.providerId,
          ssoSubject: result.ssoSubject,
          did: currentDID.value,
        });
        if (linkRes.success) {
          message.success("身份关联成功");
          linkModalVisible.value = false;
          await ssoStore.fetchLinkedIdentities();
        } else {
          message.error(linkRes.error || "创建身份关联失败");
        }
      } catch {
        message.error("创建身份关联失败");
      }
    } else if (!result.success) {
      message.error(result.error || "SSO 验证失败，无法创建关联");
    }
  };

  ipcRenderer.on("sso:link-callback", handler as (...a: unknown[]) => void);
  callbackCleanup = () =>
    ipcRenderer.removeListener(
      "sso:link-callback",
      handler as (...a: unknown[]) => void,
    );
}

function refresh(): void {
  Promise.all([ssoStore.fetchProviders(), ssoStore.fetchLinkedIdentities()]);
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      refresh();
    }
  },
  { immediate: true },
);

onMounted(setupCallbackListener);
onUnmounted(() => {
  callbackCleanup?.();
  callbackCleanup = null;
});
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
.il-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.il-sub {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.il-section {
  margin-bottom: 16px;
}
.il-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
</style>
