<template>
  <div class="expression-builder">
    <div class="builder-header">
      <span class="builder-title">条件构建器</span>
      <a-button size="small" type="link" @click="addRule">
        + 添加规则
      </a-button>
    </div>

    <div v-for="(group, gi) in groups" :key="gi" class="rule-group">
      <div v-if="gi > 0" class="group-connector">
        <a-select
          :value="group.connector"
          size="small"
          style="width: 80px"
          @change="(val) => updateGroupConnector(gi, val)"
        >
          <a-select-option value="AND">AND</a-select-option>
          <a-select-option value="OR">OR</a-select-option>
        </a-select>
      </div>

      <div
        v-for="(rule, ri) in group.rules"
        :key="ri"
        class="rule-row"
      >
        <a-input
          :value="rule.variable"
          placeholder="变量名"
          size="small"
          style="width: 100px"
          @change="(e) => updateRule(gi, ri, 'variable', e.target.value)"
        />

        <a-select
          :value="rule.operator"
          size="small"
          style="width: 100px"
          @change="(val) => updateRule(gi, ri, 'operator', val)"
        >
          <a-select-option v-for="op in operators" :key="op.value" :value="op.value">
            {{ op.label }}
          </a-select-option>
        </a-select>

        <a-input
          :value="rule.value"
          placeholder="值"
          size="small"
          style="width: 80px"
          @change="(e) => updateRule(gi, ri, 'value', e.target.value)"
        />

        <a-button
          size="small"
          type="text"
          danger
          @click="removeRule(gi, ri)"
        >
          &#10007;
        </a-button>
      </div>
    </div>

    <div class="builder-preview">
      <span class="preview-label">表达式:</span>
      <code class="preview-code">{{ expressionPreview }}</code>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";

const props = defineProps({
  expression: { type: String, default: "" },
});

const emit = defineEmits(["update:expression"]);

const operators = [
  { value: "==", label: "==" },
  { value: "!=", label: "!=" },
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "contains", label: "包含" },
  { value: "startsWith", label: "开头是" },
  { value: "endsWith", label: "结尾是" },
  { value: "exists", label: "存在" },
  { value: "empty", label: "为空" },
  { value: "matches", label: "匹配" },
  { value: "in", label: "属于" },
  { value: "typeof", label: "类型为" },
];

const groups = ref([
  {
    connector: "AND",
    rules: [{ variable: "", operator: "==", value: "" }],
  },
]);

// Parse existing expression on mount
watch(
  () => props.expression,
  (expr) => {
    if (expr && groups.value[0].rules[0].variable === "") {
      // Simple parse: try to extract variable/operator/value from expression
      const match = expr.match(/^(\w+)\s*(==|!=|>=|<=|>|<|contains|startsWith|endsWith)\s*(.+)$/);
      if (match) {
        groups.value[0].rules[0] = {
          variable: match[1],
          operator: match[2],
          value: match[3].replace(/^["']|["']$/g, ""),
        };
      }
    }
  },
  { immediate: true },
);

function addRule() {
  const lastGroup = groups.value[groups.value.length - 1];
  lastGroup.rules.push({ variable: "", operator: "==", value: "" });
  emitExpression();
}

function removeRule(gi, ri) {
  groups.value[gi].rules.splice(ri, 1);
  if (groups.value[gi].rules.length === 0) {
    if (groups.value.length > 1) {
      groups.value.splice(gi, 1);
    } else {
      groups.value[0].rules.push({ variable: "", operator: "==", value: "" });
    }
  }
  emitExpression();
}

function updateRule(gi, ri, field, value) {
  groups.value[gi].rules[ri][field] = value;
  emitExpression();
}

function updateGroupConnector(gi, value) {
  groups.value[gi].connector = value;
  emitExpression();
}

const expressionPreview = computed(() => {
  return buildExpression();
});

function buildExpression() {
  const parts = [];
  for (let gi = 0; gi < groups.value.length; gi++) {
    const group = groups.value[gi];
    const ruleParts = group.rules
      .filter((r) => r.variable)
      .map((r) => {
        if (r.operator === "exists" || r.operator === "empty") {
          return `${r.variable} ${r.operator}`;
        }
        return `${r.variable} ${r.operator} ${r.value}`;
      });

    if (ruleParts.length > 0) {
      if (gi > 0 && parts.length > 0) {
        parts.push(group.connector);
      }
      parts.push(ruleParts.join(" AND "));
    }
  }
  return parts.join(" ") || "(empty)";
}

function emitExpression() {
  const expr = buildExpression();
  if (expr !== "(empty)") {
    emit("update:expression", expr);
  }
}
</script>

<style scoped>
.expression-builder {
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 8px;
  background: #fafafa;
}

.builder-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.builder-title {
  font-size: 12px;
  font-weight: 600;
  color: #595959;
}

.rule-group {
  margin-bottom: 4px;
}

.group-connector {
  margin: 4px 0;
  text-align: center;
}

.rule-row {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-bottom: 4px;
}

.builder-preview {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-label {
  font-size: 11px;
  color: #8c8c8c;
  flex-shrink: 0;
}

.preview-code {
  font-size: 11px;
  color: #d48806;
  background: #fffbe6;
  padding: 2px 6px;
  border-radius: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
