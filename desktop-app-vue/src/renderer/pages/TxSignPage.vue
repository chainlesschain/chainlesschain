<template>
  <div class="tx-sign-page">
    <a-page-header :title="$t('ukey.txSign.title')" @back="handleBack" />

    <a-row :gutter="24">
      <!-- 左侧：交易详情 -->
      <a-col :span="14">
        <a-card :title="$t('ukey.txSign.txDetails')">
          <!-- 风险评级 -->
          <div class="risk-header">
            <risk-badge
              :level="riskReport.level"
              :score="riskReport.score"
              show-score
            />
            <span class="risk-summary">{{ riskReport.summary }}</span>
          </div>

          <!-- 合约信息 -->
          <a-descriptions bordered size="small" class="mt-3">
            <a-descriptions-item :label="$t('ukey.txSign.chain')" :span="3">
              <a-tag>{{ txInfo.chain }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ukey.txSign.contract')" :span="3">
              <a-typography-text code copyable>
                {{ txInfo.to }}
              </a-typography-text>
              <a-tag v-if="txInfo.contractName" color="blue" class="ml-2">
                {{ txInfo.contractName }}
              </a-tag>
              <a-tag v-if="isWhitelisted" color="green">
                ✓ {{ $t("ukey.txSign.whitelisted") }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ukey.txSign.method')" :span="3">
              <code
                >{{ txInfo.methodName }}({{
                  formatParams(txInfo.params)
                }})</code
              >
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ukey.txSign.value')" :span="3">
              {{ txInfo.value || "0" }} ETH
            </a-descriptions-item>
            <a-descriptions-item
              :label="$t('ukey.txSign.gasEstimate')"
              :span="3"
            >
              {{ txInfo.gasEstimate }} gas (~${{ txInfo.gasCostUSD }})
            </a-descriptions-item>
          </a-descriptions>

          <!-- 资产变动预览 -->
          <a-card
            class="mt-3"
            size="small"
            :title="$t('ukey.txSign.assetChanges')"
          >
            <a-list :data-source="assetChanges" size="small">
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta :title="item.token" />
                  <a-tag :color="item.delta < 0 ? 'red' : 'green'">
                    {{ item.delta > 0 ? "+" : "" }}{{ item.delta }}
                    {{ item.symbol }}
                  </a-tag>
                </a-list-item>
              </template>
            </a-list>
          </a-card>

          <!-- 安全警告 -->
          <div v-if="riskReport.warnings?.length > 0" class="mt-3">
            <a-alert
              v-for="(warn, i) in riskReport.warnings"
              :key="i"
              :type="warn.severity"
              :message="warn.message"
              :show-icon="true"
              class="mb-2"
            />
          </div>

          <!-- 冷却期提示 -->
          <a-alert
            v-if="cooldownRemaining > 0"
            type="warning"
            :message="
              $t('ukey.txSign.cooldown', { seconds: cooldownRemaining })
            "
            show-icon
            class="mt-3"
          />
        </a-card>
      </a-col>

      <!-- 右侧：签名操作 -->
      <a-col :span="10">
        <a-card :title="$t('ukey.txSign.signAction')">
          <!-- 认证要求 -->
          <div class="auth-requirement">
            <a-tag :color="authLevelColor">
              {{ authLevelLabel }}
            </a-tag>
            <p class="auth-desc">
              {{ authDescription }}
            </p>
          </div>

          <!-- PIN 输入 -->
          <a-form layout="vertical" class="mt-3">
            <a-form-item :label="$t('ukey.txSign.pinCode')">
              <a-input-password
                v-model:value="pin"
                :disabled="isSigningInProgress"
                @press-enter="sign"
              />
            </a-form-item>

            <!-- 指纹（如支持）-->
            <a-form-item
              v-if="requireBiometric"
              :label="$t('ukey.txSign.biometric')"
            >
              <a-button block @click="showBiometricPrompt = true">
                🖐 {{ $t("ukey.txSign.useBiometric") }}
              </a-button>
            </a-form-item>
          </a-form>

          <!-- 加入白名单 -->
          <a-checkbox v-model:checked="addToWhitelist" class="mt-2">
            {{ $t("ukey.txSign.addToWhitelist") }}
          </a-checkbox>

          <!-- 签名按钮 -->
          <div class="sign-actions mt-4">
            <a-button
              block
              danger
              :disabled="isSigningInProgress"
              @click="handleReject"
            >
              {{ $t("ukey.txSign.reject") }}
            </a-button>
            <a-button
              block
              type="primary"
              class="mt-2"
              :loading="isSigningInProgress"
              :disabled="!canSign"
              @click="sign"
            >
              {{
                isSigningInProgress
                  ? $t("ukey.txSign.signing")
                  : $t("ukey.txSign.confirmAndSign")
              }}
            </a-button>
          </div>

          <!-- 签名结果 -->
          <a-result
            v-if="signResult"
            :status="signResult.success ? 'success' : 'error'"
            :title="
              signResult.success
                ? $t('ukey.txSign.signSuccess')
                : $t('ukey.txSign.signFailed')
            "
            :sub-title="signResult.txHash || signResult.error"
          >
            <template v-if="signResult.txHash" #extra>
              <a-button
                type="link"
                :href="`https://etherscan.io/tx/${signResult.txHash}`"
                target="_blank"
              >
                {{ $t("ukey.txSign.viewOnExplorer") }}
              </a-button>
            </template>
          </a-result>
        </a-card>
      </a-col>
    </a-row>

    <!-- 生物识别弹窗 -->
    <biometric-prompt
      :visible="showBiometricPrompt"
      :title="$t('ukey.txSign.biometricForSign')"
      usage="transaction_sign"
      @verified="onBiometricVerified"
      @cancelled="showBiometricPrompt = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { useI18n } from "vue-i18n";
import RiskBadge from "../components/ukey/RiskBadge.vue";
import BiometricPrompt from "../components/ukey/BiometricPrompt.vue";

const { t } = useI18n();
const router = useRouter();

// Mock tx info (in real app comes from route query or IPC)
const txInfo = ref({
  chain: "Ethereum",
  to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  contractName: "Uniswap V3 Router",
  methodName: "swapExactTokensForTokens",
  params: [
    "1000000000",
    "950000000",
    ["0x...", "0x..."],
    "0x...",
    "1700000000",
  ],
  value: "0",
  gasEstimate: "142000",
  gasCostUSD: "3.2",
});

const riskReport = ref({
  level: "medium",
  score: 45,
  summary: t("ukey.txSign.knownContract"),
  warnings: [{ severity: "warning", message: t("ukey.txSign.warnSlippage") }],
});

const assetChanges = ref([
  { token: "USDC", symbol: "USDC", delta: -1000 },
  { token: "ETH", symbol: "ETH", delta: 0.42 },
]);

const isWhitelisted = ref(true);
const requireBiometric = ref(false);
const addToWhitelist = ref(false);
const pin = ref("");
const isSigningInProgress = ref(false);
const showBiometricPrompt = ref(false);
const signResult = ref(null);
const biometricVerified = ref(false);
const cooldownRemaining = ref(0);

const canSign = computed(
  () =>
    pin.value.length >= 6 &&
    cooldownRemaining.value === 0 &&
    (!requireBiometric.value || biometricVerified.value),
);

const authLevelColor = computed(
  () =>
    ({
      low: "green",
      medium: "blue",
      high: "orange",
      critical: "red",
    })[riskReport.value.level] || "default",
);

const authLevelLabel = computed(() =>
  t(`ukey.txSign.authLevel.${riskReport.value.level}`),
);
const authDescription = computed(() =>
  t(`ukey.txSign.authDesc.${riskReport.value.level}`),
);

let cooldownTimer = null;

onMounted(() => {
  // 首次交互合约冷却期（模拟）
  if (!isWhitelisted.value) {
    cooldownRemaining.value = 30;
    cooldownTimer = setInterval(() => {
      cooldownRemaining.value = Math.max(0, cooldownRemaining.value - 1);
      if (cooldownRemaining.value === 0) {
        clearInterval(cooldownTimer);
      }
    }, 1000);
  }
});

onUnmounted(() => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }
});

async function sign() {
  if (!canSign.value) {
    return;
  }
  isSigningInProgress.value = true;

  try {
    await sleep(2000); // 模拟 U盾 签名
    const txHash =
      "0x" +
      Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join("");

    signResult.value = { success: true, txHash };
    message.success(t("ukey.txSign.signSuccess"));
  } catch (e) {
    signResult.value = { success: false, error: e.message };
    message.error(t("ukey.txSign.signFailed"));
  } finally {
    isSigningInProgress.value = false;
  }
}

function handleReject() {
  message.info(t("ukey.txSign.rejected"));
  router.back();
}

function handleBack() {
  router.back();
}

function onBiometricVerified() {
  biometricVerified.value = true;
  showBiometricPrompt.value = false;
  message.success(t("ukey.txSign.biometricVerified"));
}

function formatParams(params) {
  if (!params?.length) {
    return "";
  }
  return (
    params
      .slice(0, 2)
      .map((p) =>
        typeof p === "string" && p.length > 10 ? p.slice(0, 8) + "..." : p,
      )
      .join(", ") + (params.length > 2 ? `, +${params.length - 2}` : "")
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
</script>

<style scoped>
.tx-sign-page {
  padding: 16px;
}
.risk-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.risk-summary {
  color: #595959;
  font-size: 13px;
}
.mt-2 {
  margin-top: 8px;
}
.mt-3 {
  margin-top: 12px;
}
.mt-4 {
  margin-top: 16px;
}
.ml-2 {
  margin-left: 8px;
}
.mb-2 {
  margin-bottom: 8px;
}
.auth-requirement {
  padding: 8px 0;
}
.auth-desc {
  color: #8c8c8c;
  font-size: 12px;
  margin-top: 4px;
}
.sign-actions {
  display: flex;
  flex-direction: column;
}
</style>
