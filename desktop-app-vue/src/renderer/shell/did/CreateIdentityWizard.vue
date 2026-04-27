<template>
  <!-- Form modal: collect profile + (optional) recovery mnemonic -->
  <a-modal
    :open="store.creationFlow === 'form' || store.creationFlow === 'submitting'"
    :width="640"
    :confirm-loading="store.creationFlow === 'submitting'"
    :mask-closable="false"
    :keyboard="false"
    title="创建新的 DID 身份"
    ok-text="创建"
    cancel-text="取消"
    @ok="onSubmit"
    @cancel="onCancel"
  >
    <a-alert
      v-if="!form.useMnemonic"
      message="将自动生成 24 个单词的 BIP39 助记词"
      description="助记词是恢复身份的唯一凭证，下一步会要求您备份。"
      type="info"
      show-icon
      style="margin-bottom: 16px"
    />

    <a-form
      :model="form"
      :label-col="{ span: 6 }"
      :wrapper-col="{ span: 18 }"
      layout="horizontal"
    >
      <a-form-item label="创建方式">
        <a-radio-group v-model:value="form.useMnemonic">
          <a-radio :value="false"> <SafetyOutlined /> 生成新身份 </a-radio>
          <a-radio :value="true"> <KeyOutlined /> 从助记词恢复 </a-radio>
        </a-radio-group>
      </a-form-item>

      <a-form-item v-if="form.useMnemonic" label="助记词" required>
        <a-textarea
          v-model:value="form.mnemonic"
          placeholder="请输入 12 或 24 个助记词，用空格分隔"
          :rows="3"
          :maxlength="300"
        />
        <div class="form-hint">
          请确保助记词来源可靠，助记词错误或泄露将导致身份安全问题。
        </div>
      </a-form-item>

      <a-form-item label="昵称" required>
        <a-input
          v-model:value="form.nickname"
          placeholder="请输入昵称"
          :maxlength="50"
        />
      </a-form-item>

      <a-form-item label="个人简介">
        <a-textarea
          v-model:value="form.bio"
          placeholder="简单介绍一下自己（可选）"
          :rows="3"
          :maxlength="200"
          show-count
        />
      </a-form-item>

      <a-form-item label="头像">
        <a-input
          v-model:value="form.avatar"
          placeholder="头像路径或 URL（可选）"
        />
      </a-form-item>

      <a-form-item label="设为默认">
        <a-switch v-model:checked="form.setAsDefault" />
        <div class="form-hint">默认身份用于 P2P 通信和内容发布。</div>
      </a-form-item>
    </a-form>

    <a-alert
      v-if="store.creationError"
      class="form-error"
      :message="store.creationError"
      type="error"
      show-icon
      closable
      @close="store.clearCreationError()"
    />
  </a-modal>

  <!-- Mnemonic backup modal: shown after a brand-new identity is created -->
  <a-modal
    :open="store.creationFlow === 'mnemonic-display'"
    :width="700"
    :closable="false"
    :mask-closable="false"
    :keyboard="false"
    title="备份助记词"
  >
    <template #footer>
      <a-space>
        <a-button @click="onDownloadMnemonic">
          <DownloadOutlined /> 下载备份
        </a-button>
        <a-button type="primary" @click="onCopyMnemonic">
          <CopyOutlined /> 复制助记词
        </a-button>
        <a-button
          type="primary"
          danger
          :disabled="!store.mnemonicCopied"
          @click="onConfirmBackup"
        >
          我已安全备份
        </a-button>
      </a-space>
    </template>

    <a-alert
      message="请妥善保管助记词！"
      description="助记词是恢复身份的唯一凭证。任何人获得它都可以完全控制您的身份。请将其保存在离线安全的地方，不要截图或发送给他人。"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
    />

    <div class="mnemonic-grid">
      <div v-for="(word, i) in mnemonicWords" :key="i" class="mnemonic-word">
        <span class="word-number">{{ i + 1 }}</span>
        <span class="word-text">{{ word }}</span>
      </div>
    </div>

    <a-divider />

    <div class="mnemonic-full">
      <a-typography-paragraph :copyable="{ text: store.pendingMnemonic ?? '' }">
        <code>{{ store.pendingMnemonic }}</code>
      </a-typography-paragraph>
    </div>

    <a-alert
      v-if="store.mnemonicCopied"
      message="已复制到剪贴板，可以点击「我已安全备份」完成创建"
      type="success"
      show-icon
      style="margin-top: 12px"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { Modal, message as antMessage } from "ant-design-vue";
import {
  CopyOutlined,
  DownloadOutlined,
  KeyOutlined,
  SafetyOutlined,
} from "@ant-design/icons-vue";
import { useDIDManagementStore } from "../../stores/didManagement";

const store = useDIDManagementStore();

const form = reactive({
  nickname: "",
  bio: "",
  avatar: "",
  setAsDefault: false,
  useMnemonic: false,
  mnemonic: "",
});

watch(
  () => store.creationFlow,
  (next, prev) => {
    if (next === "form" && prev !== "submitting") {
      form.nickname = "";
      form.bio = "";
      form.avatar = "";
      form.setAsDefault = false;
      form.useMnemonic = false;
      form.mnemonic = "";
    }
  },
);

const mnemonicWords = computed<string[]>(() =>
  (store.pendingMnemonic ?? "").split(/\s+/).filter(Boolean),
);

async function onSubmit(): Promise<void> {
  await store.createIdentity({
    nickname: form.nickname,
    bio: form.bio,
    avatar: form.avatar,
    setAsDefault: form.setAsDefault,
    importMnemonic: form.useMnemonic ? form.mnemonic : undefined,
  });
}

function onCancel(): void {
  store.closeCreateForm();
}

async function onCopyMnemonic(): Promise<void> {
  const text = store.pendingMnemonic ?? "";
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    store.markMnemonicCopied();
    antMessage.success("助记词已复制到剪贴板");
  } catch (e) {
    antMessage.error(`复制失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function onDownloadMnemonic(): void {
  const text = store.pendingMnemonic ?? "";
  if (!text) {
    return;
  }
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mnemonic-backup-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  store.markMnemonicCopied();
  antMessage.success("助记词已下载");
}

function onConfirmBackup(): void {
  if (!store.mnemonicCopied) {
    Modal.warning({
      title: "请先复制或下载助记词",
      content: "助记词是恢复身份的唯一方式，请务必先备份再继续。",
    });
    return;
  }
  store.dismissMnemonic();
  antMessage.success("身份创建完成");
}
</script>

<style scoped>
.form-hint {
  font-size: 12px;
  color: var(--cc-shell-muted, #999);
  margin-top: 4px;
}

.form-error {
  margin-top: 12px;
}

.mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.mnemonic-word {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border: 1px solid var(--cc-shell-border, #e8e8e8);
  border-radius: 4px;
}

.word-number {
  font-size: 12px;
  color: var(--cc-shell-muted, #999);
  font-weight: 600;
  min-width: 22px;
}

.word-text {
  font-size: 14px;
  font-family: var(
    --cc-shell-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
  font-weight: 500;
  color: var(--cc-shell-text, #1f1f1f);
}

.mnemonic-full {
  background: var(--cc-shell-card, #fafafa);
  padding: 12px 16px;
  border-radius: 4px;
  border: 1px dashed var(--cc-shell-border, #d9d9d9);
}

.mnemonic-full code {
  word-break: break-all;
  font-size: 13px;
  line-height: 1.8;
}

@media (max-width: 768px) {
  .mnemonic-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
