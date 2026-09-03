<template>
  <div class="skill-palette">
    <div class="palette-header">
      <h3>节点面板</h3>
      <a-input-search
        v-model:value="skillQuery"
        size="small"
        allow-clear
        placeholder="按名称、描述或标签检索技能"
        :loading="routingSkills"
        @search="routeSkills"
      />
      <a-alert
        v-if="routingConflict"
        type="warning"
        show-icon
        :message="routingConflict"
      />
      <a-alert
        v-if="outcomeAuthorityNotice"
        :type="outcomeAuthorityNotice.type"
        show-icon
        :message="outcomeAuthorityNotice.message"
      />
      <a-alert
        v-if="vectorAuthorityNotice"
        :type="vectorAuthorityNotice.type"
        show-icon
        :message="vectorAuthorityNotice.message"
      />
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
      <div
        v-for="group in skillGroups"
        :key="group.category"
        class="skill-group"
      >
        <div class="group-header" @click="toggleGroup(group.category)">
          <span class="group-arrow">{{
            expandedGroups[group.category] ? "&#9660;" : "&#9654;"
          }}</span>
          <span class="group-name">{{ group.category }}</span>
          <a-tag size="small">
            {{ group.skills.length }}
          </a-tag>
        </div>
        <div v-if="expandedGroups[group.category]" class="group-skills">
          <div
            v-for="skill in group.skills"
            :key="skill.skillId"
            class="palette-item palette-item--skill"
            :style="{ borderLeftColor: '#1890ff' }"
            draggable="true"
            @dragstart="
              onDragStart($event, {
                type: 'skill',
                label: skill.name || skill.skillId,
                data: {
                  skillId: skill.skillId,
                  label: skill.name || skill.skillId,
                },
              })
            "
          >
            <div class="palette-item__label">
              {{ skill.name || skill.skillId }}
            </div>
            <div class="palette-item__desc">
              {{ skill.version ? `v${skill.version} · ` : ""
              }}{{ skill.reason || skill.skillId }}
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
const routingSkills = ref(false);
const skillQuery = ref("");
const routingConflict = ref("");
const outcomeAuthorityNotice = ref(null);
const vectorAuthorityNotice = ref(null);
const expandedGroups = reactive({});

const OUTCOME_AUTHORITY_SCHEMA =
  "chainlesschain.desktop-skill-outcome-db-authority/v1";
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const VECTOR_AUTHORITY_SCHEMA = "chainlesschain.skill-vector-authority/v1";
const SAFE_AUTHORITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

function parseVectorAuthority(value, vectorAvailable) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== VECTOR_AUTHORITY_SCHEMA ||
    typeof vectorAvailable !== "boolean"
  ) {
    throw new Error("Skill vector authority evidence is invalid");
  }
  if (value.status === "unavailable") {
    if (
      Reflect.ownKeys(value).length !== 3 ||
      typeof value.code !== "string" ||
      !/^CC_SKILL_VECTOR_[A-Z0-9_]{1,96}$/u.test(value.code) ||
      vectorAvailable !== false
    ) {
      throw new Error("Skill vector authority unavailable evidence is invalid");
    }
    return {
      type: "warning",
      message:
        "Vector ranking was unavailable; retrieval used lexical and outcome evidence only.",
    };
  }
  const keys = [
    "schema",
    "status",
    "tenantId",
    "requestDigest",
    "corpusDigest",
    "skillCount",
    "modelId",
    "modelRevision",
    "indexDigest",
    "resultDigest",
    "receiptDigest",
  ];
  if (
    value.status !== "verified" ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    !SAFE_AUTHORITY_ID.test(value.tenantId || "") ||
    !SAFE_AUTHORITY_ID.test(value.modelId || "") ||
    !SAFE_AUTHORITY_ID.test(value.modelRevision || "") ||
    !Number.isSafeInteger(value.skillCount) ||
    value.skillCount < 1 ||
    value.skillCount > 10_000 ||
    [
      value.requestDigest,
      value.corpusDigest,
      value.indexDigest,
      value.resultDigest,
      value.receiptDigest,
    ].some((digest) => !SHA256_DIGEST.test(digest || ""))
  ) {
    throw new Error("Skill vector authority verification failed");
  }
  return {
    type: "info",
    message: `Vector ranking verified by ${value.modelId}@${value.modelRevision}.`,
  };
}

function parseOutcomeAuthority(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema !== OUTCOME_AUTHORITY_SCHEMA ||
    value.antiRollbackWitness !== false
  ) {
    throw new Error("技能结果证据格式无效");
  }
  if (value.status === "unavailable") {
    if (
      typeof value.code !== "string" ||
      !value.code.startsWith("CC_DESKTOP_SKILL_") ||
      value.code.length > 128
    ) {
      throw new Error("技能结果证据不可用状态无效");
    }
    return {
      type: "warning",
      message: "历史结果证据不可用，本次检索未使用部分结果数据。",
    };
  }
  const countKeys = [
    "rowCount",
    "receiptCount",
    "uniqueReceiptCount",
    "attributionEligibleReceiptCount",
    "outcomeEligibleReceiptCount",
    "duplicateReceiptCount",
  ];
  if (
    value.status !== "verified-local-db" ||
    !SHA256_DIGEST.test(value.sourceDigest || "") ||
    !Number.isSafeInteger(value.maxRows) ||
    value.maxRows < 1 ||
    value.maxRows > 10_000 ||
    countKeys.some(
      (key) =>
        !Number.isSafeInteger(value[key]) ||
        value[key] < 0 ||
        value[key] > value.maxRows,
    ) ||
    value.receiptCount > value.rowCount ||
    value.uniqueReceiptCount > value.receiptCount ||
    value.attributionEligibleReceiptCount > value.uniqueReceiptCount ||
    value.outcomeEligibleReceiptCount > value.attributionEligibleReceiptCount ||
    value.duplicateReceiptCount !==
      value.receiptCount - value.uniqueReceiptCount
  ) {
    throw new Error("技能结果证据校验失败");
  }
  return {
    type: "info",
    message: "排序已使用本地回执证据；本地数据库暂不具备独立防回滚见证。",
  };
}

const skillGroups = computed(() => {
  const allSkills =
    liveSkills.value.length > 0 ? liveSkills.value : props.skills;
  if (!allSkills || allSkills.length === 0) {
    return [];
  }

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

async function routeSkills() {
  const query = skillQuery.value.trim();
  routingConflict.value = "";
  outcomeAuthorityNotice.value = null;
  vectorAuthorityNotice.value = null;
  if (!query) {
    await loadSkills();
    return;
  }
  routingSkills.value = true;
  try {
    const response = await window.electronAPI?.invoke("skills:route", query, {
      topK: 20,
    });
    if (response?.success !== true) {
      throw new Error(response?.error || "技能检索失败");
    }
    const result = response.result;
    outcomeAuthorityNotice.value = parseOutcomeAuthority(
      result?.outcomeAuthority,
    );
    vectorAuthorityNotice.value = parseVectorAuthority(
      result?.vectorAuthority,
      result?.vectorAvailable,
    );
    const candidates = (result?.candidates || []).map((candidate) => ({
      skillId: candidate.id,
      name: candidate.displayName,
      category: candidate.category || "general",
      version: candidate.version,
      digest: candidate.digest,
      reason: candidate.reason,
    }));
    if (result?.selected === null && result?.conflicts?.length > 0) {
      routingConflict.value =
        "候选存在版本或得分冲突，请缩小检索范围后再选择。";
      liveSkills.value = [];
    } else {
      liveSkills.value = candidates;
    }
  } catch (error) {
    routingConflict.value = error?.message || String(error);
    liveSkills.value = [];
  } finally {
    routingSkills.value = false;
  }
}

async function loadSkills() {
  loadingSkills.value = true;
  try {
    const result = await window.electronAPI?.invoke("skills:list-invocable");
    if (result?.success && Array.isArray(result.skills)) {
      liveSkills.value = result.skills.map((s) => ({
        skillId: s.id || s.skillId,
        name: s.name,
        category: s.category || "general",
        description: s.description,
      }));
      if (liveSkills.value.length > 0) {
        const firstCat = liveSkills.value[0]?.category || "general";
        expandedGroups[firstCat] = true;
      }
    }
  } catch (error) {
    console.error("Failed to load invocable skills:", error);
  } finally {
    loadingSkills.value = false;
  }
}

onMounted(async () => {
  await loadSkills();
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

.palette-header :deep(.ant-input-search),
.palette-header :deep(.ant-alert) {
  margin-top: 8px;
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
