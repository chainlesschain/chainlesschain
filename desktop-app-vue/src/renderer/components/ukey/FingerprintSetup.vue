<template>
  <div class="fingerprint-setup">
    <a-card :bordered="false">
      <template #title>
        <span>
          <fingerprint-icon class="icon-fingerprint" />
          {{ $t("ukey.biometric.fingerprintSetup") }}
        </span>
      </template>

      <!-- 设备不支持 -->
      <a-result
        v-if="!biometricSupported"
        status="warning"
        :title="$t('ukey.biometric.notSupported')"
        :sub-title="$t('ukey.biometric.notSupportedDesc')"
      >
        <template #icon>
          <a-icon
            type="exclamation-circle"
            style="color: #faad14"
          />
        </template>
      </a-result>

      <template v-else>
        <!-- 已注册指纹列表 -->
        <a-card
          class="enrolled-list"
          :title="
            $t('ukey.biometric.enrolledFingerprints', {
              count: enrolledFingerprints.length,
              max: 10,
            })
          "
        >
          <a-list
            :data-source="enrolledFingerprints"
            :locale="{ emptyText: $t('ukey.biometric.noFingerprints') }"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.label"
                  :description="`${$t('ukey.biometric.enrolled')}: ${formatDate(item.enrolledAt)} · ${$t('ukey.biometric.usage')}: ${getUsageLabel(item.usage)}`"
                >
                  <template #avatar>
                    <a-avatar :style="{ backgroundColor: '#1890ff' }">
                      <template #icon>
                        🖐
                      </template>
                    </a-avatar>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-tag :color="getQualityColor(item.quality)">
                    {{ $t("ukey.biometric.quality") }}:
                    {{ formatQuality(item.quality) }}
                  </a-tag>
                  <a-popconfirm
                    :title="$t('ukey.biometric.deleteConfirm')"
                    @confirm="deleteFingerprint(item.id)"
                  >
                    <a-button
                      type="link"
                      danger
                      size="small"
                    >
                      {{ $t("common.delete") }}
                    </a-button>
                  </a-popconfirm>
                </template>
              </a-list-item>
            </template>
          </a-list>

          <a-button
            v-if="enrolledFingerprints.length < 10"
            type="primary"
            class="btn-enroll"
            @click="showEnrollModal = true"
          >
            + {{ $t("ukey.biometric.addFingerprint") }}
          </a-button>
        </a-card>

        <!-- 注册向导弹窗 -->
        <a-modal
          v-model:open="showEnrollModal"
          :title="$t('ukey.biometric.enrollWizard')"
          :footer="null"
          :closable="!isEnrolling"
          @cancel="cancelEnrollment"
        >
          <enrollment-wizard
            :biometric-manager="biometricManager"
            @completed="onEnrollCompleted"
            @cancelled="showEnrollModal = false"
          />
        </a-modal>
      </template>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useI18n } from "vue-i18n";
import EnrollmentWizard from "./EnrollmentWizard.vue";

const { t } = useI18n();

const props = defineProps({
  biometricManager: { type: Object, default: null },
});

const emit = defineEmits(["fingerprint-enrolled", "fingerprint-deleted"]);

// State
const biometricSupported = ref(false);
const enrolledFingerprints = ref([]);
const showEnrollModal = ref(false);
const isEnrolling = ref(false);

// Init
onMounted(async () => {
  await checkBiometricSupport();
  await loadEnrolledFingerprints();
});

async function checkBiometricSupport() {
  biometricSupported.value = props.biometricManager?.isSupported?.() || false;
}

async function loadEnrolledFingerprints() {
  if (!props.biometricManager) {
    return;
  }
  enrolledFingerprints.value = props.biometricManager.listFingerprints() || [];
}

async function deleteFingerprint(id) {
  if (!props.biometricManager) {
    return;
  }
  const result = await props.biometricManager.deleteFingerprint(id);
  if (result.success) {
    message.success(t("ukey.biometric.deleteSuccess"));
    await loadEnrolledFingerprints();
    emit("fingerprint-deleted", { id });
  } else {
    message.error(t("ukey.biometric.deleteFailed"));
  }
}

function onEnrollCompleted(data) {
  showEnrollModal.value = false;
  message.success(t("ukey.biometric.enrollSuccess"));
  loadEnrolledFingerprints();
  emit("fingerprint-enrolled", data);
}

function cancelEnrollment() {
  if (!isEnrolling.value) {
    showEnrollModal.value = false;
  }
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString();
}

function formatQuality(quality) {
  return `${Math.round((quality || 0) * 100)}%`;
}

function getQualityColor(quality) {
  if (quality >= 0.9) {
    return "green";
  }
  if (quality >= 0.8) {
    return "blue";
  }
  return "orange";
}

function getUsageLabel(usage) {
  const map = {
    login: t("ukey.biometric.usageLogin"),
    transaction_sign: t("ukey.biometric.usageSign"),
    all: t("ukey.biometric.usageAll"),
  };
  return map[usage] || usage;
}
</script>

<style scoped>
.fingerprint-setup {
  max-width: 700px;
}
.icon-fingerprint {
  margin-right: 8px;
}
.enrolled-list {
  margin-bottom: 16px;
}
.btn-enroll {
  margin-top: 12px;
}
</style>
