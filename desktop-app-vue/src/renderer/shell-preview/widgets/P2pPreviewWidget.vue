<template>
  <div class="cc-preview-widget">
    <section class="cc-preview-widget__hero">
      <TeamOutlined class="cc-preview-widget__icon" />
      <h3>P2P 加密协作</h3>
      <p>
        端到端 Signal 协议加密，消息与文件直接在设备间传输，不经过中心服务器。
      </p>
    </section>

    <dl class="cc-preview-widget__kv">
      <div>
        <dt>当前会话</dt>
        <dd>{{ peers }} 个</dd>
      </div>
      <div>
        <dt>离线队列</dt>
        <dd>{{ offlineQueue }} 条</dd>
      </div>
      <div>
        <dt>加密握手</dt>
        <dd>X3DH + Double Ratchet</dd>
      </div>
    </dl>

    <div class="cc-preview-widget__actions">
      <a-button type="primary" block @click="openFullPage">
        打开完整 P2P 消息面板
      </a-button>
      <a-button block @click="openDevicePairing"> 设备配对 </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { TeamOutlined } from "@ant-design/icons-vue";

const router = useRouter();
const peers = ref(0);
const offlineQueue = ref(0);

function openFullPage() {
  router.push({ name: "P2PMessaging" }).catch(() => {});
}

function openDevicePairing() {
  router.push("/main/p2p/device-pairing").catch(() => {});
}
</script>

<style scoped>
.cc-preview-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cc-preview-widget__hero {
  text-align: center;
  padding: 16px 8px 4px;
}

.cc-preview-widget__icon {
  font-size: 32px;
  color: var(--cc-preview-accent);
  margin-bottom: 8px;
}

.cc-preview-widget__hero h3 {
  margin: 0 0 6px;
  font-size: 15px;
  color: var(--cc-preview-text-primary);
}

.cc-preview-widget__hero p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cc-preview-text-secondary);
}

.cc-preview-widget__kv {
  margin: 0;
  padding: 10px 12px;
  background: var(--cc-preview-bg-hover);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cc-preview-widget__kv > div {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.cc-preview-widget__kv dt {
  color: var(--cc-preview-text-secondary);
  margin: 0;
}

.cc-preview-widget__kv dd {
  margin: 0;
  color: var(--cc-preview-text-primary);
  font-weight: 500;
}

.cc-preview-widget__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
