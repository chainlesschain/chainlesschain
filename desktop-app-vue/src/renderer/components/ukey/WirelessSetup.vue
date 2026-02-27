<template>
  <div class="wireless-setup">
    <a-tabs v-model:active-key="activeTab">
      <!-- BLE 蓝牙配对 -->
      <a-tab-pane
        key="ble"
        :tab="$t('ukey.wireless.ble')"
      >
        <a-card :bordered="false">
          <a-steps
            :current="bleStep"
            direction="vertical"
            size="small"
          >
            <a-step
              :title="$t('ukey.wireless.enableBLE')"
              :description="$t('ukey.wireless.enableBLEDesc')"
            />
            <a-step
              :title="$t('ukey.wireless.scanDevices')"
              :description="$t('ukey.wireless.scanDesc')"
            />
            <a-step
              :title="$t('ukey.wireless.selectDevice')"
              :description="$t('ukey.wireless.selectDesc')"
            />
            <a-step
              :title="$t('ukey.wireless.confirmPairing')"
              :description="$t('ukey.wireless.confirmDesc')"
            />
          </a-steps>

          <a-divider />

          <!-- 扫描结果 -->
          <div v-if="bleDevices.length > 0">
            <h4>
              {{
                $t("ukey.wireless.foundDevices", { count: bleDevices.length })
              }}
            </h4>
            <a-list
              :data-source="bleDevices"
              size="small"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta
                    :title="item.name"
                    :description="`${$t('ukey.wireless.signal')}: ${item.rssi}dBm · ${item.distance}`"
                  >
                    <template #avatar>
                      <a-avatar style="background-color: #1890ff">
                        📶
                      </a-avatar>
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-button
                      type="primary"
                      size="small"
                      :loading="pairingDeviceId === item.id"
                      @click="pairBLEDevice(item.id)"
                    >
                      {{ $t("ukey.wireless.pair") }}
                    </a-button>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </div>

          <!-- 操作按钮 -->
          <div class="action-row">
            <a-button
              type="primary"
              :loading="isScanning"
              @click="startBLEScan"
            >
              {{
                isScanning
                  ? $t("ukey.wireless.scanning")
                  : $t("ukey.wireless.startScan")
              }}
            </a-button>
          </div>

          <!-- 已配对设备 -->
          <a-divider />
          <h4>{{ $t("ukey.wireless.pairedDevices") }}</h4>
          <a-list
            :data-source="pairedBLEDevices"
            :locale="{ emptyText: $t('ukey.wireless.noPairedDevices') }"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.name"
                  :description="`${$t('ukey.wireless.pairedAt')}: ${formatDate(item.pairedAt)}`"
                >
                  <template #avatar>
                    <a-avatar :style="{ backgroundColor: '#52c41a' }">
                      🔗
                    </a-avatar>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-button
                    type="link"
                    danger
                    size="small"
                    @click="removeDevice(item.id)"
                  >
                    {{ $t("common.remove") }}
                  </a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-tab-pane>

      <!-- NFC 注册 -->
      <a-tab-pane
        key="nfc"
        :tab="$t('ukey.wireless.nfc')"
      >
        <a-card :bordered="false">
          <div class="nfc-prompt">
            <div
              class="nfc-icon"
              :class="{ active: isNFCWaiting }"
            >
              📡
            </div>
            <p class="nfc-hint">
              {{
                isNFCWaiting
                  ? $t("ukey.wireless.nfcTapNow")
                  : $t("ukey.wireless.nfcInstructions")
              }}
            </p>
          </div>

          <a-button
            type="primary"
            block
            :loading="isNFCWaiting"
            @click="startNFCRegistration"
          >
            {{
              isNFCWaiting
                ? $t("ukey.wireless.waitingForNFC")
                : $t("ukey.wireless.registerNFC")
            }}
          </a-button>

          <a-divider />
          <h4>{{ $t("ukey.wireless.registeredNFCDevices") }}</h4>
          <a-list
            :data-source="registeredNFCDevices"
            :locale="{ emptyText: $t('ukey.wireless.noNFCDevices') }"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="`NFC ${item.uid}`"
                  :description="`${$t('ukey.wireless.standard')}: ${item.standard}`"
                >
                  <template #avatar>
                    <a-avatar>📟</a-avatar>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-button
                    type="link"
                    danger
                    size="small"
                    @click="removeDevice(item.id)"
                  >
                    {{ $t("common.remove") }}
                  </a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-tab-pane>

      <!-- 连接状态 -->
      <a-tab-pane
        key="status"
        :tab="$t('ukey.wireless.connectionStatus')"
      >
        <a-card :bordered="false">
          <a-descriptions
            :title="$t('ukey.wireless.currentStatus')"
            bordered
            size="small"
          >
            <a-descriptions-item :label="$t('ukey.wireless.activeTransport')">
              <a-tag :color="connectionStatus.isConnected ? 'green' : 'red'">
                {{
                  connectionStatus.active || $t("ukey.wireless.notConnected")
                }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ukey.wireless.bleStatus')">
              <a-badge
                :status="
                  connectionStatus.ble === 'connected' ? 'success' : 'default'
                "
                :text="connectionStatus.ble"
              />
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ukey.wireless.nfcStatus')">
              <a-badge
                :status="
                  connectionStatus.nfc === 'tag_detected'
                    ? 'success'
                    : 'default'
                "
                :text="connectionStatus.nfc"
              />
            </a-descriptions-item>
          </a-descriptions>

          <a-button
            class="mt-4"
            @click="refreshStatus"
          >
            {{ $t("ukey.wireless.refreshStatus") }}
          </a-button>
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  wirelessManager: { type: Object, default: null },
});

const emit = defineEmits(["device-paired", "device-removed"]);

// State
const activeTab = ref("ble");
const bleStep = ref(0);
const bleDevices = ref([]);
const isScanning = ref(false);
const pairingDeviceId = ref(null);
const isNFCWaiting = ref(false);
const connectionStatus = ref({
  isConnected: false,
  active: null,
  ble: "disconnected",
  nfc: "idle",
});

const pairedDevices = ref([]);
const pairedBLEDevices = computed(() =>
  pairedDevices.value.filter((d) => d.transport === "ble"),
);
const registeredNFCDevices = computed(() =>
  pairedDevices.value.filter((d) => d.transport === "nfc"),
);

onMounted(async () => {
  await loadPairedDevices();
  await refreshStatus();
});

async function loadPairedDevices() {
  if (!props.wirelessManager) {
    return;
  }
  pairedDevices.value = props.wirelessManager.listPairedDevices() || [];
}

async function startBLEScan() {
  if (!props.wirelessManager) {
    return;
  }
  isScanning.value = true;
  bleStep.value = 1;
  bleDevices.value = [];

  const result = await props.wirelessManager.pairBLEDevice();
  isScanning.value = false;

  if (result.success && result.devices) {
    bleDevices.value = result.devices;
    bleStep.value = 2;
  } else {
    message.warning(t("ukey.wireless.noDevicesFound"));
    bleStep.value = 0;
  }
}

async function pairBLEDevice(deviceId) {
  if (!props.wirelessManager) {
    return;
  }
  pairingDeviceId.value = deviceId;
  bleStep.value = 3;

  const result = await props.wirelessManager.confirmBLEPairing(deviceId);
  pairingDeviceId.value = null;

  if (result.success) {
    bleStep.value = 4;
    message.success(t("ukey.wireless.pairingSuccess"));
    await loadPairedDevices();
    emit("device-paired", { type: "ble", deviceId });
  } else {
    bleStep.value = 2;
    message.error(t("ukey.wireless.pairingFailed"));
  }
}

async function startNFCRegistration() {
  if (!props.wirelessManager) {
    return;
  }
  isNFCWaiting.value = true;

  const result = await props.wirelessManager.registerNFCDevice();
  isNFCWaiting.value = false;

  if (result.success) {
    message.success(t("ukey.wireless.nfcRegistered"));
    await loadPairedDevices();
    emit("device-paired", { type: "nfc", deviceId: result.deviceId });
  } else {
    message.error(t("ukey.wireless.nfcFailed", { reason: result.reason }));
  }
}

async function removeDevice(deviceId) {
  if (!props.wirelessManager) {
    return;
  }
  const result = props.wirelessManager.removePairedDevice(deviceId);
  if (result.success) {
    message.success(t("ukey.wireless.deviceRemoved"));
    await loadPairedDevices();
    emit("device-removed", { deviceId });
  }
}

async function refreshStatus() {
  if (!props.wirelessManager) {
    return;
  }
  connectionStatus.value =
    props.wirelessManager.getConnectionStatus?.() || connectionStatus.value;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString();
}
</script>

<style scoped>
.wireless-setup {
  max-width: 700px;
}
.action-row {
  margin-top: 16px;
}
.nfc-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
}
.nfc-icon {
  font-size: 64px;
  transition: transform 0.3s;
}
.nfc-icon.active {
  animation: nfc-pulse 1.5s ease-in-out infinite;
}
@keyframes nfc-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.7;
  }
}
.nfc-hint {
  color: #595959;
  margin-top: 12px;
}
.mt-4 {
  margin-top: 16px;
}
</style>
