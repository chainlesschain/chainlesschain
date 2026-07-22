<template>
  <a-card v-if="request" class="coding-agent-elicitation-panel" size="small">
    <template #title>MCP input required</template>
    <template #extra>
      <span class="elicitation-server">{{ serverName }}</span>
    </template>

    <p class="elicitation-message">{{ request.payload?.question }}</p>

    <a-form v-if="objectFields.length" layout="vertical">
      <a-form-item
        v-for="field in objectFields"
        :key="field.name"
        :label="field.title || field.name"
        :required="requiredFields.includes(field.name)"
      >
        <a-select
          v-if="Array.isArray(field.schema?.enum)"
          v-model:value="values[field.name]"
          :options="field.schema.enum.map((value) => ({ label: String(value), value }))"
        />
        <a-input-number
          v-else-if="field.schema?.type === 'number' || field.schema?.type === 'integer'"
          v-model:value="values[field.name]"
          style="width: 100%"
        />
        <a-switch
          v-else-if="field.schema?.type === 'boolean'"
          v-model:checked="values[field.name]"
        />
        <a-textarea
          v-else-if="field.schema?.type === 'string' && (field.schema?.format === 'textarea' || field.schema?.maxLength > 240)"
          v-model:value="values[field.name]"
          :rows="3"
        />
        <a-input v-else v-model:value="values[field.name]" />
      </a-form-item>
    </a-form>

    <a-textarea
      v-else
      v-model:value="rawValue"
      :rows="4"
      placeholder='Enter JSON, for example {"value":"yes"}'
    />

    <div class="elicitation-actions">
      <a-button @click="cancel">Cancel</a-button>
      <a-button type="primary" @click="accept">Submit</a-button>
    </div>
  </a-card>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

const props = defineProps<{ request: any | null }>();
const emit = defineEmits<{
  accept: [answer: any];
  cancel: [];
}>();

const values = reactive<Record<string, any>>({});
const rawValue = ref("{}");

const schema = computed(() => props.request?.payload?.requestedSchema || {});
const properties = computed(() => schema.value?.properties || {});
const requiredFields = computed(() =>
  Array.isArray(schema.value?.required) ? schema.value.required : [],
);
const objectFields = computed(() =>
  Object.entries(properties.value).map(([name, fieldSchema]: [string, any]) => ({
    name,
    schema: fieldSchema || {},
    title: fieldSchema?.title || null,
  })),
);
const serverName = computed(
  () => props.request?.payload?.metadata?.server || "MCP server",
);

watch(
  () => props.request?.id,
  () => {
    Object.keys(values).forEach((key) => delete values[key]);
    for (const field of objectFields.value) {
      if (field.schema.default !== undefined) values[field.name] = field.schema.default;
      else if (field.schema.type === "boolean") values[field.name] = false;
      else values[field.name] = undefined;
    }
    rawValue.value = "{}";
  },
  { immediate: true },
);

function accept() {
  if (objectFields.value.length) {
    const answer: Record<string, any> = {};
    for (const field of objectFields.value) {
      if (values[field.name] !== undefined) answer[field.name] = values[field.name];
    }
    emit("accept", answer);
    return;
  }
  try {
    emit("accept", JSON.parse(rawValue.value || "{}"));
  } catch {
    emit("accept", { value: rawValue.value });
  }
}

function cancel() {
  emit("cancel");
}
</script>

<style scoped>
.coding-agent-elicitation-panel {
  margin: 12px 0;
  border-color: #7c3aed;
}

.elicitation-server {
  color: #7c3aed;
  font-size: 12px;
}

.elicitation-message {
  margin-bottom: 12px;
  white-space: pre-wrap;
}

.elicitation-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
