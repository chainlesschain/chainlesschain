<template>
  <a-modal
    :open="visible"
    :title="title"
    :closable="!loading"
    :footer="null"
    :mask-closable="false"
    width="400px"
    @cancel="handleCancel"
  >
    <div class="biometric-prompt">
      <!-- 指纹图标 -->
      <div
        class="fingerprint-icon-wrapper"
        :class="{ scanning: loading, success: succeeded, failed: failedOnce }"
      >
        <div class="fingerprint-icon">
          🖐
        </div>
        <div
          v-if="loading"
          class="scan-ring"
        />
      </div>

      <!-- 状态提示 -->
      <div class="prompt-message">
        <a-spin
          v-if="loading"
          :tip="statusMessage"
        />
        <a-result
          v-else-if="succeeded"
          status="success"
          :title="$t('ukey.biometric.verifySuccess')"
        />
        <template v-else>
          <p
            class="status-text"
            :class="{ 'text-error': failedOnce }"
          >
            {{ statusMessage }}
          </p>
          <p
            v-if="remainingAttempts !== null"
            class="remaining"
          >
            {{
              $t("ukey.biometric.remainingAttempts", {
                count: remainingAttempts,
              })
            }}
          </p>
        </template>
      </div>

      <!-- PIN 备用方案 -->
      <a-divider v-if="showPinFallback" />
      <div
        v-if="showPinFallback"
        class="pin-fallback"
      >
        <p class="fallback-hint">
          {{ $t("ukey.biometric.pinFallback") }}
        </p>
        <a-input-password
          v-model:value="pinInput"
          :placeholder="$t('ukey.biometric.enterPin')"
          :disabled="loading"
          @press-enter="submitPin"
        />
        <a-button
          type="primary"
          class="btn-pin"
          :loading="loading"
          @click="submitPin"
        >
          {{ $t("ukey.biometric.usePinInstead") }}
        </a-button>
      </div>

      <!-- 操作按钮 -->
      <div
        v-if="!succeeded"
        class="prompt-actions"
      >
        <a-button
          v-if="!loading"
          @click="handleCancel"
        >
          {{ $t("common.cancel") }}
        </a-button>
        <a-button
          v-if="failedOnce && !loading"
          type="primary"
          @click="startVerification"
        >
          {{ $t("ukey.biometric.retryFingerprint") }}
        </a-button>
        <a-button
          v-if="!loading && !failedOnce"
          type="primary"
          :loading="loading"
          @click="startVerification"
        >
          {{ $t("ukey.biometric.placeFingerNow") }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: "" },
  biometricManager: { type: Object, default: null },
  requireLiveness: { type: Boolean, default: false },
  showPinFallback: { type: Boolean, default: true },
  usage: { type: String, default: "all" },
});

const emit = defineEmits(["verified", "pin-verified", "cancelled"]);

// State
const loading = ref(false);
const succeeded = ref(false);
const failedOnce = ref(false);
const statusMessage = ref("");
const remainingAttempts = ref(null);
const pinInput = ref("");

// Computed
const promptTitle = computed(
  () => props.title || t("ukey.biometric.verifyIdentity"),
);

// Auto-start when modal opens
watch(
  () => props.visible,
  (val) => {
    if (val) {
      succeeded.value = false;
      failedOnce.value = false;
      statusMessage.value = t("ukey.biometric.placeFingerOnSensor");
      startVerification();
    }
  },
);

async function startVerification() {
  if (!props.biometricManager) {
    statusMessage.value = t("ukey.biometric.notSupported");
    return;
  }

  loading.value = true;
  statusMessage.value = t("ukey.biometric.scanning");

  try {
    const result = await props.biometricManager.verifyFingerprint({
      usage: props.usage,
      requireLiveness: props.requireLiveness,
    });

    if (result.success) {
      succeeded.value = true;
      statusMessage.value = t("ukey.biometric.verifySuccess");
      setTimeout(
        () => emit("verified", { method: "fingerprint", ...result }),
        800,
      );
    } else {
      failedOnce.value = true;
      remainingAttempts.value = result.remainingAttempts ?? null;

      if (
        result.reason === "locked" ||
        result.reason === "locked_after_failures"
      ) {
        statusMessage.value = t("ukey.biometric.locked");
      } else if (result.reason === "liveness_failed") {
        statusMessage.value = t("ukey.biometric.livenessFailed");
      } else {
        statusMessage.value = t("ukey.biometric.verifyFailed");
      }
    }
  } catch (e) {
    failedOnce.value = true;
    statusMessage.value = t("ukey.biometric.error", { msg: e.message });
  } finally {
    loading.value = false;
  }
}

async function submitPin() {
  if (!pinInput.value) {
    return;
  }

  loading.value = true;
  statusMessage.value = t("ukey.biometric.verifyingPin");

  try {
    // 通过 window.electron IPC 调用 PIN 验证
    const result = await window.electron?.ipcRenderer?.invoke(
      "ukey:verify-pin",
      pinInput.value,
    );
    pinInput.value = "";

    if (result?.success) {
      succeeded.value = true;
      setTimeout(() => emit("pin-verified", result), 800);
    } else {
      failedOnce.value = true;
      remainingAttempts.value = result?.remainingAttempts ?? null;
      statusMessage.value = t("ukey.biometric.pinFailed");
    }
  } catch (e) {
    statusMessage.value = t("ukey.biometric.error", { msg: e.message });
  } finally {
    loading.value = false;
  }
}

function handleCancel() {
  if (!loading.value) {
    emit("cancelled");
  }
}
</script>

<style scoped>
.biometric-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
}

.fingerprint-icon-wrapper {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fingerprint-icon {
  font-size: 48px;
  transition: transform 0.3s;
}

.scanning .fingerprint-icon {
  animation: pulse 1.5s ease-in-out infinite;
}

.success .fingerprint-icon {
  filter: hue-rotate(120deg);
}

.failed .fingerprint-icon {
  filter: hue-rotate(0deg) saturate(0);
}

.scan-ring {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 3px solid #1890ff;
  animation: ripple 1.5s linear infinite;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}

@keyframes ripple {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}

.prompt-message {
  text-align: center;
  min-height: 60px;
}

.status-text {
  font-size: 14px;
  color: #595959;
  margin: 0;
}

.text-error {
  color: #ff4d4f;
}

.remaining {
  font-size: 12px;
  color: #faad14;
  margin-top: 4px;
}

.prompt-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.pin-fallback {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fallback-hint {
  font-size: 12px;
  color: #8c8c8c;
  margin: 0;
  text-align: center;
}

.btn-pin {
  align-self: flex-end;
}
</style>
