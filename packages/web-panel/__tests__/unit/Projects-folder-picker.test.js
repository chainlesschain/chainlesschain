/**
 * Projects.vue — folder picker + cc init --cwd flow.
 *
 * Asserts:
 *  - "选择文件夹..." button calls fs.pickDirectory
 *  - Picking an empty folder (initialized:false) shows it as "待初始化"
 *    and the init button changes label to "在所选文件夹初始化"
 *  - Picking an already-initialized folder shows "已是项目" + disables init
 *    + surfaces the "无需重新初始化" alert
 *  - "清除" button restores the default state
 *  - initProject() with a selected folder emits `init … --cwd "<path>"`
 *    (quoted so paths with spaces survive ws.execute parsing)
 *  - initProject() without a selected folder still emits the bare `init …`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Projects from '../../src/views/Projects.vue'
import { useWsStore } from '../../src/stores/ws.js'

const pickDirectoryMock = vi.fn()
vi.mock('../../src/composables/useFs.js', () => ({
  useFs: () => ({ pickDirectory: pickDirectoryMock }),
}))

const STUBS = {
  'a-row': { template: '<div><slot /></div>' },
  'a-col': { template: '<div><slot /></div>' },
  'a-card': {
    props: ['title'],
    template: '<div class="stub-card"><slot name="title" /><slot name="extra" /><slot /></div>',
  },
  'a-statistic': {
    props: ['title', 'value'],
    template: '<div><span>{{ title }}</span>:<span>{{ value }}</span></div>',
  },
  'a-button': {
    props: ['type', 'loading', 'disabled', 'size'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot name="icon" /><slot /></button>',
  },
  'a-tag': {
    props: ['color'],
    template: '<span class="stub-tag" :data-color="color"><slot /></span>',
  },
  'a-alert': {
    props: ['type', 'message', 'description', 'showIcon', 'closable'],
    template:
      '<div class="stub-alert" :data-type="type"><strong>{{ message }}</strong><div>{{ description }}</div><slot name="description" /></div>',
    emits: ['close'],
  },
  'a-empty': { props: ['description'], template: '<div class="stub-empty">{{ description }}</div>' },
  'a-spin': { template: '<div class="stub-spin" />' },
  'a-descriptions': { props: ['column', 'bordered', 'size'], template: '<dl><slot /></dl>' },
  'a-descriptions-item': {
    props: ['label'],
    template: '<div><dt>{{ label }}</dt><dd><slot /></dd></div>',
  },
  ProjectOutlined: { template: '<span class="i-project" />' },
  RocketOutlined: { template: '<span class="i-rocket" />' },
  MedicineBoxOutlined: { template: '<span class="i-med" />' },
  ReloadOutlined: { template: '<span class="i-reload" />' },
  CheckCircleOutlined: { template: '<span class="i-check" />' },
  FolderOpenOutlined: { template: '<span class="i-folder" />' },
}

function findButtonByText(wrapper, text) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))
}

function makeFsMock(pickResult) {
  pickDirectoryMock.mockReset()
  pickDirectoryMock.mockResolvedValue(pickResult)
  return pickDirectoryMock
}

describe('Projects.vue · folder picker + cc init --cwd', () => {
  let executeMock

  beforeEach(() => {
    setActivePinia(createPinia())
    const ws = useWsStore()
    executeMock = vi.fn().mockResolvedValue({ output: '', exitCode: 0 })
    ws.execute = executeMock
  })

  it('renders the "选择文件夹..." button', () => {
    makeFsMock({ canceled: true, path: null, initialized: false })
    const wrapper = mount(Projects, { global: { stubs: STUBS } })
    expect(findButtonByText(wrapper, '选择文件夹')).toBeDefined()
  })

  it('picking an un-initialized folder switches the init button label', async () => {
    const pickDirectory = makeFsMock({
      canceled: false,
      path: '/work/new-project',
      initialized: false,
    })
    const wrapper = mount(Projects, { global: { stubs: STUBS } })
    // Click the picker
    await findButtonByText(wrapper, '选择文件夹').trigger('click')
    await flushPromises()
    expect(pickDirectory).toHaveBeenCalledOnce()

    expect(wrapper.text()).toContain('/work/new-project')
    expect(wrapper.text()).toContain('待初始化')
    expect(findButtonByText(wrapper, '在所选文件夹初始化')).toBeDefined()
  })

  it('picking an already-initialized folder disables init + shows alert', async () => {
    makeFsMock({
      canceled: false,
      path: '/work/existing-project',
      initialized: true,
    })
    const wrapper = mount(Projects, { global: { stubs: STUBS } })
    // Pre-pick a template so the init button isn't already disabled by that
    await wrapper.vm.$nextTick()
    wrapper.vm.selectedTemplate = 'empty'
    await wrapper.vm.$nextTick()

    await findButtonByText(wrapper, '选择文件夹').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已是项目')
    expect(wrapper.text()).toContain('该文件夹已是 ChainlessChain 项目')

    const initBtn = findButtonByText(wrapper, '在所选文件夹初始化')
    expect(initBtn?.element.disabled).toBe(true)
  })

  it('"清除" button restores the empty state', async () => {
    makeFsMock({
      canceled: false,
      path: '/work/foo',
      initialized: false,
    })
    const wrapper = mount(Projects, { global: { stubs: STUBS } })
    await findButtonByText(wrapper, '选择文件夹').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('/work/foo')

    await findButtonByText(wrapper, '清除').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('/work/foo')
    expect(findButtonByText(wrapper, '初始化（当前目录）')).toBeDefined()
  })

  it('initProject() emits init … --cwd "<path>" when a folder is selected', async () => {
    makeFsMock({
      canceled: false,
      path: '/work/has spaces/project',
      initialized: false,
    })
    const wrapper = mount(Projects, { global: { stubs: STUBS } })
    wrapper.vm.selectedTemplate = 'code-project'
    await flushPromises()

    await findButtonByText(wrapper, '选择文件夹').trigger('click')
    await flushPromises()
    await findButtonByText(wrapper, '在所选文件夹初始化').trigger('click')
    await flushPromises()

    expect(executeMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^init --template code-project --yes --cwd "\/work\/has spaces\/project"$/,
      ),
      30000,
    )
  })

  it('initProject() emits bare init when no folder is selected', async () => {
    makeFsMock({ canceled: true, path: null, initialized: false })
    const wrapper = mount(Projects, { global: { stubs: STUBS } })
    wrapper.vm.selectedTemplate = 'empty'
    await flushPromises()

    await findButtonByText(wrapper, '初始化（当前目录）').trigger('click')
    await flushPromises()

    expect(executeMock).toHaveBeenCalledWith(
      'init --template empty --yes',
      30000,
    )
  })
})
