<template>
  <a-button size="small" :disabled="!sessionId" @click="openPanel">
    Remote
  </a-button>
  <a-modal
    v-model:open="visible"
    title="Continue on another device"
    :footer="null"
    width="420px"
  >
    <a-spin :spinning="loading">
      <a-alert
        v-if="error"
        type="error"
        show-icon
        message="Remote Session unavailable"
        :description="error"
      />
      <div v-else-if="pairing" class="remote-session-content">
        <img
          v-if="qrDataUrl"
          class="remote-session-qr"
          :src="qrDataUrl"
          alt="Remote Session pairing QR code"
        />
        <a-tag color="green">End-to-end encrypted</a-tag>
        <p>
          Scan with the ChainlessChain mobile app. This code is single-use and
          expires at {{ expiresAt }}.
        </p>
        <div class="remote-session-actions">
          <a-button size="small" @click="copyPairingLink">
            Copy pairing link
          </a-button>
          <a-button size="small" :loading="loading" @click="refreshPairing">
            Refresh code
          </a-button>
          <a-button
            size="small"
            danger
            :loading="loading"
            @click="closeRemoteSession"
          >
            Close session
          </a-button>
        </div>
        <a-divider style="margin: 12px 0" />
        <div class="remote-session-devices">
          <div class="remote-session-devices-header">
            <span>Paired devices ({{ devices.length }})</span>
            <a-button
              type="link"
              size="small"
              :loading="devicesLoading"
              @click="loadDevices"
            >
              Refresh
            </a-button>
          </div>
          <a-empty
            v-if="!devices.length"
            description="No devices yet. Scan the code to pair one."
          />
          <a-list v-else size="small" :data-source="devices">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta :description="item.scopes.join(', ')">
                  <template #title>
                    <span>{{ shortDeviceId(item.clientId) }}</span>
                    <a-tag
                      v-if="item.isHost"
                      color="blue"
                      style="margin-left: 6px"
                    >
                      Host
                    </a-tag>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-popconfirm
                    v-if="!item.isHost"
                    title="Revoke this device? It will be disconnected immediately."
                    ok-text="Revoke"
                    cancel-text="Cancel"
                    @confirm="revokeDevice(item.clientId)"
                  >
                    <a-button
                      type="link"
                      size="small"
                      danger
                      :disabled="devicesLoading"
                    >
                      Revoke
                    </a-button>
                  </a-popconfirm>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </div>
        <a-divider style="margin: 12px 0" />
        <div class="remote-session-audit">
          <div class="remote-session-devices-header">
            <span>Audit log ({{ auditStats.total || 0 }})</span>
            <a-button
              type="link"
              size="small"
              :loading="auditLoading"
              @click="loadAudit"
            >
              Refresh
            </a-button>
          </div>
          <a-empty
            v-if="!auditEntries.length"
            description="No audit events yet."
          />
          <a-timeline v-else class="remote-session-audit-timeline">
            <a-timeline-item
              v-for="entry in auditEntries"
              :key="entry.seq"
              :color="auditColor(entry.action)"
            >
              <div class="remote-session-audit-row">
                <a-tag>{{ entry.action }}</a-tag>
                <span class="remote-session-audit-actor">{{
                  shortDeviceId(entry.actor)
                }}</span>
                <span class="remote-session-audit-time">{{
                  formatTime(entry.timestamp)
                }}</span>
              </div>
              <div v-if="entry.detail" class="remote-session-audit-detail">
                {{ formatDetail(entry.detail) }}
              </div>
            </a-timeline-item>
          </a-timeline>
        </div>
      </div>
    </a-spin>
  </a-modal>
</template>

<script setup>
import { computed, ref } from "vue";
import { message } from "ant-design-vue";
import QRCode from "qrcode";

const props = defineProps({
  sessionId: { type: String, default: null },
});

const visible = ref(false);
const loading = ref(false);
const error = ref("");
const remoteSessionId = ref(null);
const pairing = ref(null);
const qrDataUrl = ref("");
const devices = ref([]);
const devicesLoading = ref(false);
const auditEntries = ref([]);
const auditStats = ref({ total: 0, byAction: {} });
const auditLoading = ref(false);
const expiresAt = computed(() =>
  pairing.value?.expiresAt
    ? new Date(pairing.value.expiresAt).toLocaleTimeString()
    : "soon",
);

async function renderPairing(nextPairing) {
  if (!nextPairing?.uri) {
    throw new Error(
      "Remote relay is not configured. Set CHAINLESSCHAIN_REMOTE_SESSION_RELAY_URL and CHAINLESSCHAIN_REMOTE_SESSION_PEER_ID.",
    );
  }
  pairing.value = nextPairing;
  qrDataUrl.value = await QRCode.toDataURL(nextPairing.uri, {
    width: 260,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

async function openPanel() {
  visible.value = true;
  if (pairing.value || !props.sessionId) {
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const response = await window.electronAPI.codingAgent.createRemoteSession({
      sessionId: props.sessionId,
      name: "Desktop Coding Session",
      scopes: ["observe", "prompt", "approve", "interrupt"],
    });
    if (!response?.success) {
      throw new Error(response?.error || "Failed to create Remote Session");
    }
    remoteSessionId.value = response.session?.sessionId;
    await renderPairing(response.pairing);
    await loadDevices();
    await loadAudit();
  } catch (cause) {
    error.value = cause?.message || String(cause);
  } finally {
    loading.value = false;
  }
}

function shortDeviceId(clientId) {
  if (!clientId) {
    return "device";
  }
  return clientId.length > 20
    ? `${clientId.slice(0, 12)}…${clientId.slice(-4)}`
    : clientId;
}

async function loadDevices() {
  if (!remoteSessionId.value) {
    return;
  }
  devicesLoading.value = true;
  try {
    const response =
      await window.electronAPI.codingAgent.listRemoteSessionDevices(
        remoteSessionId.value,
      );
    if (!response?.success) {
      throw new Error(response?.error || "Failed to load devices");
    }
    devices.value = response.devices || [];
  } catch (cause) {
    error.value = cause?.message || String(cause);
  } finally {
    devicesLoading.value = false;
  }
}

async function revokeDevice(clientId) {
  if (!remoteSessionId.value) {
    return;
  }
  devicesLoading.value = true;
  try {
    const response =
      await window.electronAPI.codingAgent.revokeRemoteSessionDevice({
        remoteSessionId: remoteSessionId.value,
        clientId,
      });
    if (!response?.success) {
      throw new Error(response?.error || "Failed to revoke device");
    }
    devices.value = response.devices || [];
    message.success("Device revoked");
    await loadAudit();
  } catch (cause) {
    error.value = cause?.message || String(cause);
  } finally {
    devicesLoading.value = false;
  }
}

const AUDIT_COLORS = {
  "session.created": "blue",
  "device.joined": "green",
  "device.revoked": "red",
  "device.disconnected": "gray",
  "session.closed": "gray",
  "control.prompt": "blue",
  "control.approval": "orange",
  "control.interrupt": "red",
};

function auditColor(action) {
  return AUDIT_COLORS[action] || "blue";
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "";
}

function formatDetail(detail) {
  if (!detail || typeof detail !== "object") {
    return detail ? String(detail) : "";
  }
  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

async function loadAudit() {
  if (!remoteSessionId.value) {
    return;
  }
  auditLoading.value = true;
  try {
    const response = await window.electronAPI.codingAgent.getRemoteSessionAudit(
      {
        remoteSessionId: remoteSessionId.value,
        limit: 200,
      },
    );
    if (!response?.success) {
      throw new Error(response?.error || "Failed to load audit log");
    }
    auditEntries.value = response.entries || [];
    auditStats.value = response.stats || { total: 0, byAction: {} };
  } catch (cause) {
    error.value = cause?.message || String(cause);
  } finally {
    auditLoading.value = false;
  }
}

async function refreshPairing() {
  if (!remoteSessionId.value) {
    return openPanel();
  }
  loading.value = true;
  error.value = "";
  try {
    const response =
      await window.electronAPI.codingAgent.refreshRemoteSessionPairing({
        remoteSessionId: remoteSessionId.value,
        scopes: ["observe", "prompt", "approve", "interrupt"],
      });
    if (!response?.success) {
      throw new Error(response?.error || "Failed to refresh pairing code");
    }
    await renderPairing(response.pairing);
    await loadDevices();
  } catch (cause) {
    error.value = cause?.message || String(cause);
  } finally {
    loading.value = false;
  }
}

async function copyPairingLink() {
  await navigator.clipboard.writeText(pairing.value.uri);
  message.success("Pairing link copied");
}

async function closeRemoteSession() {
  if (!remoteSessionId.value) {
    return;
  }
  loading.value = true;
  try {
    const response = await window.electronAPI.codingAgent.closeRemoteSession(
      remoteSessionId.value,
    );
    if (!response?.success) {
      throw new Error(response?.error || "Failed to close Remote Session");
    }
    pairing.value = null;
    qrDataUrl.value = "";
    remoteSessionId.value = null;
    devices.value = [];
    auditEntries.value = [];
    auditStats.value = { total: 0, byAction: {} };
    visible.value = false;
    message.success("Remote Session closed");
  } catch (cause) {
    error.value = cause?.message || String(cause);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.remote-session-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.remote-session-qr {
  width: 260px;
  height: 260px;
  border-radius: 8px;
}
.remote-session-actions {
  display: flex;
  gap: 8px;
}
.remote-session-devices,
.remote-session-audit {
  width: 100%;
  text-align: left;
}
.remote-session-devices-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 500;
  margin-bottom: 4px;
}
.remote-session-audit-timeline {
  max-height: 220px;
  overflow-y: auto;
  padding: 4px 4px 0;
}
.remote-session-audit-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.remote-session-audit-actor {
  font-size: 12px;
  opacity: 0.85;
}
.remote-session-audit-time {
  font-size: 12px;
  opacity: 0.6;
  margin-left: auto;
}
.remote-session-audit-detail {
  font-size: 12px;
  opacity: 0.7;
  margin-top: 2px;
}
</style>
