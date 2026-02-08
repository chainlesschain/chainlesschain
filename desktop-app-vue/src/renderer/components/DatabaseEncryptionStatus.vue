<template>
  <div class="encryption-status">
    <a-space :size="8">
      <a-tooltip>
        <template #title>
          {{ statusTooltip }}
        </template>
        <a-badge :status="badgeStatus" :text="statusText" />
      </a-tooltip>

      <a-tag
        v-if="encryptionInfo.isEncrypted"
        color="success"
        style="margin: 0"
      >
        <template #icon>
          <SafetyOutlined />
        </template>
        {{ encryptionInfo.method === "ukey" ? "U-Key 加密" : "AES-256" }}
      </a-tag>

      <a-tag v-else color="warning" style="margin: 0">
        <template #icon>
          <WarningOutlined />
        </template>
        未加密
      </a-tag>
    </a-space>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted } from "vue";
import { SafetyOutlined, WarningOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  showDetails: {
    type: Boolean,
    default: false,
  },
});

const encryptionInfo = ref({
  isEncrypted: false,
  method: null,
  engine: null,
});

const badgeStatus = computed(() => {
  return encryptionInfo.value.isEncrypted ? "success" : "warning";
});

const statusText = computed(() => {
  if (!encryptionInfo.value.engine) {
    return "数据库未初始化";
  }
  return encryptionInfo.value.engine === "sqlcipher" ? "SQLCipher" : "sql.js";
});

const statusTooltip = computed(() => {
  if (!encryptionInfo.value.isEncrypted) {
    return "数据库未加密，建议在设置中启用加密以保护隐私数据";
  }

  const method =
    encryptionInfo.value.method === "ukey" ? "U-Key 硬件密钥" : "密码派生";
  return `数据库已加密 | 引擎: ${statusText.value} | 密钥来源: ${method}`;
});

// 获取加密状态
const fetchEncryptionStatus = async () => {
  try {
    const status = await window.electronAPI.db.getEncryptionStatus();
    encryptionInfo.value = status;
  } catch (error) {
    logger.error("获取加密状态失败:", error);
  }
};

onMounted(() => {
  fetchEncryptionStatus();
});

// 导出刷新方法
defineExpose({
  refresh: fetchEncryptionStatus,
});
</script>

<style scoped lang="scss">
.encryption-status {
  display: inline-flex;
  align-items: center;
}
</style>
