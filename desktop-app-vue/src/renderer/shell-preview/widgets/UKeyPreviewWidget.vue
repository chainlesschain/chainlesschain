<template>
  <div class="cc-preview-widget">
    <section class="cc-preview-widget__hero">
      <SafetyCertificateOutlined class="cc-preview-widget__icon" />
      <h3>U-Key 硬件安全</h3>
      <p>
        基于 U 盾 / SIMKey
        的硬件签名与加密。私钥永不出硬件，交易签名、消息加密均在硬件内完成。
      </p>
    </section>

    <dl class="cc-preview-widget__kv">
      <div>
        <dt>设备状态</dt>
        <dd>
          <span
            class="cc-preview-widget__dot"
            :class="{ 'cc-preview-widget__dot--on': connected }"
          />
          {{ connected ? "已连接" : "未检测" }}
        </dd>
      </div>
      <div>
        <dt>平台</dt>
        <dd>{{ platformNote }}</dd>
      </div>
      <div>
        <dt>PQC</dt>
        <dd>Kyber + Dilithium</dd>
      </div>
    </dl>

    <div class="cc-preview-widget__actions">
      <a-button type="primary" block @click="openThresholdSecurity">
        阈值安全
      </a-button>
      <a-button block @click="openDatabaseSecurity"> 数据库加密 </a-button>
      <a-button block @click="openHsmAdapter"> HSM 适配 </a-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { SafetyCertificateOutlined } from "@ant-design/icons-vue";

const router = useRouter();
const connected = ref(false);

const platformNote = computed(() => {
  if (typeof navigator === "undefined") {
    return "未知";
  }
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) {
    return "Windows (硬件模式)";
  }
  return "macOS / Linux (模拟模式)";
});

function openThresholdSecurity() {
  router.push({ name: "ThresholdSecurity" }).catch(() => {});
}

function openDatabaseSecurity() {
  router.push({ name: "DatabaseSecurity" }).catch(() => {});
}

function openHsmAdapter() {
  router.push("/main/hsm-adapter").catch(() => {});
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
  display: flex;
  align-items: center;
  gap: 6px;
}

.cc-preview-widget__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cc-preview-text-muted);
  display: inline-block;
}

.cc-preview-widget__dot--on {
  background: var(--cc-preview-accent);
}

.cc-preview-widget__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
