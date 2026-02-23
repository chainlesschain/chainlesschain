<template>
  <div class="goal-submission-form">
    <a-form
      layout="vertical"
      :model="formState"
      @finish="handleSubmit"
    >
      <!-- Description -->
      <a-form-item
        label="Goal Description"
        name="description"
        :rules="[{ required: true, message: 'Please describe the goal' }]"
      >
        <a-textarea
          v-model:value="formState.description"
          placeholder="Describe what you want the AI agent to accomplish autonomously. Be specific about the desired outcome..."
          :rows="3"
          :maxlength="2000"
          show-count
          :disabled="loading"
        />
      </a-form-item>

      <a-row :gutter="16">
        <!-- Priority -->
        <a-col :xs="24" :sm="8">
          <a-form-item label="Priority" name="priority">
            <a-select
              v-model:value="formState.priority"
              placeholder="Select priority"
              :disabled="loading"
            >
              <a-select-option :value="1">1 - Critical</a-select-option>
              <a-select-option :value="2">2 - Very High</a-select-option>
              <a-select-option :value="3">3 - High</a-select-option>
              <a-select-option :value="4">4 - Above Normal</a-select-option>
              <a-select-option :value="5">5 - Normal</a-select-option>
              <a-select-option :value="6">6 - Below Normal</a-select-option>
              <a-select-option :value="7">7 - Low</a-select-option>
              <a-select-option :value="8">8 - Very Low</a-select-option>
              <a-select-option :value="9">9 - Minimal</a-select-option>
              <a-select-option :value="10">10 - Background</a-select-option>
            </a-select>
          </a-form-item>
        </a-col>

        <!-- Tool Permissions -->
        <a-col :xs="24" :sm="16">
          <a-form-item label="Tool Permissions" name="toolPermissions">
            <a-checkbox-group
              v-model:value="formState.toolPermissions"
              :options="permissionOptions"
              :disabled="loading"
            />
          </a-form-item>
        </a-col>
      </a-row>

      <!-- Context -->
      <a-form-item label="Additional Context (optional)" name="context">
        <a-textarea
          v-model:value="formState.context"
          placeholder="Provide any additional context, constraints, or preferences for the agent..."
          :rows="2"
          :maxlength="1000"
          show-count
          :disabled="loading"
        />
      </a-form-item>

      <!-- Submit -->
      <a-form-item>
        <a-space>
          <a-button
            type="primary"
            html-type="submit"
            :loading="loading"
            :disabled="!formState.description?.trim()"
          >
            <RocketOutlined />
            Submit Goal
          </a-button>
          <a-button @click="handleReset" :disabled="loading">
            Reset
          </a-button>
        </a-space>
      </a-form-item>
    </a-form>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { RocketOutlined } from '@ant-design/icons-vue';

interface FormState {
  description: string;
  priority: number;
  toolPermissions: string[];
  context: string;
}

const props = defineProps<{
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'submit', goalSpec: {
    description: string;
    priority: number;
    toolPermissions: string[];
    context: string;
  }): void;
}>();

const permissionOptions = [
  { label: 'Skills', value: 'skills' },
  { label: 'File Operations', value: 'file-ops' },
  { label: 'Browser', value: 'browser' },
  { label: 'Network', value: 'network' },
];

const formState = reactive<FormState>({
  description: '',
  priority: 5,
  toolPermissions: ['skills', 'file-ops'],
  context: '',
});

function handleSubmit() {
  if (!formState.description?.trim()) {
    return;
  }

  emit('submit', {
    description: formState.description.trim(),
    priority: formState.priority,
    toolPermissions: formState.toolPermissions,
    context: formState.context.trim(),
  });

  // Reset form after submission
  handleReset();
}

function handleReset() {
  formState.description = '';
  formState.priority = 5;
  formState.toolPermissions = ['skills', 'file-ops'];
  formState.context = '';
}
</script>

<style scoped>
.goal-submission-form {
  width: 100%;
}

.goal-submission-form :deep(.ant-checkbox-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.goal-submission-form :deep(.ant-checkbox-wrapper) {
  margin-left: 0;
}
</style>
