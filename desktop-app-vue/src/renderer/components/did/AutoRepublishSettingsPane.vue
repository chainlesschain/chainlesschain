<template>
  <a-modal
    v-model:open="openModel"
    title="自动重新发布设置"
    :width="600"
    @ok="handleSave"
  >
    <a-alert
      message="自动重新发布可以防止 DID 在 DHT 网络中过期"
      description="建议启用此功能以确保您的 DID 始终可被解析"
      type="info"
      show-icon
      style="margin-bottom: 24px"
    />

    <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
      <a-form-item label="启用自动重新发布">
        <a-switch v-model:checked="config.enabled" />
        <div class="form-hint">
          启用后，系统将定期重新发布已发布的 DID 到 DHT 网络
        </div>
      </a-form-item>

      <a-form-item v-if="config.enabled" label="重新发布间隔">
        <a-input-number
          v-model:value="config.intervalHours"
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
              :status="status.enabled ? 'processing' : 'default'"
              :text="status.enabled ? '运行中' : '已停止'"
            />
          </div>
          <div v-if="status.enabled">间隔: {{ status.intervalHours }} 小时</div>
          <a-button
            type="primary"
            :loading="republishing"
            @click="handleRepublishNow"
          >
            立即重新发布所有 DID
          </a-button>
        </a-space>
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, reactive, onMounted } from "vue";
import { message } from "ant-design-vue";
import { logger } from "@/utils/logger";

const openModel = defineModel("open", { type: Boolean, default: false });
const emit = defineEmits(["status-change", "after-republish"]);

const status = ref({ enabled: false, interval: 0, intervalHours: 0 });
const config = reactive({ enabled: false, intervalHours: 24 });
const republishing = ref(false);

async function loadStatus() {
  try {
    const result = await window.electronAPI.did.getAutoRepublishStatus();
    status.value = result;
    config.enabled = result.enabled;
    config.intervalHours = result.intervalHours;
    emit("status-change", result);
  } catch (error) {
    logger.error("[AutoRepublishSettingsPane] 加载状态失败:", error);
  }
}

async function handleSave() {
  try {
    const intervalMs = config.intervalHours * 60 * 60 * 1000;

    if (config.enabled) {
      await window.electronAPI.did.startAutoRepublish(intervalMs);
      message.success("自动重新发布已启用");
    } else {
      await window.electronAPI.did.stopAutoRepublish();
      message.success("自动重新发布已停止");
    }

    await loadStatus();
    openModel.value = false;
  } catch (error) {
    logger.error("[AutoRepublishSettingsPane] 保存配置失败:", error);
    message.error("保存配置失败: " + error.message);
  }
}

async function handleRepublishNow() {
  republishing.value = true;
  try {
    const result = await window.electronAPI.did.republishAll();

    if (result.failed > 0) {
      message.warning(
        `重新发布完成: ${result.success} 成功，${result.failed} 失败，${result.skipped} 跳过`,
      );
    } else {
      message.success(
        `成功重新发布 ${result.success} 个 DID${result.skipped > 0 ? `（跳过 ${result.skipped} 个未发布的 DID）` : ""}`,
      );
    }

    emit("after-republish");
  } catch (error) {
    logger.error("[AutoRepublishSettingsPane] 重新发布失败:", error);
    message.error("重新发布失败: " + error.message);
  } finally {
    republishing.value = false;
  }
}

onMounted(loadStatus);
</script>

<style scoped>
.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
</style>
