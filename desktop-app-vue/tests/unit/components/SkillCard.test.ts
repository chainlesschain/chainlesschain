/**
 * SkillCard 组件单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SkillCard from '@renderer/components/skill/SkillCard.vue';

// Mock Ant Design Vue icons
vi.mock('@ant-design/icons-vue', () => ({
  EyeOutlined: { name: 'EyeOutlined', template: '<span>👁</span>' },
  FileTextOutlined: { name: 'FileTextOutlined', template: '<span>📄</span>' },
}));

// 全局组件stub配置
const globalStubs = {
  'a-button': {
    template: '<button v-bind="$attrs" @click="$attrs.onClick"><slot /></button>',
  },
  'a-switch': {
    template: '<input type="checkbox" v-bind="$attrs" @change="$attrs.onChange" />',
  },
  'a-tag': {
    template: '<span><slot /></span>',
  },
  'a-space': {
    template: '<div><slot /></div>',
  },
};

describe('SkillCard.vue', () => {
  const mockSkill = {
    id: 'skill_test_1',
    name: '测试技能',
    display_name: 'Test Skill',
    description: '这是一个测试技能',
    category: 'code',
    icon: 'code',
    enabled: 1,
    is_builtin: 1,
    tags: '["测试", "开发"]',
    usage_count: 10,
    success_count: 9,
  };

  it('应该正确渲染技能卡片', () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: mockSkill,
      },
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.find('.skill-card').exists()).toBe(true);
    expect(wrapper.find('.skill-name').text()).toBe('Test Skill');
    expect(wrapper.find('.description').text()).toBe('这是一个测试技能');
  });

  it('应该计算正确的成功率', () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: mockSkill,
      },
      global: {
        stubs: globalStubs,
      },
    });

    const successRate = wrapper.vm.successRate;
    expect(successRate).toBe('90.0'); // 9/10 = 90%
  });

  it('应该正确解析JSON标签', () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: mockSkill,
      },
      global: {
        stubs: globalStubs,
      },
    });

    const parsedTags = wrapper.vm.parsedTags;
    expect(parsedTags).toEqual(['测试', '开发']);
  });

  it('应该在禁用时添加disabled类', () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: { ...mockSkill, enabled: 0 },
      },
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.find('.skill-card').classes()).toContain('disabled');
  });

  it('应该触发view-details事件', async () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: mockSkill,
      },
      global: {
        stubs: globalStubs,
      },
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('view-details')).toBeTruthy();
    expect(wrapper.emitted('view-details')?.[0][0]).toEqual(mockSkill);
  });

  it('应该显示内置标签', () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: mockSkill,
      },
      global: {
        stubs: globalStubs,
      },
    });

    expect(wrapper.html()).toContain('内置');
  });

  it('应该根据分类显示正确的颜色', () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: mockSkill,
      },
      global: {
        stubs: globalStubs,
      },
    });

    const color = wrapper.vm.getCategoryColor('code');
    expect(color).toBe('blue');
  });
});
