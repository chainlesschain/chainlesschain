<template>
  <div v-if="!fields.length" style="color: var(--text-muted); font-size: 12px; padding: 8px 0;">
    此工具的 inputSchema 不是 type:object — 请用 JSON 模式编辑。
  </div>
  <div v-else style="display: flex; flex-direction: column; gap: 14px;">
    <div v-for="f in fields" :key="f.name">
      <div style="margin-bottom: 4px;">
        <span style="font-family: monospace; font-size: 12px;">{{ f.label }}</span>
        <span v-if="f.required" style="color: #ff4d4f; margin-left: 4px;">*</span>
        <a-tag size="small" style="margin-left: 8px; font-size: 10px;">
          {{ f.type }}{{ f.itemsType ? `<${f.itemsType}>` : '' }}
        </a-tag>
      </div>
      <div v-if="f.description" style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">
        {{ f.description }}
      </div>

      <a-input
        v-if="f.widget === 'text'"
        :value="modelValue[f.name] ?? ''"
        :placeholder="f.default !== undefined ? `默认 ${f.default}` : ''"
        size="small"
        @update:value="(v) => set(f.name, v)"
      />

      <a-textarea
        v-else-if="f.widget === 'textarea'"
        :value="modelValue[f.name] ?? ''"
        :rows="4"
        :placeholder="f.default !== undefined ? `默认 ${f.default}` : ''"
        @update:value="(v) => set(f.name, v)"
      />

      <a-input-number
        v-else-if="f.widget === 'number'"
        :value="modelValue[f.name]"
        size="small"
        :placeholder="f.default !== undefined ? `默认 ${f.default}` : ''"
        style="width: 100%;"
        @update:value="(v) => set(f.name, v)"
      />

      <a-switch
        v-else-if="f.widget === 'boolean'"
        :checked="!!modelValue[f.name]"
        @update:checked="(v) => set(f.name, v)"
      />

      <a-select
        v-else-if="f.widget === 'select'"
        :value="modelValue[f.name] ?? undefined"
        :options="(f.enum || []).map(v => ({ label: String(v), value: v }))"
        size="small"
        style="width: 100%;"
        :placeholder="f.default !== undefined ? `默认 ${f.default}` : '请选择'"
        @update:value="(v) => set(f.name, v)"
      />

      <a-select
        v-else-if="f.widget === 'tags'"
        :value="Array.isArray(modelValue[f.name]) ? modelValue[f.name] : []"
        mode="tags"
        size="small"
        style="width: 100%;"
        placeholder="输入后回车添加"
        :token-separators="[',', '\n']"
        @update:value="(v) => set(f.name, v)"
      />

      <a-textarea
        v-else
        :value="modelValue[f.name] ?? ''"
        :rows="3"
        placeholder='复杂类型 — 请输入 JSON，如 {"key":"value"}'
        style="font-family: monospace; font-size: 12px;"
        @update:value="(v) => set(f.name, v)"
      />

      <div v-if="errors[f.name]" style="color: #ff4d4f; font-size: 11px; margin-top: 4px;">
        {{ errors[f.name] }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { extractFields } from '../utils/mcp-schema.js'

const props = defineProps({
  schema: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) },
  errors: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:modelValue'])

const fields = computed(() => extractFields(props.schema))

function set(name, value) {
  emit('update:modelValue', { ...props.modelValue, [name]: value })
}

defineExpose({ fields })
</script>
