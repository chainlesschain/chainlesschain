<template>
  <div class="tools-explorer-page">
    <!-- Page Header -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <ToolOutlined />
          Tools Explorer
        </h1>
        <p class="page-description">
          Browse all tools grouped by skill — built-in, MCP, and skill-defined
          tools with Agent Skills metadata
        </p>
      </div>
      <div class="header-right">
        <a-input-search
          v-model:value="searchKeyword"
          placeholder="Search tools, skills, tags..."
          style="width: 300px"
          allow-clear
          @search="handleSearch"
        />
        <a-button
          type="primary"
          :loading="store.loading"
          @click="handleRefresh"
        >
          <ReloadOutlined />
          Refresh
        </a-button>
      </div>
    </div>

    <!-- Statistics Bar -->
    <div class="stats-bar">
      <a-space :size="24">
        <a-statistic title="Total Tools" :value="store.stats.totalTools" />
        <a-statistic title="Total Skills" :value="store.stats.totalSkills" />
        <a-statistic
          title="Built-in"
          :value="store.stats.bySource?.builtin || 0"
        />
        <a-statistic title="MCP" :value="store.stats.bySource?.mcp || 0" />
      </a-space>
    </div>

    <!-- Filters -->
    <div class="filter-section">
      <a-space :size="12">
        <span class="filter-label">Source:</span>
        <a-radio-group
          v-model:value="filterSource"
          button-style="solid"
          size="small"
          @change="handleSourceFilter"
        >
          <a-radio-button value=""> All </a-radio-button>
          <a-radio-button value="builtin"> Built-in </a-radio-button>
          <a-radio-button value="mcp"> MCP </a-radio-button>
          <a-radio-button value="skill-handler"> Skill </a-radio-button>
        </a-radio-group>

        <a-divider type="vertical" />

        <span class="filter-label">Category:</span>
        <a-select
          v-model:value="filterCategory"
          placeholder="All categories"
          style="width: 160px"
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
          Clear Filters
        </a-button>
      </a-space>
    </div>

    <!-- Loading -->
    <div v-if="store.loading" class="loading-container">
      <a-spin size="large" tip="Loading tools..." />
    </div>

    <!-- Error -->
    <a-alert
      v-else-if="store.error"
      type="error"
      :message="store.error"
      show-icon
      closable
      style="margin-bottom: 16px"
    />

    <!-- Skills Grouped View -->
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

          <!-- Skill Info -->
          <div class="skill-info">
            <p v-if="skill.description" class="skill-description">
              {{ skill.description }}
            </p>

            <!-- Instructions -->
            <div v-if="skill.instructions" class="skill-instructions">
              <h4>Instructions</h4>
              <p>{{ skill.instructions }}</p>
            </div>

            <!-- Examples -->
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

          <!-- Tools List -->
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
              <p class="tool-description">
                {{ getToolDescription(toolName) }}
              </p>
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

      <!-- Ungrouped tools -->
      <div v-if="ungroupedTools.length > 0" class="ungrouped-section">
        <h3>Other Tools ({{ ungroupedTools.length }})</h3>
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
              <a-tag :color="sourceColor(tool.source)">
                {{ tool.source }}
              </a-tag>
            </template>
            <p class="tool-description">
              {{ tool.description }}
            </p>
          </a-card>
        </div>
      </div>

      <!-- Empty state -->
      <a-empty
        v-if="
          displaySkills.length === 0 &&
          ungroupedTools.length === 0 &&
          !store.loading
        "
        description="No tools found"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import {
  ToolOutlined,
  ReloadOutlined,
  ApiOutlined,
} from "@ant-design/icons-vue";
import { useUnifiedToolsStore } from "../stores/unified-tools";

const store = useUnifiedToolsStore();

const searchKeyword = ref("");
const filterSource = ref("");
const filterCategory = ref(undefined);
const expandedSkills = ref([]);

// ===== Computed =====

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

  // If searching, only show skills that have matching tools
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

  // Apply source filter to skills
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

// ===== Helpers =====

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

// ===== Handlers =====

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

// ===== Lifecycle =====

onMounted(async () => {
  try {
    await store.loadAll();
    // Auto-expand the first 3 skills
    if (store.skills.length > 0) {
      expandedSkills.value = store.skills.slice(0, 3).map((s) => s.name);
    }
  } catch (err) {
    store.error = err?.message || "Failed to load tools";
  }
});
</script>

<style scoped>
.tools-explorer-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-header h1 {
  font-size: 24px;
  margin-bottom: 4px;
}

.page-description {
  color: #666;
  margin: 0;
}

.header-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

.stats-bar {
  background: #fafafa;
  padding: 16px 24px;
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
  padding: 80px 0;
}

.skills-container {
  margin-top: 8px;
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
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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
