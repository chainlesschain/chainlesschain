<template>
  <div class="recovery-wizard">
    <a-steps :current="currentStep" size="small" class="wizard-steps">
      <a-step :title="$t('ukey.recovery.step1')" />
      <a-step :title="$t('ukey.recovery.step2')" />
      <a-step :title="$t('ukey.recovery.step3')" />
      <a-step :title="$t('ukey.recovery.step4')" />
      <a-step :title="$t('ukey.recovery.step5')" />
    </a-steps>

    <div class="step-content">
      <!-- Step 0: 验证身份 -->
      <template v-if="currentStep === 0">
        <a-form layout="vertical">
          <a-form-item :label="$t('ukey.recovery.authMethod')">
            <a-radio-group v-model:value="authMethod">
              <a-radio value="did">
                {{ $t("ukey.recovery.authDID") }}
              </a-radio>
              <a-radio value="email">
                {{ $t("ukey.recovery.authEmail") }}
              </a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item
            v-if="authMethod === 'email'"
            :label="$t('common.email')"
          >
            <a-input v-model:value="email" />
          </a-form-item>
        </a-form>
      </template>

      <!-- Step 1: 收集分片 -->
      <template v-if="currentStep === 1">
        <a-progress
          :percent="Math.round((shardsCollected / shardsRequired) * 100)"
          :format="() => `${shardsCollected}/${shardsRequired}`"
        />
        <p class="step-hint">
          {{ $t("ukey.recovery.collectHint", { required: shardsRequired }) }}
        </p>

        <a-space direction="vertical" class="shard-inputs">
          <div v-for="(shard, i) in shards" :key="i" class="shard-row">
            <a-input
              v-model:value="shards[i]"
              :placeholder="`${$t('ukey.recovery.shard')} ${i + 1}`"
              :status="shard && !validateShard(shard) ? 'error' : ''"
            />
            <a-button
              v-if="i < shards.length - 1 || shard"
              type="link"
              danger
              @click="removeShard(i)"
            >
              ×
            </a-button>
          </div>
          <a-button type="dashed" block @click="addShardInput">
            + {{ $t("ukey.recovery.addShard") }}
          </a-button>
        </a-space>

        <a-button
          class="mt-3"
          :loading="isCollectingFromCloud"
          @click="collectFromCloud"
        >
          {{ $t("ukey.recovery.autoCollectCloud") }}
        </a-button>
      </template>

      <!-- Step 2: 输入密码 -->
      <template v-if="currentStep === 2">
        <a-form layout="vertical">
          <a-form-item :label="$t('ukey.recovery.backupPassphrase')">
            <a-input-password v-model:value="passphrase" />
          </a-form-item>
          <a-form-item :label="$t('ukey.recovery.confirmPassphrase')">
            <a-input-password v-model:value="passphraseConfirm" />
          </a-form-item>
        </a-form>
        <a-alert
          v-if="
            passphrase && passphraseConfirm && passphrase !== passphraseConfirm
          "
          type="error"
          :message="$t('ukey.recovery.passphraseMismatch')"
        />
      </template>

      <!-- Step 3: 写入新 U盾 -->
      <template v-if="currentStep === 3">
        <a-result
          v-if="isRestoring"
          icon="loading"
          :title="$t('ukey.recovery.restoring')"
          :sub-title="restoreStatusMsg"
        />
        <a-form v-else layout="vertical">
          <a-alert
            type="info"
            :message="$t('ukey.recovery.insertNewUKey')"
            class="mb-3"
          />
          <a-form-item :label="$t('ukey.recovery.newUKeyPin')">
            <a-input-password v-model:value="newPin" />
          </a-form-item>
        </a-form>
      </template>

      <!-- Step 4: 完成 -->
      <template v-if="currentStep === 4">
        <a-result
          status="success"
          :title="$t('ukey.recovery.restoreComplete')"
          :sub-title="$t('ukey.recovery.restoreCompleteDesc')"
        />
      </template>
    </div>

    <!-- 导航按钮 -->
    <div class="wizard-footer">
      <a-button @click="emit('cancelled')">
        {{ $t("common.cancel") }}
      </a-button>
      <a-space>
        <a-button v-if="currentStep > 0 && currentStep < 4" @click="prevStep">
          {{ $t("common.previous") }}
        </a-button>
        <a-button
          v-if="currentStep < 4"
          type="primary"
          :loading="isProcessing"
          :disabled="!canProceed"
          @click="nextStep"
        >
          {{
            currentStep === 3
              ? $t("ukey.recovery.startRestore")
              : $t("common.next")
          }}
        </a-button>
        <a-button
          v-if="currentStep === 4"
          type="primary"
          @click="emit('completed')"
        >
          {{ $t("common.done") }}
        </a-button>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { message } from "ant-design-vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const emit = defineEmits(["completed", "cancelled"]);

// State
const currentStep = ref(0);
const authMethod = ref("email");
const email = ref("");
const shards = ref(["", ""]);
const shardsRequired = ref(2);
const shardsCollected = computed(
  () => shards.value.filter((s) => s && validateShard(s)).length,
);
const passphrase = ref("");
const passphraseConfirm = ref("");
const newPin = ref("");
const isCollectingFromCloud = ref(false);
const isRestoring = ref(false);
const isProcessing = ref(false);
const restoreStatusMsg = ref("");

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 0:
      return authMethod.value && (authMethod.value !== "email" || email.value);
    case 1:
      return shardsCollected.value >= shardsRequired.value;
    case 2:
      return passphrase.value && passphrase.value === passphraseConfirm.value;
    case 3:
      return newPin.value.length >= 6;
    default:
      return true;
  }
});

function validateShard(shard) {
  return shard && shard.includes(":") && shard.length > 10;
}

function addShardInput() {
  shards.value.push("");
}

function removeShard(i) {
  shards.value.splice(i, 1);
}

async function collectFromCloud() {
  isCollectingFromCloud.value = true;
  await sleep(2000);
  // 模拟从云端找到分片
  shards.value[0] = "1:" + btoa("simulated-shard-data-1");
  shards.value[1] = "2:" + btoa("simulated-shard-data-2");
  message.success(t("ukey.recovery.cloudShardsFound", { count: 2 }));
  isCollectingFromCloud.value = false;
}

async function nextStep() {
  if (currentStep.value === 3) {
    await performRestore();
    return;
  }
  currentStep.value++;
}

function prevStep() {
  currentStep.value--;
}

async function performRestore() {
  isRestoring.value = true;
  const steps = [
    t("ukey.recovery.combiningShards"),
    t("ukey.recovery.decrypting"),
    t("ukey.recovery.writingToUKey"),
    t("ukey.recovery.verifying"),
  ];

  for (const step of steps) {
    restoreStatusMsg.value = step;
    await sleep(800);
  }

  isRestoring.value = false;
  currentStep.value = 4;
  message.success(t("ukey.recovery.restoreComplete"));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
</script>

<style scoped>
.recovery-wizard {
  min-height: 400px;
  display: flex;
  flex-direction: column;
}
.wizard-steps {
  margin-bottom: 24px;
}
.step-content {
  flex: 1;
}
.step-hint {
  color: #8c8c8c;
  font-size: 13px;
  margin: 8px 0;
}
.shard-inputs {
  width: 100%;
}
.shard-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.mt-3 {
  margin-top: 12px;
}
.mb-3 {
  margin-bottom: 12px;
}
.wizard-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
