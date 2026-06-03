<template>
  <a-modal
    :open="open"
    :width="960"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="管理控制台"
    class="admin-console-modal"
    @update:open="(v) => $emit('update:open', v)"
  >
    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="overview" tab="概览">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item label="产品名">
            {{ identity?.productName || "—" }}
          </a-descriptions-item>
          <a-descriptions-item label="品牌 ID">
            {{ identity?.identityId || "—" }}
          </a-descriptions-item>
          <a-descriptions-item label="主题">
            {{ theme?.themeId || "—" }} ({{ theme?.mode || "—" }})
          </a-descriptions-item>
          <a-descriptions-item label="生效 Slogan">
            {{ identity?.tagline || "—" }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider orientation="left"> 激活的企业能力 </a-divider>
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item label="LLM 提供方">
            <a-tag color="blue">
              {{ capLabel(llmProvider) }}
            </a-tag>
            <span class="cap-detail">
              {{ llmProvider?.endpoint || "—" }} · models={{
                llmProvider?.models?.length ?? 0
              }}
            </span>
          </a-descriptions-item>
          <a-descriptions-item label="认证提供方">
            <a-tag color="purple">
              {{ capLabel(authProvider) }}
            </a-tag>
            <span class="cap-detail">kind={{ authProvider?.kind || "—" }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="存储后端">
            <a-tag color="cyan">
              {{ capLabel(dataStorage) }}
            </a-tag>
            <span class="cap-detail">kind={{ dataStorage?.kind || "—" }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="加密服务">
            <a-tag color="orange">
              {{ capLabel(dataCrypto) }}
            </a-tag>
            <span class="cap-detail"
              >algs={{ (dataCrypto?.algs || []).join(", ") || "—" }}</span
            >
          </a-descriptions-item>
          <a-descriptions-item label="审计">
            <a-tag color="red">
              {{ capLabel(complianceAudit) }}
            </a-tag>
            <span class="cap-detail"
              >kind={{ complianceAudit?.kind || "—" }}</span
            >
          </a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="ui" tab="UI 扩展点">
        <a-collapse v-model:active-key="uiExpanded" ghost>
          <a-collapse-panel
            key="spaces"
            :header="`工作区 (${registry.spaces.length})`"
          >
            <ContributionList
              :items="registry.spaces"
              :columns="['id', 'pluginId', 'name', 'order']"
            />
          </a-collapse-panel>
          <a-collapse-panel
            key="artifacts"
            :header="`Artifact (${registry.artifacts.length})`"
          >
            <ContributionList
              :items="registry.artifacts"
              :columns="['id', 'pluginId', 'type', 'renderer']"
            />
          </a-collapse-panel>
          <a-collapse-panel
            key="slash"
            :header="`Slash (${registry.slashCommands.length})`"
          >
            <ContributionList
              :items="registry.slashCommands"
              :columns="['id', 'pluginId', 'trigger', 'description']"
            />
          </a-collapse-panel>
          <a-collapse-panel
            key="mention"
            :header="`@提及 (${registry.mentionSources.length})`"
          >
            <ContributionList
              :items="registry.mentionSources"
              :columns="['id', 'pluginId', 'prefix', 'label']"
            />
          </a-collapse-panel>
          <a-collapse-panel
            key="statusbar"
            :header="`状态栏 (${registry.statusBarWidgets.length})`"
          >
            <ContributionList
              :items="registry.statusBarWidgets"
              :columns="['id', 'pluginId', 'position', 'order']"
            />
          </a-collapse-panel>
          <a-collapse-panel
            key="home"
            :header="`Home 卡片 (${registry.homeWidgets.length})`"
          >
            <ContributionList
              :items="registry.homeWidgets"
              :columns="['id', 'pluginId', 'size', 'order']"
            />
          </a-collapse-panel>
          <a-collapse-panel
            key="composer"
            :header="`Composer 槽 (${registry.composerSlots.length})`"
          >
            <ContributionList
              :items="registry.composerSlots"
              :columns="['id', 'pluginId', 'position', 'order']"
            />
          </a-collapse-panel>
        </a-collapse>
      </a-tab-pane>

      <a-tab-pane key="enterprise" tab="企业能力">
        <div class="enterprise-note">
          优先级最高的贡献会生效；企业
          <code>.ccprofile</code> 可注入更高优先级覆盖默认值。
        </div>
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="LLM (ai.llm-provider)">
            <pre class="json-block">{{ pretty(llmProvider) }}</pre>
          </a-descriptions-item>
          <a-descriptions-item label="Auth (auth.provider)">
            <pre class="json-block">{{ pretty(authProvider) }}</pre>
          </a-descriptions-item>
          <a-descriptions-item label="Storage (data.storage)">
            <pre class="json-block">{{ pretty(dataStorage) }}</pre>
          </a-descriptions-item>
          <a-descriptions-item label="Crypto (data.crypto)">
            <pre class="json-block">{{ pretty(dataCrypto) }}</pre>
          </a-descriptions-item>
          <a-descriptions-item label="Audit (compliance.audit)">
            <pre class="json-block">{{ pretty(complianceAudit) }}</pre>
          </a-descriptions-item>
        </a-descriptions>
      </a-tab-pane>

      <a-tab-pane key="debug" tab="调试">
        <a-space>
          <a-button size="small" @click="refresh"> 刷新注册表 </a-button>
          <span class="cap-detail">
            lastRefresh =
            {{
              registry.lastRefresh
                ? new Date(registry.lastRefresh).toLocaleTimeString()
                : "—"
            }}
          </span>
        </a-space>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";
import ContributionList from "./admin/ContributionList.vue";

defineProps<{ open: boolean }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const registry = useExtensionRegistryStore();
const {
  brandTheme: theme,
  brandIdentity: identity,
  llmProvider,
  authProvider,
  dataStorage,
  dataCrypto,
  complianceAudit,
} = storeToRefs(registry);

const activeTab = ref("overview");
const uiExpanded = ref<string[]>(["spaces"]);

function capLabel(c: { name?: string } | null | undefined): string {
  if (!c) {
    return "未配置";
  }
  return c.name || "（未命名）";
}

function pretty(obj: unknown): string {
  if (!obj) {
    return "null";
  }
  return JSON.stringify(obj, null, 2);
}

async function refresh() {
  await registry.refreshAll();
}
</script>

<style scoped>
.cap-detail {
  margin-left: 8px;
  color: var(--cc-shell-muted, #888);
  font-size: 12px;
}

.enterprise-note {
  margin-bottom: 12px;
  color: var(--cc-shell-muted, #888);
  font-size: 12px;
}

.json-block {
  margin: 0;
  padding: 6px 8px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: var(--cc-shell-radius, 6px);
  font-size: 12px;
  max-height: 220px;
  overflow-y: auto;
}
</style>
