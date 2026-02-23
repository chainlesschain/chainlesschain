<template>
  <div class="skill-palette">
    <div class="palette-header">
      <h3>节点面板</h3>
    </div>

    <!-- Default node types section -->
    <div class="palette-section">
      <div class="section-title">基础节点</div>
      <div class="palette-list">
        <div
          v-for="item in defaultNodes"
          :key="item.type"
          class="palette-item"
          :style="{ borderLeftColor: colorMap[item.type] || '#d9d9d9' }"
          draggable="true"
          @dragstart="onDragStart($event, item)"
        >
          <div class="palette-item__label">
            {{ item.label }}
          </div>
          <div v-if="item.description" class="palette-item__desc">
            {{ item.description }}
          </div>
        </div>
      </div>
    </div>

    <!-- Live skills section -->
    <div v-if="skillGroups.length > 0" class="palette-section">
      <div class="section-title">技能节点</div>
      <div v-for="group in skillGroups" :key="group.category" class="skill-group">
        <div
          class="group-header"
          @click="toggleGroup(group.category)"
        >
          <span class="group-arrow">{{ expandedGroups[group.category] ? '&#9660;' : '&#9654;' }}</span>
          <span class="group-name">{{ group.category }}</span>
          <a-tag size="small">{{ group.skills.length }}</a-tag>
        </div>
        <div v-if="expandedGroups[group.category]" class="group-skills">
          <div
            v-for="skill in group.skills"
            :key="skill.skillId"
            class="palette-item palette-item--skill"
            :style="{ borderLeftColor: '#1890ff' }"
            draggable="true"
            @dragstart="onDragStart($event, {
              type: 'skill',
              label: skill.name || skill.skillId,
              data: { skillId: skill.skillId, label: skill.name || skill.skillId },
            })"
          >
            <div class="palette-item__label">
              {{ skill.name || skill.skillId }}
            </div>
            <div class="palette-item__desc">
              {{ skill.skillId }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loadingSkills" class="palette-loading">
      <a-spin size="small" />
      <span>加载技能...</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from "vue";

const props = defineProps({
  skills: { type: Array, default: () => [] },
});

const defaultNodes = [
  {
    type: "skill",
    label: "技能节点",
    description: "执行一个技能",
    category: "basic",
  },
  {
    type: "condition",
    label: "条件节点",
    description: "条件分支判断",
    category: "control",
  },
  {
    type: "parallel",
    label: "并行节点",
    description: "并行执行多个分支",
    category: "control",
  },
  {
    type: "transform",
    label: "转换节点",
    description: "数据转换处理",
    category: "data",
  },
  {
    type: "loop",
    label: "循环节点",
    description: "循环执行子流程",
    category: "control",
  },
];

const colorMap = {
  skill: "#1890ff",
  condition: "#fa8c16",
  parallel: "#722ed1",
  transform: "#13c2c2",
  loop: "#52c41a",
};

// Live skills
const liveSkills = ref([]);
const loadingSkills = ref(false);
const expandedGroups = reactive({});

const skillGroups = computed(() => {
  const allSkills = liveSkills.value.length > 0 ? liveSkills.value : props.skills;
  if (!allSkills || allSkills.length === 0) return [];

  const groups = {};
  for (const skill of allSkills) {
    const cat = skill.category || "general";
    if (!groups[cat]) {
      groups[cat] = { category: cat, skills: [] };
    }
    groups[cat].skills.push(skill);
  }
  return Object.values(groups).sort((a, b) =>
    a.category.localeCompare(b.category),
  );
});

function toggleGroup(category) {
  expandedGroups[category] = !expandedGroups[category];
}

onMounted(async () => {
  loadingSkills.value = true;
  try {
    const result = await window.electronAPI?.invoke("skills:list-invocable");
    if (result?.success && Array.isArray(result.data)) {
      liveSkills.value = result.data;
      // Auto-expand first group
      if (result.data.length > 0) {
        const firstCat = result.data[0]?.category || "general";
        expandedGroups[firstCat] = true;
      }
    }
  } catch (e) {
    console.error("Failed to load invocable skills:", e);
  } finally {
    loadingSkills.value = false;
  }
});

const onDragStart = (event, item) => {
  event.dataTransfer.setData("application/json", JSON.stringify(item));
  event.dataTransfer.effectAllowed = "copy";
};
</script>

<style scoped>
.skill-palette {
  padding: 12px;
  height: 100%;
  overflow-y: auto;
}

.palette-header {
  margin-bottom: 12px;
}

.palette-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #262626;
}

.palette-section {
  margin-bottom: 16px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #8c8c8c;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.palette-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.palette-item {
  padding: 8px 10px;
  margin: 2px 0;
  background: #fafafa;
  border-radius: 6px;
  border-left: 4px solid #d9d9d9;
  cursor: grab;
  transition:
    background 0.2s,
    box-shadow 0.2s;
  user-select: none;
}

.palette-item:hover {
  background: #f0f0f0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.palette-item:active {
  cursor: grabbing;
}

.palette-item--skill {
  background: #f0f7ff;
}

.palette-item__label {
  font-size: 13px;
  font-weight: 500;
  color: #262626;
}

.palette-item__desc {
  font-size: 11px;
  color: #8c8c8c;
  margin-top: 2px;
}

.skill-group {
  margin-bottom: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: #595959;
}

.group-header:hover {
  color: #1890ff;
}

.group-arrow {
  font-size: 10px;
  width: 12px;
  flex-shrink: 0;
}

.group-name {
  font-weight: 500;
}

.group-skills {
  padding-left: 4px;
}

.palette-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: #8c8c8c;
  font-size: 12px;
}
</style>
