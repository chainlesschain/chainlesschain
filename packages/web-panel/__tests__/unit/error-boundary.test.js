/**
 * ErrorBoundary component tests.
 *
 * The boundary wraps <router-view> in App.vue and catches any descendant
 * render / lifecycle / event-handler error via onErrorCaptured. We verify:
 *   1. children render normally when nothing throws
 *   2. a thrown error in a child triggers the fallback UI
 *   3. errorCaptured returns false (stops propagation to app-level handler)
 *   4. resetting `error` re-renders the slot (retry path)
 *   5. route change auto-resets the error (so users can navigate away)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'

vi.mock('ant-design-vue/es/locale/zh_CN', () => ({ default: { locale: 'zh_CN' } }))
vi.mock('ant-design-vue/es/locale/en_US', () => ({ default: { locale: 'en_US' } }))

import ErrorBoundary from '../../src/components/ErrorBoundary.vue'

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      error: { boundary: { title: '此页面渲染失败', retry: '重试', goHome: '返回仪表板', stack: '错误堆栈（仅开发模式可见）' } },
    },
  },
})

// Stub all ant-design-vue components used in the fallback UI to avoid
// pulling in async chunks (a-result, a-button, a-collapse, a-space).
const antStubs = {
  'a-result': {
    props: ['title', 'subTitle', 'status'],
    template:
      '<div class="a-result-stub" :data-status="status"><div class="a-result-title">{{title}}</div><div class="a-result-sub">{{subTitle}}</div><slot name="extra"/></div>',
  },
  'a-button': { template: '<button @click="$emit(\'click\')"><slot/></button>' },
  'a-space': { template: '<div><slot/></div>' },
  'a-collapse': { template: '<div><slot/></div>' },
  'a-collapse-panel': { template: '<div><slot/></div>' },
  'reload-outlined': true,
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>home</div>' } },
      { path: '/dashboard', component: { template: '<div>dashboard</div>' } },
      { path: '/other', component: { template: '<div>other</div>' } },
    ],
  })
}

describe('ErrorBoundary', () => {
  let router

  beforeEach(async () => {
    router = makeRouter()
    await router.push('/')
    await router.isReady()
  })

  it('renders the slot content when no error is thrown', async () => {
    const wrapper = mount(ErrorBoundary, {
      global: { plugins: [router, i18n], stubs: antStubs },
      slots: { default: '<p class="ok">child rendered</p>' },
    })
    await flushPromises()
    expect(wrapper.find('.ok').exists()).toBe(true)
    expect(wrapper.find('.a-result-stub').exists()).toBe(false)
  })

  it('shows the fallback UI when a descendant throws on mount', async () => {
    const Boom = defineComponent({
      setup() {
        throw new Error('boom from child')
      },
      template: '<div>never reached</div>',
    })
    // Silence the expected Vue warn the throw produces.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(ErrorBoundary, {
      global: { plugins: [router, i18n], stubs: antStubs },
      slots: { default: () => h(Boom) },
    })
    await flushPromises()

    expect(wrapper.find('.a-result-stub').exists()).toBe(true)
    expect(wrapper.find('.a-result-stub').attributes('data-status')).toBe('error')
    expect(wrapper.find('.a-result-title').text()).toBe('此页面渲染失败')
    expect(wrapper.find('.a-result-sub').text()).toContain('boom from child')

    errSpy.mockRestore()
  })

  it('stops propagation by returning false from errorCaptured', async () => {
    // If errorCaptured returned true (or undefined), the error would
    // bubble to the test runner's parent app-level handler. We verify by
    // mounting under a parent that also has its own onErrorCaptured spy.
    const parentSpy = vi.fn(() => false)
    const Boom = defineComponent({
      setup() { throw new Error('escape attempt') },
      template: '<div/>',
    })
    const Parent = defineComponent({
      components: { ErrorBoundary, Boom },
      template: '<ErrorBoundary><Boom/></ErrorBoundary>',
      errorCaptured: parentSpy,
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mount(Parent, { global: { plugins: [router, i18n], stubs: antStubs } })
    await flushPromises()

    expect(parentSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('resets the error and re-renders slot when route changes', async () => {
    // Module-scoped flag the child reads on each setup invocation.
    // Flipping it lets us verify the boundary recovers post-navigation
    // rather than capturing the same error all over again.
    const shouldBoom = ref(true)
    const Recoverable = defineComponent({
      setup() {
        if (shouldBoom.value) throw new Error('initial render boom')
      },
      template: '<div class="ok-after">recovered</div>',
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(ErrorBoundary, {
      global: { plugins: [router, i18n], stubs: antStubs },
      slots: { default: () => h(Recoverable) },
    })
    await flushPromises()
    expect(wrapper.find('.a-result-stub').exists()).toBe(true)

    // Stop the child throwing, then navigate. The watch on route.fullPath
    // should null out the error, the v-else slot path becomes active,
    // and Recoverable now renders successfully.
    shouldBoom.value = false
    await router.push('/other')
    await flushPromises()

    expect(wrapper.find('.a-result-stub').exists()).toBe(false)
    expect(wrapper.find('.ok-after').exists()).toBe(true)

    errSpy.mockRestore()
  })
})
