<template>
  <a-card v-if="request" class="coding-agent-elicitation-panel" size="small">
    <template #title>{{ panelTitle }}</template>
    <template v-if="isMcpElicitation" #extra>
      <span class="elicitation-server">{{ serverName }}</span>
    </template>

    <p class="elicitation-message">{{ request.payload?.question }}</p>

    <a-form v-if="isMcpElicitation && schemaModel.supported" layout="vertical">
      <p v-if="!objectFields.length" class="elicitation-field-description">
        This request does not require any fields.
      </p>
      <a-form-item
        v-for="field in objectFields"
        :key="field.name"
        :label="field.title"
        :required="field.required"
      >
        <p v-if="field.description" class="elicitation-field-description">
          {{ field.description }}
        </p>
        <a-select
          v-if="field.kind === 'single-select'"
          v-model:value="values[field.name]"
          :options="field.options"
        />
        <a-select
          v-else-if="field.kind === 'multi-select'"
          v-model:value="values[field.name]"
          mode="multiple"
          :options="field.options"
        />
        <a-input-number
          v-else-if="field.kind === 'number' || field.kind === 'integer'"
          v-model:value="values[field.name]"
          :min="field.minimum"
          :max="field.maximum"
          :step="field.step"
          style="width: 100%"
        />
        <a-switch
          v-else-if="field.kind === 'boolean'"
          v-model:checked="values[field.name]"
        />
        <a-input
          v-else
          v-model:value="values[field.name]"
          :type="field.inputType"
          :minlength="field.minLength"
          :maxlength="field.maxLength"
        />
        <p
          v-if="fieldError(field.name)"
          class="elicitation-field-error"
          role="alert"
        >
          {{ fieldError(field.name) }}
        </p>
      </a-form-item>
    </a-form>

    <template v-else-if="isMcpElicitation">
      <p class="elicitation-schema-warning">
        This server supplied a schema outside the supported MCP form vocabulary.
        Review and enter the response as a JSON object.
      </p>
      <a-textarea
        v-model:value="rawValue"
        :rows="4"
        placeholder='Enter JSON, for example {"value":"yes"}'
      />
    </template>

    <p
      v-if="isMcpElicitation && globalValidationError"
      class="elicitation-field-error"
      role="alert"
    >
      {{ globalValidationError }}
    </p>

    <a-checkbox-group
      v-else-if="questionOptions.length && isMultiSelect"
      v-model:value="selectedValues"
      class="question-options"
    >
      <a-checkbox
        v-for="option in questionOptions"
        :key="option.key"
        :value="option.value"
        class="question-option"
      >
        <span>{{ option.label }}</span>
        <small v-if="option.description">{{ option.description }}</small>
      </a-checkbox>
    </a-checkbox-group>

    <a-radio-group
      v-else-if="questionOptions.length"
      v-model:value="selectedValue"
      class="question-options"
    >
      <a-radio
        v-for="option in questionOptions"
        :key="option.key"
        :value="option.value"
        class="question-option"
      >
        <span>{{ option.label }}</span>
        <small v-if="option.description">{{ option.description }}</small>
      </a-radio>
    </a-radio-group>

    <a-textarea
      v-else
      v-model:value="textValue"
      :rows="3"
      placeholder="Type your answer"
    />

    <div class="elicitation-actions">
      <a-button @click="cancel">Cancel</a-button>
      <a-button type="primary" :disabled="!canSubmit" @click="accept">
        Submit
      </a-button>
    </div>
  </a-card>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  compileElicitationSchema,
  initialElicitationValues,
  prepareElicitationSubmission,
} from "../../../../packages/elicitation-schema/index.mjs";
import type { ElicitationIssue } from "../../../../packages/elicitation-schema";

const props = defineProps<{ request: any | null }>();
const emit = defineEmits<{
  accept: [answer: any];
  cancel: [];
}>();

const values = reactive<Record<string, any>>({});
const rawValue = ref("{}");
const textValue = ref("");
const selectedValue = ref<any>(undefined);
const selectedValues = ref<any[]>([]);
const validationErrors = ref<ElicitationIssue[]>([]);

const isMcpElicitation = computed(
  () => props.request?.payload?.metadata?.kind === "mcp_elicitation",
);
const panelTitle = computed(() =>
  isMcpElicitation.value ? "MCP input required" : "Agent needs your input",
);
const schema = computed(
  () =>
    props.request?.payload?.requestedSchema ||
    props.request?.payload?.metadata?.requestedSchema ||
    {},
);
const schemaModel = computed(() => compileElicitationSchema(schema.value));
const objectFields = computed(() => schemaModel.value.fields);
const globalValidationError = computed(
  () =>
    validationErrors.value.find(
      (error) => !error.path || !error.path.startsWith("/"),
    )?.message || "",
);
const serverName = computed(
  () => props.request?.payload?.metadata?.server || "MCP server",
);
const isMultiSelect = computed(
  () => props.request?.payload?.multiSelect === true,
);
const questionOptions = computed(() => {
  const rawOptions = Array.isArray(props.request?.payload?.options)
    ? props.request.payload.options
    : Array.isArray(props.request?.payload?.choices)
      ? props.request.payload.choices
      : [];

  return rawOptions.map((option: any, index: number) => {
    const isObject = option && typeof option === "object";
    const label = isObject
      ? String(
          option.label ?? option.name ?? option.value ?? `Option ${index + 1}`,
        )
      : String(option);
    const value = isObject ? (option.value ?? option.label ?? label) : option;
    return {
      key: `${index}:${label}`,
      label,
      value,
      description: isObject ? option.description || null : null,
    };
  });
});
const canSubmit = computed(() => {
  if (isMcpElicitation.value) {
    return true;
  }
  if (!questionOptions.value.length) {
    return true;
  }
  return isMultiSelect.value
    ? selectedValues.value.length > 0
    : selectedValue.value !== undefined;
});

watch(
  () =>
    props.request
      ? `${props.request.sessionId || ""}:${props.request.requestId || props.request.payload?.requestId || props.request.payload?.id || props.request.id}`
      : null,
  () => {
    Object.keys(values).forEach((key) => delete values[key]);
    const initialValues = initialElicitationValues(schemaModel.value);
    for (const [name, value] of Object.entries(initialValues)) {
      values[name] = value;
    }
    validationErrors.value = [];
    rawValue.value = "{}";
    const defaultAnswer =
      props.request?.payload?.defaultValue ??
      props.request?.payload?.default ??
      undefined;
    textValue.value = defaultAnswer === undefined ? "" : String(defaultAnswer);
    selectedValue.value = isMultiSelect.value ? undefined : defaultAnswer;
    selectedValues.value = isMultiSelect.value
      ? Array.isArray(defaultAnswer)
        ? [...defaultAnswer]
        : defaultAnswer === undefined
          ? []
          : [defaultAnswer]
      : [];
  },
  { immediate: true },
);

function accept() {
  if (isMcpElicitation.value) {
    if (schemaModel.value.supported) {
      const submission = prepareElicitationSubmission(
        schemaModel.value,
        values,
      );
      validationErrors.value = submission.errors;
      if (submission.valid) {
        emit("accept", submission.value);
      }
      return;
    }
    try {
      const parsed = JSON.parse(rawValue.value || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The response must be a JSON object");
      }
      validationErrors.value = [];
      emit("accept", parsed);
    } catch {
      validationErrors.value = [
        {
          path: "",
          code: "invalid_json",
          message: "Enter a valid JSON object before submitting.",
        },
      ];
    }
    return;
  }

  if (questionOptions.value.length) {
    emit(
      "accept",
      isMultiSelect.value ? [...selectedValues.value] : selectedValue.value,
    );
    return;
  }
  emit("accept", textValue.value);
}

function cancel() {
  emit("cancel");
}

function fieldError(name: string) {
  return (
    validationErrors.value.find((error) => error.path === `/${name}`)
      ?.message || ""
  );
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

.elicitation-field-description {
  margin: 0 0 6px;
  color: #6b7280;
  font-size: 12px;
}

.elicitation-field-error,
.elicitation-schema-warning {
  margin: 6px 0 0;
  color: #dc2626;
  font-size: 12px;
}

.elicitation-schema-warning {
  margin-bottom: 8px;
  color: #b45309;
}

.question-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.question-option {
  margin-inline-start: 0;
}

.question-option small {
  display: block;
  color: #6b7280;
  white-space: normal;
}

.elicitation-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
