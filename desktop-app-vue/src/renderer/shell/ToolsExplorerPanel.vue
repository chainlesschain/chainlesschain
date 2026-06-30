<template>
  <a-modal
    :open="open"
    :width="980"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="Tools Explorer"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <ToolOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="te-toolbar">
      <a-input-search
        v-model:value="searchKeyword"
        placeholder="搜索工具、技能、标签..."
        style="width: 280px"
        allow-clear
        @search="handleSearch"
      />
      <a-button
        type="primary"
        size="small"
        :loading="store.loading"
        @click="handleRefresh"
      >
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <div class="stats-bar">
      <a-space :size="24">
        <a-statistic title="工具总数" :value="store.stats.totalTools" />
        <a-statistic title="技能总数" :value="store.stats.totalSkills" />
        <a-statistic title="内置" :value="store.stats.bySource?.builtin || 0" />
        <a-statistic title="MCP" :value="store.stats.bySource?.mcp || 0" />
      </a-space>
    </div>

    <div class="filter-section">
      <a-space :size="12" wrap>
        <span class="filter-label">来源:</span>
        <a-radio-group
          v-model:value="filterSource"
          button-style="solid"
          size="small"
          @change="handleSourceFilter"
        >
          <a-radio-button value="">全部</a-radio-button>
          <a-radio-button value="builtin">内置</a-radio-button>
          <a-radio-button value="mcp">MCP</a-radio-button>
          <a-radio-button value="skill-handler">技能</a-radio-button>
        </a-radio-group>

        <a-divider type="vertical" />

        <span class="filter-label">分类:</span>
        <a-select
          v-model:value="filterCategory"
          placeholder="全部分类"
          style="width: 150px"
          allow-clear
          size="small"
          @change="handleCategoryFilter"
        >
          <a-select-option
            v-for="cat in store.categories"
            :key="cat"
            :value="cat"
          >
            {{ cat }}
          </a-select-option>
        </a-select>

        <a-button v-if="hasActiveFilter" size="small" @click="clearFilters">
          清除筛选
        </a-button>
      </a-space>
    </div>

    <div v-if="store.loading" class="loading-container">
      <a-spin size="large" tip="加载工具中..." />
    </div>

    <a-alert
      v-else-if="store.error"
      type="error"
      :message="store.error"
      show-icon
      closable
      style="margin-bottom: 16px"
    />

    <div v-else class="skills-container">
      <a-collapse v-model:active-key="expandedSkills" :bordered="false">
        <a-collapse-panel
          v-for="skill in displaySkills"
          :key="skill.name"
          :header="skill.displayName || skill.name"
        >
          <template #extra>
            <a-space :size="8">
              <a-tag :color="sourceColor(skill.source)">
                {{ skill.source }}
              </a-tag>
              <a-tag>{{ skill.category }}</a-tag>
              <a-badge
                :count="skill.toolNames.length"
                :number-style="{ backgroundColor: '#1890ff' }"
              />
            </a-space>
          </template>

          <div class="skill-info">
            <p v-if="skill.description" class="skill-description">
              {{ skill.description }}
            </p>
            <div v-if="skill.instructions" class="skill-instructions">
              <h4>Instructions</h4>
              <p>{{ skill.instructions }}</p>
            </div>
            <div
              v-if="skill.examples && skill.examples.length > 0"
              class="skill-examples"
            >
              <h4>Examples</h4>
              <ul>
                <li v-for="(ex, i) in skill.examples.slice(0, 3)" :key="i">
                  <strong>"{{ ex.input }}"</strong>
                  <span class="example-arrow"> &rarr; </span>
                  <code>{{ ex.tool }}</code>
                  <span v-if="ex.params" class="example-params">
                    {{ JSON.stringify(ex.params) }}
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div class="tools-grid">
            <a-card
              v-for="toolName in skill.toolNames"
              :key="toolName"
              size="small"
              class="tool-card"
              :class="{ unavailable: !getToolAvailable(toolName) }"
            >
              <template #title>
                <a-space>
                  <ApiOutlined />
                  <span class="tool-name">{{ toolName }}</span>
                </a-space>
              </template>
              <template #extra>
                <a-tag
                  v-if="getToolSource(toolName)"
                  :color="sourceColor(getToolSource(toolName))"
                >
                  {{ getToolSource(toolName) }}
                </a-tag>
              </template>
              <p class="tool-description">{{ getToolDescription(toolName) }}</p>
              <div v-if="getToolTags(toolName).length > 0" class="tool-tags">
                <a-tag
                  v-for="tag in getToolTags(toolName)"
                  :key="tag"
                  size="small"
                >
                  {{ tag }}
                </a-tag>
              </div>
            </a-card>
          </div>
        </a-collapse-panel>
      </a-collapse>

      <div v-if="ungroupedTools.length > 0" class="ungrouped-section">
        <h3>其他工具 ({{ ungroupedTools.length }})</h3>
        <div class="tools-grid">
          <a-card
            v-for="tool in ungroupedTools"
            :key="tool.name"
            size="small"
            class="tool-card"
          >
            <template #title>
              <a-space>
                <ApiOutlined />
                <span class="tool-name">{{ tool.name }}</span>
              </a-space>
            </template>
            <template #extra>
              <a-tag :color="sourceColor(tool.source)">{{ tool.source }}</a-tag>
            </template>
            <p class="tool-description">{{ tool.description }}</p>
          </a-card>
        </div>
      </div>

      <a-empty
        v-if="
          displaySkills.length === 0 &&
          ungroupedTools.length === 0 &&
          !store.loading
        "
        description="未找到工具"
      />
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import {
  ToolOutlined,
  ReloadOutlined,
  ApiOutlined,
} from "@ant-design/icons-vue";
import { useUnifiedToolsStore } from "../stores/unified-tools";

const props = defineProps({
  open: { type: Boolean, default: false },
  prefillText: { type: String, default: "" },
});
defineEmits(["update:open"]);

const store = useUnifiedToolsStore();

const searchKeyword = ref("");
const filterSource = ref("");
const filterCategory = ref(undefined);
const expandedSkills = ref([]);

const hasActiveFilter = computed(() => {
  return (
    !!filterSource.value || !!filterCategory.value || !!searchKeyword.value
  );
});

const toolMap = computed(() => {
  const map = new Map();
  for (const tool of store.tools) {
    map.set(tool.name, tool);
  }
  return map;
});

const displaySkills = computed(() => {
  let skills = store.filteredSkills;

  if (searchKeyword.value) {
    const kw = searchKeyword.value.toLowerCase();
    skills = skills.filter((skill) => {
      if (skill.name.toLowerCase().includes(kw)) {
        return true;
      }
      if (skill.displayName?.toLowerCase().includes(kw)) {
        return true;
      }
      if (skill.description?.toLowerCase().includes(kw)) {
        return true;
      }
      return skill.toolNames.some((tn) => {
        const tool = toolMap.value.get(tn);
        return (
          tool &&
          (tn.toLowerCase().includes(kw) ||
            tool.description?.toLowerCase().includes(kw))
        );
      });
    });
  }

  if (filterSource.value) {
    skills = skills.filter((s) =>
      s.toolNames.some((tn) => {
        const tool = toolMap.value.get(tn);
        return tool && tool.source === filterSource.value;
      }),
    );
  }

  return skills;
});

const ungroupedTools = computed(() => {
  return store.filteredTools.filter((t) => !t.skillName);
});

function getToolDescription(name) {
  return toolMap.value.get(name)?.description || "No description";
}

function getToolSource(name) {
  return toolMap.value.get(name)?.source || "";
}

function getToolAvailable(name) {
  return toolMap.value.get(name)?.available !== false;
}

function getToolTags(name) {
  return toolMap.value.get(name)?.tags || [];
}

function sourceColor(source) {
  switch (source) {
    case "builtin":
      return "blue";
    case "mcp":
      return "green";
    case "mcp-auto":
      return "green";
    case "skill-handler":
      return "purple";
    case "builtin-skill":
      return "orange";
    case "tool-group":
      return "cyan";
    default:
      return "default";
  }
}

function handleSearch(value) {
  searchKeyword.value = value;
  store.searchKeyword = value;
}

function handleSourceFilter() {
  store.setFilterSource(filterSource.value);
}

function handleCategoryFilter(value) {
  store.setFilterCategory(value || "");
}

function clearFilters() {
  searchKeyword.value = "";
  filterSource.value = "";
  filterCategory.value = undefined;
  store.clearFilters();
}

async function handleRefresh() {
  await store.refresh();
}

// Load all tools on open; auto-expand the first 3 skills.
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return;
    }
    try {
      await store.loadAll();
      if (store.skills.length > 0) {
        expandedSkills.value = store.skills.slice(0, 3).map((s) => s.name);
      }
    } catch (err) {
      store.error = err?.message || "Failed to load tools";
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.te-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
}
.stats-bar {
  background: #fafafa;
  padding: 12px 20px;
  border-radius: 8px;
  margin-bottom: 16px;
}
.filter-section {
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
}
.filter-label {
  color: #666;
  font-size: 13px;
}
.loading-container {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}
.skill-info {
  margin-bottom: 16px;
}
.skill-description {
  color: #555;
  margin-bottom: 12px;
}
.skill-instructions h4,
.skill-examples h4 {
  font-size: 13px;
  color: #888;
  margin-bottom: 6px;
}
.skill-instructions p {
  color: #333;
  line-height: 1.6;
  background: #f9f9f9;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
}
.skill-examples ul {
  padding-left: 16px;
  margin: 0;
}
.skill-examples li {
  margin-bottom: 4px;
  font-size: 13px;
}
.example-arrow {
  color: #999;
}
.example-params {
  color: #888;
  font-size: 12px;
  margin-left: 4px;
}
.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.tool-card {
  transition: box-shadow 0.2s;
}
.tool-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.tool-card.unavailable {
  opacity: 0.5;
}
.tool-name {
  font-family: monospace;
  font-size: 13px;
}
.tool-description {
  color: #666;
  font-size: 12px;
  margin: 0;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.tool-tags {
  margin-top: 8px;
}
.ungrouped-section {
  margin-top: 24px;
}
.ungrouped-section h3 {
  font-size: 16px;
  margin-bottom: 12px;
}
</style>
