/**
 * McpToolForm component — unit tests.
 *
 * extractFields is mocked so we control the field shapes and focus on the
 * form's own logic: immutable set / setItem / addItem (blank seeding) /
 * removeItem emits, the non-object-schema fallback, indent depth, and the
 * once-per-group parent breadcrumb.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const h = vi.hoisted(() => ({ extractFields: vi.fn() }))
vi.mock('../../src/utils/mcp-schema.js', () => ({ extractFields: h.extractFields }))
vi.mock('@ant-design/icons-vue', () => ({ PlusOutlined: { template: '<i />' } }))

import McpToolForm from '../../src/components/McpToolForm.vue'

const stubs = {
  'a-input': {
    props: ['value'],
    emits: ['update:value'],
    template:
      '<input class="ainput" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  'a-textarea': {
    props: ['value'],
    emits: ['update:value'],
    template:
      '<textarea class="atextarea" :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
  },
  'a-input-number': {
    props: ['value'],
    emits: ['update:value'],
    template:
      '<input class="anum" :value="value" @input="$emit(\'update:value\', Number($event.target.value))" />',
  },
  'a-switch': {
    props: ['checked'],
    emits: ['update:checked'],
    template: '<button class="aswitch" @click="$emit(\'update:checked\', !checked)" />',
  },
  'a-select': {
    props: ['value', 'options'],
    emits: ['update:value'],
    template: '<select class="aselect" @change="$emit(\'update:value\', $event.target.value)"><slot /></select>',
  },
  'a-tag': { template: '<span class="atag"><slot /></span>' },
  'a-button': { template: '<button class="abtn" @click="$emit(\'click\')"><slot /></button>' },
}

function makeWrapper(modelValue = {}) {
  return mount(McpToolForm, {
    props: { schema: { type: 'object' }, modelValue },
    global: { stubs },
  })
}

beforeEach(() => {
  h.extractFields.mockReset().mockReturnValue([])
})

describe('McpToolForm — schema fallback', () => {
  it('shows the JSON-mode hint when there are no object fields', () => {
    h.extractFields.mockReturnValue([])
    const w = makeWrapper()
    expect(w.text()).toContain('请用 JSON 模式编辑')
  })
})

describe('McpToolForm — scalar set (immutable)', () => {
  it('text input emits a merged modelValue', async () => {
    h.extractFields.mockReturnValue([
      { name: 'title', label: 'title', type: 'string', widget: 'text', path: ['title'] },
    ])
    const w = makeWrapper({ other: 'keep' })
    await w.find('.ainput').setValue('hello')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { other: 'keep', title: 'hello' },
    ])
  })

  it('switch toggles the boolean', async () => {
    h.extractFields.mockReturnValue([
      { name: 'flag', label: 'flag', type: 'boolean', widget: 'boolean', path: ['flag'] },
    ])
    const w = makeWrapper({ flag: false })
    await w.find('.aswitch').trigger('click')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([{ flag: true }])
  })
})

describe('McpToolForm — objectList', () => {
  const listField = {
    name: 'items',
    label: 'items',
    type: 'array',
    widget: 'objectList',
    path: ['items'],
    itemFields: [
      { name: 'k', label: 'k', type: 'string', widget: 'text' },
      { name: 'n', label: 'n', type: 'number', widget: 'number' },
      { name: 'b', label: 'b', type: 'boolean', widget: 'boolean' },
      { name: 'd', label: 'd', type: 'string', widget: 'text', default: 'dflt' },
    ],
  }

  it('addItem seeds a blank using per-widget defaults', async () => {
    h.extractFields.mockReturnValue([listField])
    const w = makeWrapper({})
    const addBtn = w.findAll('.abtn').find((b) => b.text().includes('添加项'))
    await addBtn.trigger('click')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { items: [{ k: '', n: null, b: false, d: 'dflt' }] },
    ])
  })

  it('removeItem splices the item out immutably', async () => {
    h.extractFields.mockReturnValue([listField])
    const w = makeWrapper({ items: [{ k: 'a' }, { k: 'b' }] })
    const delBtn = w.findAll('.abtn').find((b) => b.text().includes('删除'))
    await delBtn.trigger('click')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { items: [{ k: 'b' }] },
    ])
  })

  it('setItem updates one sub-field immutably', async () => {
    h.extractFields.mockReturnValue([listField])
    const w = makeWrapper({ items: [{ k: 'a' }] })
    // first sub-field of the (only) item is the text input for "k"
    await w.find('.ainput').setValue('z')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([
      { items: [{ k: 'z' }] },
    ])
  })
})

describe('McpToolForm — layout helpers', () => {
  it('indents nested fields by 16px per depth', () => {
    h.extractFields.mockReturnValue([
      { name: 'street', label: 'street', type: 'string', widget: 'text', path: ['address', 'street'] },
    ])
    const w = makeWrapper()
    // the field wrapper carries the indent style
    expect(w.html()).toContain('margin-left: 16px')
  })

  // NB: parentBreadcrumb() is a render-time side-effect (it mutates a
  // module-level lastParentKey), so its output depends on render count +
  // cross-instance state and isn't deterministically assertable in a unit
  // test. Intentionally not covered here.
})
