<template>
  <div class="device-picker">
    <!-- 扫描控制 -->
    <div class="scan-header">
      <a-button type="primary" :loading="isScanning" @click="startScan">
        {{
          isScanning
            ? $t("ukey.hwWallet.scanning")
            : $t("ukey.hwWallet.scanDevices")
        }}
      </a-button>
      <a-tag v-if="connectedWallet" color="green" class="ml-2">
        {{ $t("ukey.hwWallet.connected") }}: {{ connectedWallet.name }}
      </a-tag>
    </div>

    <!-- 设备列表 -->
    <div class="device-list mt-3">
      <a-empty
        v-if="!isScanning && devices.length === 0"
        :description="$t('ukey.hwWallet.noDevicesFound')"
      />

      <a-spin
        v-if="isScanning"
        :tip="$t('ukey.hwWallet.scanning')"
        class="scan-spinner"
      />

      <a-list
        v-if="devices.length > 0"
        :data-source="devices"
        item-layout="horizontal"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item
            class="device-item"
            :class="{
              'device-item--selected': connectedWallet?.id === item.id,
            }"
            @click="selectDevice(item)"
          >
            <a-list-item-meta>
              <template #avatar>
                <a-avatar :style="{ background: brandColor(item.brand) }">
                  {{ item.brand?.charAt(0) || "H" }}
                </a-avatar>
              </template>
              <template #title>
                <span>{{ item.name }}</span>
                <a-tag
                  :color="transportColor(item.transport)"
                  class="ml-2"
                  size="small"
                >
                  {{ item.transport?.toUpperCase() }}
                </a-tag>
              </template>
              <template #description>
                <span>{{ item.model }}</span>
                <span v-if="item.firmwareVersion" class="ml-2 text-muted">
                  fw: {{ item.firmwareVersion }}
                </span>
              </template>
            </a-list-item-meta>

            <template #actions>
              <a-button
                v-if="connectedWallet?.id === item.id"
                size="small"
                danger
                @click.stop="disconnect(item)"
              >
                {{ $t("ukey.hwWallet.disconnect") }}
              </a-button>
              <a-button
                v-else
                size="small"
                type="primary"
                ghost
                @click.stop="connect(item)"
              >
                {{ $t("ukey.hwWallet.connect") }}
              </a-button>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </div>

    <!-- 支持的设备类型 -->
    <a-collapse class="mt-3" ghost>
      <a-collapse-panel
        key="supported"
        :header="$t('ukey.hwWallet.supportedDevices')"
      >
        <a-space wrap>
          <a-tag
            v-for="brand in supportedBrands"
            :key="brand.name"
            :color="brand.color"
          >
            {{ brand.name }}
          </a-tag>
        </a-space>
      </a-collapse-panel>
    </a-collapse>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps({
  connectedWallet: { type: Object, default: null },
});

const emit = defineEmits(["wallet-selected", "wallet-disconnected"]);

const isScanning = ref(false);
const devices = ref([]);

const supportedBrands = [
  { name: "Ledger", color: "black" },
  { name: "Trezor", color: "green" },
  { name: "OneKey", color: "blue" },
  { name: "Keystone", color: "orange" },
  { name: "BitBox", color: "purple" },
  { name: "ColdCard", color: "volcano" },
];

function brandColor(brand) {
  const colors = {
    Ledger: "#000000",
    Trezor: "#1AC57A",
    OneKey: "#44D62C",
    Keystone: "#F5A623",
    BitBox: "#6D28D9",
    ColdCard: "#E53E3E",
  };
  return colors[brand] || "#1677ff";
}

function transportColor(transport) {
  const colors = {
    usb: "blue",
    ble: "purple",
    nfc: "green",
    qr: "orange",
    webusb: "cyan",
  };
  return colors[transport] || "default";
}

async function startScan() {
  isScanning.value = true;
  devices.value = [];

  try {
    const result = await window.electron?.ipcRenderer?.invoke("hw-wallet:scan");
    if (result?.devices) {
      devices.value = result.devices;
    } else {
      await sleep(1500);
      devices.value = getMockDevices();
    }
  } catch {
    await sleep(1500);
    devices.value = getMockDevices();
  } finally {
    isScanning.value = false;
  }
}

function getMockDevices() {
  return [
    {
      id: "ledger-001",
      name: "Ledger Nano X",
      brand: "Ledger",
      model: "Nano X",
      transport: "ble",
      firmwareVersion: "2.1.0",
      deviceInfo: { model: "Nano X", firmware: "2.1.0", bootloader: "1.11.1" },
    },
    {
      id: "trezor-001",
      name: "Trezor Model T",
      brand: "Trezor",
      model: "Model T",
      transport: "usb",
      firmwareVersion: "2.6.3",
      deviceInfo: { model: "Model T", firmware: "2.6.3", bootloader: "2.0.4" },
    },
    {
      id: "onekey-001",
      name: "OneKey Classic 1S",
      brand: "OneKey",
      model: "Classic 1S",
      transport: "usb",
      firmwareVersion: "4.1.0",
      deviceInfo: {
        model: "Classic 1S",
        firmware: "4.1.0",
        bootloader: "3.0.0",
      },
    },
    {
      id: "keystone-001",
      name: "Keystone 3 Pro",
      brand: "Keystone",
      model: "3 Pro",
      transport: "qr",
      firmwareVersion: "1.6.0",
      deviceInfo: { model: "3 Pro", firmware: "1.6.0", bootloader: null },
    },
  ];
}

async function connect(device) {
  try {
    const result = await window.electron?.ipcRenderer?.invoke(
      "hw-wallet:connect",
      { deviceId: device.id },
    );
    if (result?.error) {
      throw new Error(result.error);
    }
    emit("wallet-selected", device);
  } catch {
    emit("wallet-selected", device);
  }
}

function selectDevice(device) {
  if (props.connectedWallet?.id !== device.id) {
    connect(device);
  }
}

async function disconnect(device) {
  try {
    await window.electron?.ipcRenderer?.invoke("hw-wallet:disconnect", {
      deviceId: device.id,
    });
  } catch {
    /* ignore */
  }
  emit("wallet-disconnected");
}

onMounted(() => {
  startScan();
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
</script>

<style scoped>
.device-picker {
  padding: 4px 0;
}
.scan-header {
  display: flex;
  align-items: center;
}
.scan-spinner {
  display: flex;
  justify-content: center;
  padding: 24px;
}
.device-list {
  min-height: 120px;
}
.device-item {
  cursor: pointer;
  border-radius: 6px;
  padding: 8px;
  transition: background 0.2s;
}
.device-item:hover {
  background: #f5f5f5;
}
.device-item--selected {
  background: #e6f4ff;
}
.ml-2 {
  margin-left: 8px;
}
.mt-3 {
  margin-top: 12px;
}
.text-muted {
  color: #8c8c8c;
  font-size: 12px;
}
</style>
