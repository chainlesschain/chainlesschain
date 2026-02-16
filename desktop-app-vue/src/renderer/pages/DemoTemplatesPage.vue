<template>
  <div class="demo-templates-page">
    <!-- Page Header -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <ThunderboltOutlined />
          AI Skills Demo
        </h1>
        <p class="page-description">
          Explore demo templates showcasing AI skills - browser automation,
          computer use, memory management, and more
        </p>
      </div>
      <div class="header-right">
        <a-input-search
          v-model:value="searchQuery"
          placeholder="Search demo templates..."
          style="width: 300px"
          allow-clear
          @search="handleSearch"
        />
      </div>
    </div>

    <!-- Category Filter -->
    <div class="category-section">
      <a-radio-group v-model:value="activeCategory" button-style="solid">
        <a-radio-button value="all">
          <AppstoreOutlined />
          All
        </a-radio-button>
        <a-radio-button
          v-for="cat in categories"
          :key="cat.key"
          :value="cat.key"
        >
          <component :is="cat.icon" />
          {{ cat.label }}
          <a-badge
            v-if="categoryCounts[cat.key]"
            :count="categoryCounts[cat.key]"
            :number-style="{
              backgroundColor: '#f0f0f0',
              color: '#666',
              fontSize: '11px',
            }"
            style="margin-left: 4px"
          />
        </a-radio-button>
      </a-radio-group>
    </div>

    <!-- Difficulty Filter -->
    <div class="filter-bar">
      <a-space>
        <span style="color: #999">Difficulty:</span>
        <a-radio-group v-model:value="activeDifficulty" size="small">
          <a-radio-button value="all"> All </a-radio-button>
          <a-radio-button value="beginner">
            <span style="color: #52c41a">Beginner</span>
          </a-radio-button>
          <a-radio-button value="intermediate">
            <span style="color: #faad14">Intermediate</span>
          </a-radio-button>
          <a-radio-button value="advanced">
            <span style="color: #ff4d4f">Advanced</span>
          </a-radio-button>
        </a-radio-group>
      </a-space>

      <span class="template-count"
        >{{ filteredTemplates.length }} templates</span
      >
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-container">
      <a-spin size="large" tip="Loading demo templates..." />
    </div>

    <!-- Template Grid -->
    <div v-else-if="filteredTemplates.length > 0" class="template-grid">
      <a-card
        v-for="template in filteredTemplates"
        :key="template.id"
        class="template-card"
        hoverable
        @click="openPreview(template)"
      >
        <template #title>
          <div class="card-title">
            <span class="card-icon">{{ template.icon || "📦" }}</span>
            <span>{{ template.display_name }}</span>
          </div>
        </template>
        <template #extra>
          <a-tag :color="difficultyColor(template.difficulty)" size="small">
            {{ template.difficulty || "beginner" }}
          </a-tag>
        </template>

        <p class="card-description">
          {{ template.description }}
        </p>

        <div class="card-skills">
          <a-tag
            v-for="skill in template.skills_used || []"
            :key="skill"
            color="blue"
            size="small"
          >
            {{ skill }}
          </a-tag>
        </div>

        <div class="card-footer">
          <a-tag>{{ template.category }}</a-tag>
          <a-button type="primary" size="small" @click.stop="runDemo(template)">
            <PlayCircleOutlined />
            Run Demo
          </a-button>
        </div>
      </a-card>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <a-empty description="No demo templates found matching your filters" />
    </div>

    <!-- Preview Modal -->
    <a-modal
      v-model:open="previewVisible"
      :title="previewTemplate?.display_name"
      width="720px"
      :footer="null"
    >
      <div v-if="previewTemplate" class="preview-content">
        <div class="preview-meta">
          <a-space wrap>
            <a-tag color="purple">
              {{ previewTemplate.category }}
            </a-tag>
            <a-tag :color="difficultyColor(previewTemplate.difficulty)">
              {{ previewTemplate.difficulty }}
            </a-tag>
            <a-tag
              v-for="tag in (previewTemplate.tags || []).slice(0, 5)"
              :key="tag"
            >
              {{ tag }}
            </a-tag>
          </a-space>
        </div>

        <a-divider />

        <h3>Description</h3>
        <p>{{ previewTemplate.description }}</p>

        <h3>Skills Used</h3>
        <div class="preview-skills">
          <a-tag
            v-for="skill in previewTemplate.skills_used || []"
            :key="skill"
            color="blue"
          >
            {{ skill }}
          </a-tag>
        </div>

        <h3>Variables</h3>
        <a-form layout="vertical">
          <a-form-item
            v-for="v in previewTemplate.variables_schema || []"
            :key="v.name"
            :label="v.label"
            :required="v.required"
          >
            <a-select
              v-if="v.type === 'select'"
              v-model:value="previewVariables[v.name]"
              :placeholder="v.placeholder"
            >
              <a-select-option
                v-for="opt in v.options || []"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </a-select-option>
            </a-select>
            <a-input
              v-else
              v-model:value="previewVariables[v.name]"
              :placeholder="v.placeholder"
            />
          </a-form-item>
        </a-form>

        <a-divider />

        <div class="preview-actions">
          <a-button @click="previewVisible = false"> Close </a-button>
          <a-button type="primary" @click="runDemoFromPreview">
            <PlayCircleOutlined />
            Run Demo
          </a-button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, h } from "vue";
import { message } from "ant-design-vue";
import {
  ThunderboltOutlined,
  AppstoreOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SearchOutlined,
  CloudOutlined,
  BookOutlined,
  DesktopOutlined,
} from "@ant-design/icons-vue";

// State
const loading = ref(true);
const searchQuery = ref("");
const activeCategory = ref("all");
const activeDifficulty = ref("all");
const allTemplates = ref([]);
const previewVisible = ref(false);
const previewTemplate = ref(null);
const previewVariables = ref({});

// Categories
const categories = [
  { key: "automation", label: "Automation", icon: ThunderboltOutlined },
  { key: "ai-workflow", label: "AI Workflow", icon: RobotOutlined },
  { key: "knowledge", label: "Knowledge", icon: BookOutlined },
  { key: "remote", label: "Remote", icon: DesktopOutlined },
];

// Computed
const categoryCounts = computed(() => {
  const counts = {};
  for (const t of allTemplates.value) {
    const cat = t.category || "other";
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
});

const filteredTemplates = computed(() => {
  let result = allTemplates.value;

  if (activeCategory.value !== "all") {
    result = result.filter((t) => t.category === activeCategory.value);
  }

  if (activeDifficulty.value !== "all") {
    result = result.filter((t) => t.difficulty === activeDifficulty.value);
  }

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(
      (t) =>
        t.display_name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        (t.tags || []).some((tag) => tag.toLowerCase().includes(q)) ||
        (t.skills_used || []).some((s) => s.toLowerCase().includes(q)),
    );
  }

  return result;
});

// Methods
function difficultyColor(difficulty) {
  switch (difficulty) {
    case "beginner":
      return "green";
    case "intermediate":
      return "orange";
    case "advanced":
      return "red";
    default:
      return "default";
  }
}

function openPreview(template) {
  previewTemplate.value = template;
  previewVariables.value = {};

  // Set default values
  for (const v of template.variables_schema || []) {
    if (v.default !== undefined) {
      previewVariables.value[v.name] = v.default;
    }
  }

  previewVisible.value = true;
}

function handleSearch() {
  // Search is reactive via computed
}

async function runDemo(template) {
  openPreview(template);
}

async function runDemoFromPreview() {
  if (!previewTemplate.value) {
    return;
  }

  try {
    const result = await window.electronAPI?.invoke(
      "template:run-demo",
      previewTemplate.value.id,
      previewVariables.value,
    );

    if (result?.success) {
      message.success(
        "Demo template rendered! Check AI chat for the workflow.",
      );
      previewVisible.value = false;

      // Copy rendered prompt to clipboard or send to AI chat
      if (result.renderedPrompt && navigator.clipboard) {
        await navigator.clipboard.writeText(result.renderedPrompt);
        message.info(
          "Workflow copied to clipboard. Paste in AI chat to execute.",
        );
      }
    } else {
      message.error(result?.error || "Failed to run demo");
    }
  } catch (error) {
    message.error(`Error: ${error.message}`);
  }
}

// Lifecycle
onMounted(async () => {
  try {
    const result = await window.electronAPI?.invoke("template:get-demos");

    if (result?.success && result.demos) {
      // Flatten grouped demos
      const templates = [];
      for (const [category, list] of Object.entries(result.demos)) {
        for (const t of list) {
          templates.push(t);
        }
      }
      allTemplates.value = templates;
    }
  } catch (error) {
    console.error("Failed to load demo templates:", error);
    message.error("Failed to load demo templates");
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.demo-templates-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 24px;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-description {
  color: #666;
  margin: 0;
}

.category-section {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.template-count {
  color: #999;
  font-size: 13px;
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.template-card {
  cursor: pointer;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.template-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-icon {
  font-size: 20px;
}

.card-description {
  color: #666;
  font-size: 13px;
  margin-bottom: 12px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-skills {
  margin-bottom: 12px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.empty-state {
  padding: 80px 0;
  text-align: center;
}

.preview-content {
  padding: 0 8px;
}

.preview-meta {
  margin-bottom: 8px;
}

.preview-skills {
  margin-bottom: 16px;
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
