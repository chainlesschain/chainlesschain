<template>
  <div v-if="!fields.length" style="color: var(--text-muted); font-size: 12px; padding: 8px 0;">
    此工具的 inputSchema 不是 type:object — 请用 JSON 模式编辑。
  </div>
  <div v-else style="display: flex; flex-direction: column; gap: 14px;">
    <template v-for="f in fields" :key="f.name">
      <!-- Nested-leaf indent: 16px per parent path component -->
      <div :style="indentStyle(f)">
        <!-- Group breadcrumb shown ONCE per parent group transition so the
             user can tell "address.street" + "address.city" are siblings.
             The previous-field tracker is computed inline. -->
        <div
          v-if="parentBreadcrumb(f) !== ''"
          style="color: var(--text-muted); font-size: 10px; font-family: monospace; margin-bottom: 4px;"
        >
          {{ parentBreadcrumb(f) }}
        </div>
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
          :options="(f.enum || []).map(opt => ({ label: String(opt), value: opt }))"
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

        <!-- objectList: render each item as a sub-form panel with remove + add. -->
        <div v-else-if="f.widget === 'objectList'">
          <div
            v-for="(item, idx) in (Array.isArray(modelValue[f.name]) ? modelValue[f.name] : [])"
            :key="idx"
            style="border: 1px dashed var(--border-color); padding: 10px; border-radius: 4px; margin-bottom: 8px; background: var(--bg-card-hover);"
          >
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="color: var(--text-muted); font-size: 11px;">#{{ idx + 1 }}</span>
              <a-button size="small" type="link" danger @click="removeItem(f.name, idx)">
                删除
              </a-button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <div v-for="sub in (f.itemFields || [])" :key="sub.name" style="display: flex; flex-direction: column; gap: 4px;">
                <div>
                  <span style="font-family: monospace; font-size: 11px;">{{ sub.label }}</span>
                  <span v-if="sub.required" style="color: #ff4d4f; margin-left: 4px;">*</span>
                  <a-tag size="small" style="margin-left: 6px; font-size: 10px;">{{ sub.type }}</a-tag>
                </div>
                <a-input
                  v-if="sub.widget === 'text'"
                  :value="item[sub.name] ?? ''"
                  size="small"
                  @update:value="(v) => setItem(f.name, idx, sub.name, v)"
                />
                <a-input-number
                  v-else-if="sub.widget === 'number'"
                  :value="item[sub.name]"
                  size="small"
                  style="width: 100%;"
                  @update:value="(v) => setItem(f.name, idx, sub.name, v)"
                />
                <a-switch
                  v-else-if="sub.widget === 'boolean'"
                  :checked="!!item[sub.name]"
                  @update:checked="(v) => setItem(f.name, idx, sub.name, v)"
                />
                <a-select
                  v-else-if="sub.widget === 'select'"
                  :value="item[sub.name] ?? undefined"
                  :options="(sub.enum || []).map(opt => ({ label: String(opt), value: opt }))"
                  size="small"
                  style="width: 100%;"
                  @update:value="(v) => setItem(f.name, idx, sub.name, v)"
                />
                <a-textarea
                  v-else
                  :value="typeof item[sub.name] === 'string' ? item[sub.name] : ''"
                  :rows="2"
                  placeholder="复杂子字段 — 请用 JSON 模式"
                  style="font-family: monospace; font-size: 11px;"
                  @update:value="(v) => setItem(f.name, idx, sub.name, v)"
                />
                <div v-if="errors[`${f.name}[${idx}].${sub.name}`]" style="color: #ff4d4f; font-size: 11px;">
                  {{ errors[`${f.name}[${idx}].${sub.name}`] }}
                </div>
              </div>
            </div>
          </div>
          <a-button size="small" type="dashed" block @click="addItem(f)">
            <template #icon><PlusOutlined /></template>
            添加项
          </a-button>
        </div>

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
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import { extractFields } from '../utils/mcp-schema.js'

const props = defineProps({
  schema: { type: Object, default: null },
  modelValue: { type: Object, default: () => ({}) },
  errors: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:modelValue'])

const fields = computed(() => extractFields(props.schema))

function indentStyle(field) {
  const depth = Math.max(0, (field.path?.length ?? 1) - 1)
  return depth > 0 ? `margin-left: ${depth * 16}px;` : ''
}

// Small state to track whether to render the parent breadcrumb. The
// breadcrumb shows ONCE per group — when the immediate-parent path
// changes from the previous field, we emit it. For top-level fields
// (path.length === 1) we never emit.
let lastParentKey = null
function parentBreadcrumb(field) {
  const path = field.path || [field.name]
  if (path.length <= 1) {
    lastParentKey = null
    return ''
  }
  const parentKey = path.slice(0, -1).join('.')
  if (parentKey === lastParentKey) {
    return ''
  }
  lastParentKey = parentKey
  return parentKey
}

function set(name, value) {
  emit('update:modelValue', { ...props.modelValue, [name]: value })
}

function setItem(listName, idx, subName, value) {
  const list = Array.isArray(props.modelValue[listName])
    ? props.modelValue[listName].slice()
    : []
  list[idx] = { ...(list[idx] || {}), [subName]: value }
  emit('update:modelValue', { ...props.modelValue, [listName]: list })
}

function addItem(field) {
  const list = Array.isArray(props.modelValue[field.name])
    ? props.modelValue[field.name].slice()
    : []
  // Seed a blank item using the per-sub default rules.
  const blank = {}
  for (const sub of field.itemFields || []) {
    if (sub.default !== undefined) blank[sub.name] = sub.default
    else if (sub.widget === 'boolean') blank[sub.name] = false
    else if (sub.widget === 'number') blank[sub.name] = null
    else blank[sub.name] = ''
  }
  list.push(blank)
  emit('update:modelValue', { ...props.modelValue, [field.name]: list })
}

function removeItem(listName, idx) {
  const list = Array.isArray(props.modelValue[listName])
    ? props.modelValue[listName].slice()
    : []
  list.splice(idx, 1)
  emit('update:modelValue', { ...props.modelValue, [listName]: list })
}

defineExpose({ fields })
</script>
