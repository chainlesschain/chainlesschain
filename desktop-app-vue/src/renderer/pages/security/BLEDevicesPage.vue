<template>
  <div class="ble-devices-page">
    <a-page-header title="BLE U-Key Devices" sub-title="Bluetooth Low Energy device management">
      <template #extra>
        <a-space>
          <a-button @click="handleScan" :loading="store.scanning">
            {{ store.scanning ? 'Scanning...' : 'Scan Devices' }}
          </a-button>
          <a-button v-if="store.isConnected" danger @click="handleDisconnect">Disconnect</a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-tabs v-model:activeKey="activeTab">
      <!-- Discovered Devices -->
      <a-tab-pane key="discovered" tab="Discovered Devices">
        <a-spin :spinning="store.scanning">
          <a-empty v-if="store.devices.length === 0" description="No BLE devices found. Click Scan to search." />
          <a-list v-else :data-source="store.devices" item-layout="horizontal">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta :title="item.name || 'Unknown Device'" :description="`RSSI: ${item.rssi} dBm | ~${item.distance?.toFixed(1)}m`">
                  <template #avatar>
                    <a-badge :status="item.connected ? 'success' : item.paired ? 'processing' : 'default'" />
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-button v-if="!item.paired" size="small" type="primary" @click="handlePair(item.id)" :loading="store.loading">
                    Pair
                  </a-button>
                  <a-button v-else-if="!item.connected" size="small" @click="handleConnect(item.id)" :loading="store.loading">
                    Connect
                  </a-button>
                  <a-tag v-else color="green">Connected</a-tag>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-spin>
      </a-tab-pane>

      <!-- Paired Devices -->
      <a-tab-pane key="paired" tab="Paired Devices">
        <a-empty v-if="store.pairedDevices.length === 0" description="No paired devices" />
        <a-list v-else :data-source="store.pairedDevices" item-layout="horizontal">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta :title="item.name || item.id" :description="`Last seen: ${formatDate(item.lastSeen)}`" />
              <template #actions>
                <a-button size="small" @click="handleConnect(item.id)" :disabled="item.connected" :loading="store.loading">
                  {{ item.connected ? 'Connected' : 'Connect' }}
                </a-button>
              </template>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>
    </a-tabs>

    <!-- Connection Status -->
    <a-card v-if="store.connectedDevice" title="Active Connection" style="margin-top: 16px" size="small">
      <a-descriptions :column="2" size="small">
        <a-descriptions-item label="Device">{{ store.connectedDevice.name || store.connectedDevice.id }}</a-descriptions-item>
        <a-descriptions-item label="Signal">{{ store.connectedDevice.rssi }} dBm</a-descriptions-item>
      </a-descriptions>
    </a-card>

    <a-alert v-if="store.error" type="error" :message="store.error" closable @close="store.error = null" style="margin-top: 16px" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useBleUkeyStore } from '../../stores/bleUkey';

const store = useBleUkeyStore();
const activeTab = ref('discovered');

function formatDate(ts: number) {
  if (!ts) return 'N/A';
  return new Date(ts).toLocaleString();
}

async function handleScan() {
  await store.scanDevices(10000);
}

async function handlePair(deviceId: string) {
  const result = await store.pairDevice(deviceId);
  if (result.success) message.success('Device paired successfully');
  else message.error(result.error || 'Pairing failed');
}

async function handleConnect(deviceId: string) {
  const result = await store.connect(deviceId);
  if (result.success) message.success('Connected');
  else message.error(result.error || 'Connection failed');
}

async function handleDisconnect() {
  const result = await store.disconnect();
  if (result.success) message.success('Disconnected');
}

onMounted(() => {
  // Auto-scan on page load
});
</script>

<style lang="less" scoped>
.ble-devices-page {
  padding: 24px;
}
</style>
