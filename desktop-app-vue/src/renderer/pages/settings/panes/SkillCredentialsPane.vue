<template>
  <a-card title="Bundled Skill 凭据">
    <a-alert
      type="info"
      show-icon
      message="凭据由操作系统加密存储"
      description="已保存的明文不会返回到界面。Bundled Skill 只有在执行审批通过后，才能通过受控 environment authority 使用对应凭据。"
      style="margin-bottom: 16px"
    />

    <a-spin :spinning="loading">
      <a-form layout="vertical">
        <div
          v-for="credential in credentials"
          :key="credential.key"
          class="credential-row"
        >
          <div class="credential-heading">
            <div>
              <div class="credential-label">{{ credential.label }}</div>
              <div class="credential-description">
                {{ credential.description }}
              </div>
            </div>
            <a-tag :color="configured[credential.key] ? 'green' : 'default'">
              {{ configured[credential.key] ? "已配置" : "未配置" }}
            </a-tag>
          </div>

          <div class="credential-actions">
            <a-input-password
              v-model:value="drafts[credential.key]"
              :placeholder="credential.placeholder"
              :maxlength="16384"
              autocomplete="new-password"
              @press-enter="saveCredential(credential.key)"
            />
            <a-button
              type="primary"
              :loading="saving[credential.key]"
              :disabled="!drafts[credential.key].trim()"
              @click="saveCredential(credential.key)"
            >
              保存
            </a-button>
            <a-popconfirm
              title="确定清除此凭据吗？"
              ok-text="清除"
              cancel-text="取消"
              @confirm="clearCredential(credential.key)"
            >
              <a-button
                danger
                :loading="clearing[credential.key]"
                :disabled="!configured[credential.key]"
              >
                清除
              </a-button>
            </a-popconfirm>
          </div>
        </div>
      </a-form>
    </a-spin>
  </a-card>
</template>

<script setup lang="ts">
import { message } from "ant-design-vue";
import { onMounted, reactive, ref } from "vue";

const credentials = [
  {
    key: "google-client-id",
    label: "Google OAuth Client ID",
    description: "Google Workspace OAuth 客户端标识。",
    placeholder: "输入 Google OAuth Client ID",
  },
  {
    key: "google-client-secret",
    label: "Google OAuth Client Secret",
    description: "Google Workspace OAuth 客户端密钥。",
    placeholder: "输入 Google OAuth Client Secret",
  },
  {
    key: "google-refresh-token",
    label: "Google OAuth Refresh Token",
    description: "推荐配置，用于刷新 Google Workspace 访问令牌。",
    placeholder: "输入 Google OAuth Refresh Token",
  },
  {
    key: "google-access-token",
    label: "Google OAuth Access Token",
    description: "可选的短期 Google Workspace 访问令牌。",
    placeholder: "输入 Google OAuth Access Token",
  },
  {
    key: "notion-api-key",
    label: "Notion API Key",
    description: "Notion 集成使用的内部集成令牌。",
    placeholder: "输入 Notion API Key",
  },
  {
    key: "tavily-api-key",
    label: "Tavily API Key",
    description: "Tavily 搜索 Skill 使用的 API Key。",
    placeholder: "输入 Tavily API Key",
  },
] as const;

type CredentialKey = (typeof credentials)[number]["key"];
type BooleanState = Record<CredentialKey, boolean>;
type DraftState = Record<CredentialKey, string>;

const createState = <T,>(value: T): Record<CredentialKey, T> =>
  Object.fromEntries(
    credentials.map((credential) => [credential.key, value]),
  ) as Record<CredentialKey, T>;

const loading = ref(false);
const configured = reactive<BooleanState>(createState(false));
const drafts = reactive<DraftState>(createState(""));
const saving = reactive<BooleanState>(createState(false));
const clearing = reactive<BooleanState>(createState(false));

const getApi = () => {
  const api = window.electronAPI?.markdownSkills;
  if (!api) {
    throw new Error("Bundled Skill 凭据能力不可用");
  }
  return api;
};

const refreshStatus = async () => {
  loading.value = true;
  try {
    const result = await getApi().getCredentialStatus();
    if (!result.success || !result.configured) {
      throw new Error(result.error || "读取凭据状态失败");
    }
    for (const credential of credentials) {
      configured[credential.key] = Boolean(result.configured[credential.key]);
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : "读取凭据状态失败");
  } finally {
    loading.value = false;
  }
};

const saveCredential = async (key: CredentialKey) => {
  const value = drafts[key].trim();
  if (!value || saving[key]) {
    return;
  }
  saving[key] = true;
  try {
    const result = await getApi().setCredential(key, value);
    if (!result.success) {
      throw new Error(result.error || "保存凭据失败");
    }
    drafts[key] = "";
    configured[key] = true;
    message.success("凭据已加密保存");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "保存凭据失败");
  } finally {
    saving[key] = false;
  }
};

const clearCredential = async (key: CredentialKey) => {
  if (clearing[key]) {
    return;
  }
  clearing[key] = true;
  try {
    const result = await getApi().clearCredential(key);
    if (!result.success) {
      throw new Error(result.error || "清除凭据失败");
    }
    drafts[key] = "";
    configured[key] = false;
    message.success("凭据已清除");
  } catch (error) {
    message.error(error instanceof Error ? error.message : "清除凭据失败");
  } finally {
    clearing[key] = false;
  }
};

onMounted(refreshStatus);
</script>

<style scoped>
.credential-row {
  padding: 16px 0;
  border-bottom: 1px solid var(--ant-color-border-secondary, #f0f0f0);
}

.credential-row:first-child {
  padding-top: 0;
}

.credential-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.credential-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.credential-label {
  font-weight: 600;
}

.credential-description {
  margin-top: 2px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.credential-actions {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto auto;
  gap: 8px;
}

@media (max-width: 720px) {
  .credential-actions {
    grid-template-columns: 1fr;
  }
}
</style>
