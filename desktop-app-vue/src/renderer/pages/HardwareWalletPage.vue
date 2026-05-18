<template>
  <div class="hardware-wallet-page">
    <a-page-header
      :title="$t('ukey.hwWallet.title')"
      :sub-title="$t('ukey.hwWallet.subtitle')"
    />

    <a-tabs v-model:active-key="activeTab">
      <!-- 设备管理 -->
      <a-tab-pane
        key="devices"
        :tab="$t('ukey.hwWallet.devices')"
      >
        <a-card>
          <device-picker
            :connected-wallet="connectedWallet"
            @wallet-selected="onWalletSelected"
            @wallet-disconnected="onWalletDisconnected"
          />
        </a-card>
      </a-tab-pane>

      <!-- 账户 -->
      <a-tab-pane
        key="accounts"
        :tab="$t('ukey.hwWallet.accounts')"
        :disabled="!connectedWallet"
      >
        <a-card :title="$t('ukey.hwWallet.derivedAccounts')">
          <a-button
            type="primary"
            class="mb-3"
            :loading="isDiscovering"
            @click="discoverAccounts"
          >
            {{
              isDiscovering
                ? $t("ukey.hwWallet.discovering")
                : $t("ukey.hwWallet.discoverAccounts")
            }}
          </a-button>

          <a-table
            :data-source="accounts"
            :columns="accountColumns"
            :pagination="false"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'address'">
                <a-typography-text
                  code
                  copyable
                >
                  {{ record.address }}
                </a-typography-text>
              </template>
              <template v-if="column.key === 'balance'">
                {{ record.balance || "--" }} ETH
              </template>
              <template v-if="column.key === 'actions'">
                <a-button
                  size="small"
                  type="link"
                  @click="verifyAddress(record)"
                >
                  {{ $t("ukey.hwWallet.verifyOnDevice") }}
                </a-button>
              </template>
            </template>
          </a-table>
        </a-card>
      </a-tab-pane>

      <!-- 双设备签名 -->
      <a-tab-pane
        key="multisign"
        :tab="$t('ukey.hwWallet.multiSign')"
      >
        <a-card :title="$t('ukey.hwWallet.dualSign')">
          <a-descriptions
            :title="$t('ukey.hwWallet.dualSignExplain')"
            bordered
            size="small"
          >
            <a-descriptions-item
              :label="$t('ukey.hwWallet.lowRisk')"
              :span="3"
            >
              {{ $t("ukey.hwWallet.lowRiskMethod") }}
            </a-descriptions-item>
            <a-descriptions-item
              :label="$t('ukey.hwWallet.highRisk')"
              :span="3"
            >
              {{ $t("ukey.hwWallet.highRiskMethod") }}
            </a-descriptions-item>
          </a-descriptions>

          <a-form
            layout="vertical"
            class="mt-4"
          >
            <a-form-item :label="$t('ukey.hwWallet.ukeyStatus')">
              <a-badge
                status="success"
                :text="$t('ukey.hwWallet.connected')"
              />
            </a-form-item>
            <a-form-item :label="$t('ukey.hwWallet.hwWalletStatus')">
              <a-badge
                :status="connectedWallet ? 'success' : 'default'"
                :text="
                  connectedWallet
                    ? connectedWallet.name
                    : $t('ukey.hwWallet.notConnected')
                "
              />
            </a-form-item>
          </a-form>
        </a-card>
      </a-tab-pane>

      <!-- 固件检查 -->
      <a-tab-pane
        key="firmware"
        :tab="$t('ukey.hwWallet.firmware')"
        :disabled="!connectedWallet"
      >
        <a-card>
          <a-descriptions
            v-if="deviceInfo"
            bordered
            size="small"
          >
            <a-descriptions-item :label="$t('ukey.hwWallet.model')">
              {{ deviceInfo.model }}
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ukey.hwWallet.firmwareVersion')">
              {{ deviceInfo.firmware }}
              <a-tag
                v-if="firmwareUpdateAvailable"
                color="orange"
                class="ml-2"
              >
                {{ $t("ukey.hwWallet.updateAvailable") }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ukey.hwWallet.bootloaderVersion')">
              {{ deviceInfo.bootloader || "--" }}
            </a-descriptions-item>
          </a-descriptions>
          <a-button
            v-if="firmwareUpdateAvailable"
            type="primary"
            class="mt-3"
            @click="updateFirmware"
          >
            {{ $t("ukey.hwWallet.updateFirmware") }}
          </a-button>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useI18n } from "vue-i18n";
import DevicePicker from "../components/ukey/DevicePicker.vue";

const { t } = useI18n();

const activeTab = ref("devices");
const connectedWallet = ref(null);
const deviceInfo = ref(null);
const accounts = ref([]);
const isDiscovering = ref(false);
const firmwareUpdateAvailable = ref(false);

const accountColumns = computed(() => [
  {
    title: t("ukey.hwWallet.index"),
    dataIndex: "index",
    key: "index",
    width: 60,
  },
  { title: t("ukey.hwWallet.derivationPath"), dataIndex: "path", key: "path" },
  { title: t("ukey.hwWallet.address"), key: "address" },
  { title: t("ukey.hwWallet.balance"), key: "balance" },
  { title: t("common.actions"), key: "actions" },
]);

function onWalletSelected(wallet) {
  connectedWallet.value = wallet;
  deviceInfo.value = wallet.deviceInfo;
  firmwareUpdateAvailable.value = Math.random() > 0.7;
  message.success(t("ukey.hwWallet.connected") + ": " + wallet.name);
}

function onWalletDisconnected() {
  connectedWallet.value = null;
  deviceInfo.value = null;
  accounts.value = [];
}

async function discoverAccounts() {
  isDiscovering.value = true;
  await sleep(2000);

  accounts.value = Array.from({ length: 5 }, (_, i) => ({
    index: i,
    path: `m/44'/60'/0'/0/${i}`,
    address:
      "0x" +
      Array.from({ length: 40 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join(""),
    balance: (Math.random() * 2).toFixed(4),
  }));

  isDiscovering.value = false;
}

async function verifyAddress(account) {
  message.info(
    t("ukey.hwWallet.verifyingOnDevice", {
      address: account.address.slice(0, 10) + "...",
    }),
  );
  await sleep(3000);
  message.success(t("ukey.hwWallet.addressVerified"));
}

async function updateFirmware() {
  message.warning(t("ukey.hwWallet.firmwareUpdateWarning"));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
</script>

<style scoped>
.hardware-wallet-page {
  padding: 16px;
}
.mt-3 {
  margin-top: 12px;
}
.mt-4 {
  margin-top: 16px;
}
.mb-3 {
  margin-bottom: 12px;
}
.ml-2 {
  margin-left: 8px;
}
</style>
