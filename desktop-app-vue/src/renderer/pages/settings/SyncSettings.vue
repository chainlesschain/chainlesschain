<template>
  <div class="sync-settings">
    <a-page-header title="同步设置" sub-title="选择要启用的同步目标和周期">
      <template #extra>
        <a-button @click="$router.push('/settings')">
          <template #icon>
            <ArrowLeftOutlined />
          </template>
          返回设置
        </a-button>
      </template>
    </a-page-header>

    <!-- 全局自动同步控制 -->
    <a-card class="auto-sync-card" title="自动同步" size="small">
      <a-row align="middle" :gutter="16">
        <a-col :span="8">
          <a-space>
            <a-switch
              :checked="autoSyncEnabled"
              :disabled="!hasAnyEnabled"
              @change="
                (val: boolean | string | number) => onToggleAutoSync(!!val)
              "
            />
            <span>{{ autoSyncEnabled ? "已开启" : "已关闭" }}</span>
          </a-space>
          <div v-if="!hasAnyEnabled" class="hint-text">
            需先启用至少 1 个同步目标
          </div>
        </a-col>
        <a-col :span="10">
          <a-space>
            <span>每</span>
            <a-input-number
              v-model:value="intervalMinModel"
              :min="1"
              :max="1440"
              :step="1"
              style="width: 100px"
              @change="onIntervalChange"
            />
            <span>分钟同步一次</span>
          </a-space>
        </a-col>
        <a-col :span="6" class="text-right">
          <a-button type="primary" :loading="runningAll" @click="onRunAll">
            <template #icon>
              <SyncOutlined />
            </template>
            立即同步全部
          </a-button>
        </a-col>
      </a-row>
      <div v-if="lastResultText" class="last-result">
        最近一次：{{ lastResultText }}
      </div>
    </a-card>

    <!-- Provider 列表 -->
    <a-card class="providers-card" title="同步目标" size="small">
      <a-list :data-source="providerCards" item-layout="horizontal">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <a-space>
                  <span class="provider-name">{{ item.provider.name }}</span>
                  <a-tag v-if="item.provider.placeholder" color="orange">
                    敬请期待
                  </a-tag>
                  <a-tag v-else-if="!item.available" color="default">
                    不可用
                  </a-tag>
                  <a-tag v-else color="green"> 可用 </a-tag>
                  <a-tag
                    v-if="item.lastDetail"
                    :color="item.lastSuccess ? 'green' : 'red'"
                  >
                    {{ item.lastSuccess ? "✓" : "✗" }}
                    {{ item.lastDetail }}
                  </a-tag>
                </a-space>
              </template>
              <template #description>
                {{ item.provider.description }}
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button
                v-if="item.provider.configRoute"
                size="small"
                type="link"
                @click="$router.push(item.provider.configRoute)"
              >
                配置
              </a-button>
              <a-button
                size="small"
                :disabled="!item.available || item.provider.placeholder"
                :loading="!!runningById[item.provider.id]"
                @click="onRunOne(item.provider.id)"
              >
                立即同步
              </a-button>
              <a-switch
                :checked="item.enabled"
                :disabled="!item.available || item.provider.placeholder"
                @change="
                  (val: boolean | string | number) =>
                    onToggle(item.provider.id, !!val)
                "
              />
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { ArrowLeftOutlined, SyncOutlined } from "@ant-design/icons-vue";
import { logger } from "@/utils/logger";
import { PROVIDERS } from "@/utils/syncProviders";
import * as scheduler from "@/utils/syncScheduler";

interface ProviderCard {
  provider: (typeof PROVIDERS)[number];
  enabled: boolean;
  available: boolean;
  lastSuccess: boolean | null;
  lastDetail: string;
}

const autoSyncEnabled = ref(scheduler.getEnabled());
const intervalMinModel = ref(scheduler.getIntervalMin());
const providerCards = ref<ProviderCard[]>([]);
const runningById = reactive<Record<string, boolean>>({});
const runningAll = ref(false);
const lastResultText = ref("");

const hasAnyEnabled = computed(() =>
  providerCards.value.some((c) => c.enabled),
);

async function refreshCards() {
  const next: ProviderCard[] = [];
  for (const p of PROVIDERS) {
    let available = false;
    try {
      available = await Promise.resolve(p.available());
    } catch {
      available = false;
    }
    next.push({
      provider: p,
      enabled: scheduler.isProviderEnabled(p.id),
      available,
      lastSuccess: null,
      lastDetail: "",
    });
  }
  providerCards.value = next;
}

function applyAggregateToCards(result: scheduler.AggregateResult) {
  for (const r of result.perProvider) {
    const card = providerCards.value.find(
      (c) => c.provider.id === r.providerId,
    );
    if (card) {
      card.lastSuccess = r.result.success;
      card.lastDetail = r.result.success
        ? r.result.detail || `${r.durationMs}ms`
        : r.result.error || "失败";
    }
  }
  if (result.skipped) {
    lastResultText.value = "未启用任何同步目标";
  } else {
    lastResultText.value = `${result.succeeded}/${result.ran} 成功 · ${new Date().toLocaleTimeString()}`;
  }
}

const onToggle = async (id: string, enabled: boolean) => {
  scheduler.setProviderEnabled(id, enabled);
  const card = providerCards.value.find((c) => c.provider.id === id);
  if (card) {
    card.enabled = enabled;
  }
  // 如果关掉了所有 provider 但 autoSync 还开着，主动停掉避免空跑
  if (!hasAnyEnabled.value && autoSyncEnabled.value) {
    scheduler.stop();
    autoSyncEnabled.value = false;
    message.info("无启用目标，已自动关闭周期同步");
  }
};

const onToggleAutoSync = (enabled: boolean) => {
  autoSyncEnabled.value = enabled;
  if (enabled) {
    scheduler.start(intervalMinModel.value);
    message.success(`自动同步已开启（每 ${intervalMinModel.value} 分钟）`);
  } else {
    scheduler.stop();
    message.info("自动同步已关闭");
  }
};

const onIntervalChange = (val: number) => {
  if (typeof val !== "number" || !Number.isFinite(val)) {
    return;
  }
  scheduler.setIntervalMin(val);
  intervalMinModel.value = scheduler.getIntervalMin();
};

const onRunOne = async (id: string) => {
  runningById[id] = true;
  try {
    const result = await scheduler.runProviderOnce(id);
    const card = providerCards.value.find((c) => c.provider.id === id);
    if (card) {
      card.lastSuccess = result.success;
      card.lastDetail = result.success
        ? result.detail || "成功"
        : result.error || "失败";
    }
    if (result.success) {
      message.success(card?.provider.name + " 同步完成");
    } else {
      message.error(card?.provider.name + " 失败：" + (result.error || ""));
    }
  } catch (err: any) {
    logger.error("[SyncSettings] runOne failed:", err);
    message.error("调用失败：" + (err?.message || String(err)));
  } finally {
    runningById[id] = false;
  }
};

const onRunAll = async () => {
  runningAll.value = true;
  try {
    const result = await scheduler.runOnce();
    applyAggregateToCards(result);
    if (result.skipped) {
      message.warning("未启用任何同步目标");
    } else if (result.success) {
      message.success(`同步完成（${result.succeeded}/${result.ran}）`);
    } else {
      message.error(
        `同步失败 (${result.succeeded}/${result.ran})：${result.error || ""}`,
      );
    }
  } finally {
    runningAll.value = false;
  }
};

onMounted(refreshCards);
</script>

<style scoped>
.sync-settings {
  padding: 16px 24px;
  max-width: 1080px;
  margin: 0 auto;
}
.auto-sync-card,
.providers-card {
  margin-top: 16px;
}
.last-result {
  margin-top: 12px;
  color: var(--cc-text-secondary, #999);
  font-size: 12px;
}
.hint-text {
  font-size: 12px;
  color: var(--cc-text-secondary, #999);
  margin-top: 4px;
}
.text-right {
  text-align: right;
}
.provider-name {
  font-weight: 500;
}
</style>
