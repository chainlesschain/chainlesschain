<template>
  <a-modal
    :open="store.autoRepublishOpen"
    :width="600"
    :confirm-loading="store.autoRepublishSaving"
    :mask-closable="!store.autoRepublishSaving"
    :keyboard="!store.autoRepublishSaving"
    title="自动重新发布设置"
    ok-text="保存"
    cancel-text="关闭"
    @ok="onSave"
    @cancel="onCancel"
  >
    <a-alert
      message="自动重新发布可以防止 DID 在 DHT 网络中过期"
      description="启用后系统会按设定间隔重新发布所有已发布到 DHT 的身份。建议保持开启。"
      type="info"
      show-icon
      style="margin-bottom: 20px"
    />

    <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
      <a-form-item label="启用自动重新发布">
        <a-switch v-model:checked="form.enabled" />
        <div class="form-hint">
          启用后系统会定期刷新 DHT 记录，避免被网络遗忘。
        </div>
      </a-form-item>

      <a-form-item v-if="form.enabled" label="重新发布间隔">
        <a-input-number
          v-model:value="form.intervalHours"
          :min="1"
          :max="168"
          :step="1"
          addon-after="小时"
          style="width: 100%"
        />
        <div class="form-hint">
          建议设置为 24 小时（1 天）。DHT 数据通常在 24-48 小时后过期。
        </div>
      </a-form-item>

      <a-form-item label="当前状态">
        <a-space direction="vertical" style="width: 100%">
          <div>
            <a-badge
              :status="
                store.autoRepublishStatus.enabled ? 'processing' : 'default'
              "
              :text="store.autoRepublishStatus.enabled ? '运行中' : '已停止'"
            />
          </div>
          <div v-if="store.autoRepublishStatus.enabled" class="muted">
            当前间隔：{{ store.autoRepublishStatus.intervalHours }} 小时
          </div>
          <a-button
            type="primary"
            :loading="store.republishingAll"
            @click="onRepublishNow"
          >
            <ReloadOutlined /> 立即重新发布所有 DID
          </a-button>
        </a-space>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { reactive, watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { useDIDManagementStore } from "../../stores/didManagement";

const store = useDIDManagementStore();

const form = reactive({
  enabled: false,
  intervalHours: 24,
});

watch(
  () => store.autoRepublishOpen,
  (open) => {
    if (open) {
      form.enabled = store.autoRepublishStatus.enabled;
      form.intervalHours = store.autoRepublishStatus.intervalHours || 24;
    }
  },
  { immediate: true },
);

watch(
  () => store.autoRepublishStatus,
  (status) => {
    if (store.autoRepublishOpen) {
      form.enabled = status.enabled;
      form.intervalHours = status.intervalHours || 24;
    }
  },
  { deep: true },
);

async function onSave(): Promise<void> {
  const ok = await store.saveAutoRepublishConfig({
    enabled: form.enabled,
    intervalHours: form.intervalHours,
  });
  if (ok) {
    antMessage.success(
      form.enabled ? "自动重新发布已启用" : "自动重新发布已停止",
    );
    store.closeAutoRepublishSettings();
  } else {
    antMessage.error(`保存失败: ${store.error ?? "未知错误"}`);
  }
}

function onCancel(): void {
  store.closeAutoRepublishSettings();
}

async function onRepublishNow(): Promise<void> {
  const result = await store.republishAll();
  if (!result) {
    antMessage.error(`重新发布失败: ${store.error ?? "未知错误"}`);
    return;
  }
  if (result.failed > 0) {
    antMessage.warning(
      `重新发布完成: ${result.success} 成功，${result.failed} 失败，${result.skipped} 跳过`,
    );
  } else {
    const skipped =
      result.skipped > 0 ? `（跳过 ${result.skipped} 个未发布的 DID）` : "";
    antMessage.success(`成功重新发布 ${result.success} 个 DID${skipped}`);
  }
}
</script>

<style scoped>
.form-hint {
  font-size: 12px;
  color: var(--cc-shell-muted, #999);
  margin-top: 4px;
}

.muted {
  color: var(--cc-shell-muted, #999);
  font-size: 12px;
}
</style>
