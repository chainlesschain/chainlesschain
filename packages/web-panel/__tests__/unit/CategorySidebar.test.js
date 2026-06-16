/**
 * CategorySidebar (pdh) — unit tests: select emits, active/dim state, the
 * total + per-category badges, label rendering and active badge style.
 */

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('../../src/utils/pdhCategories.js', () => ({
  CATEGORIES: ['chat', 'shopping', 'other'],
  categoryLabel: (c) => ({ chat: '聊天', shopping: '购物', other: '其他' }[c] || c),
}))
vi.mock('@ant-design/icons-vue', () => {
  const I = { template: '<i />' }
  return {
    AppstoreOutlined: I,
    MessageOutlined: I,
    PlayCircleOutlined: I,
    MailOutlined: I,
    ShoppingOutlined: I,
    CarOutlined: I,
    MobileOutlined: I,
    RobotOutlined: I,
  }
})

import CategorySidebar from '../../src/components/pdh/CategorySidebar.vue'

const stubs = {
  'a-badge': {
    props: ['count', 'numberStyle'],
    template:
      '<span class="badge" :data-count="count" :data-style="JSON.stringify(numberStyle)"><slot /></span>',
  },
}

function render(props) {
  return mount(CategorySidebar, {
    props: { facets: { byCategory: {}, total: 0 }, selected: null, ...props },
    global: { stubs },
  })
}

const items = (w) => w.findAll('.cat-item')

describe('CategorySidebar — select emits', () => {
  it('emits select(null) for 全部 and select(cat) for a category', async () => {
    const w = render()
    await items(w)[0].trigger('click') // 全部
    expect(w.emitted('select')?.[0]).toEqual([null])
    await items(w)[1].trigger('click') // chat
    expect(w.emitted('select')?.at(-1)).toEqual(['chat'])
  })
})

describe('CategorySidebar — active + dim', () => {
  it('marks the selected item active', () => {
    expect(render({ selected: null }).find('.cat-item').classes()).toContain('active')
    const w = render({ selected: 'chat' })
    expect(items(w)[1].classes()).toContain('active')
  })

  it('dims categories that have no data', () => {
    const w = render({ facets: { byCategory: { chat: 3 }, total: 3 } })
    // chat has data → not dim; shopping has none → dim
    expect(items(w)[1].classes()).not.toContain('dim')
    expect(items(w)[2].classes()).toContain('dim')
  })
})

describe('CategorySidebar — badges + labels', () => {
  it('shows the total badge only when > 0', () => {
    expect(render({ facets: { byCategory: {}, total: 0 } }).find('.badge').exists()).toBe(false)
    const w = render({ facets: { byCategory: {}, total: 42 } })
    expect(w.find('.badge').attributes('data-count')).toBe('42')
  })

  it('shows a per-category badge with its count', () => {
    const w = render({ facets: { byCategory: { chat: 7 }, total: 7 } })
    const chatBadge = items(w)[1].find('.badge')
    expect(chatBadge.exists()).toBe(true)
    expect(chatBadge.attributes('data-count')).toBe('7')
  })

  it('renders the localized category label', () => {
    expect(items(render())[1].text()).toContain('聊天')
  })

  it('uses the active badge style on the selected category', () => {
    const w = render({ selected: 'chat', facets: { byCategory: { chat: 1 }, total: 1 } })
    const style = JSON.parse(items(w)[1].find('.badge').attributes('data-style'))
    expect(style).toEqual({ backgroundColor: '#fff', color: '#1677ff' })
  })
})
