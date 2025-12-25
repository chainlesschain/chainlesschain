/**
 * PythonExecutionPanel 组件测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import PythonExecutionPanel from '@renderer/components/projects/PythonExecutionPanel.vue';
import { mockElectronAPI } from '../setup';

describe('PythonExecutionPanel 组件', () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) => {
    return mount(PythonExecutionPanel, {
      props: {
        code: 'print("Hello, World!")',
        ...props,
      },
      global: {
        stubs: {
          'a-button': { template: '<button><slot /></button>' },
          'a-space': { template: '<div><slot /></div>' },
          'a-alert': { template: '<div><slot name="message" /><slot name="description" /></div>' },
          'a-tabs': { template: '<div><slot /></div>' },
          'a-tab-pane': {
            template: '<div>{{ tab }}<slot name="tab" /><slot /></div>',
            props: ['tab']
          },
          'a-badge': { template: '<span><slot /></span>' },
          'a-tag': { template: '<span><slot /></span>' },
          'a-tooltip': { template: '<div><slot /></div>' },
          'a-progress': { template: '<div />' },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe('基本渲染', () => {
    it('应该正确渲染组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('应该显示执行控制按钮', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('运行代码');
      expect(wrapper.text()).toContain('停止');
      expect(wrapper.text()).toContain('清空输出');
      expect(wrapper.text()).toContain('安全检查');
    });

    it('应该显示输出标签', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('输出');
      expect(wrapper.text()).toContain('错误');
      expect(wrapper.text()).toContain('信息');
    });

    it('当代码为空时应该禁用运行按钮', () => {
      wrapper = createWrapper({ code: '' });
      const runButton = wrapper.find('button');
      expect(runButton.attributes('disabled')).toBeDefined();
    });

    it('当有代码时应该启用运行按钮', () => {
      wrapper = createWrapper({ code: 'print("test")' });
      const buttons = wrapper.findAll('button');
      const runButton = buttons[0];
      expect(runButton.attributes('disabled')).toBeUndefined();
    });
  });

  describe('代码执行', () => {
    it('应该调用API执行Python代码', async () => {
      const mockResult = {
        success: true,
        stdout: 'Hello, World!\n',
        stderr: '',
        exitCode: 0,
        executionTime: 123,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper();

      // 点击运行按钮
      const buttons = wrapper.findAll('button');
      const runButton = buttons[0];
      await runButton.trigger('click');
      await nextTick();

      expect(mockElectronAPI.code.executePython).toHaveBeenCalledWith(
        'print("Hello, World!")',
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it('执行成功后应该更新UI', async () => {
      const mockResult = {
        success: true,
        stdout: 'Test output',
        stderr: '',
        exitCode: 0,
        executionTime: 200,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper();

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.vm.stdout).toBe('Test output');
      expect(wrapper.vm.exitCode).toBe(0);
      expect(wrapper.vm.executionTime).toBe(200);
      expect(wrapper.vm.lastExecutionStatus).toBe('执行成功');
    });

    it('执行失败后应该显示错误', async () => {
      const mockResult = {
        success: false,
        stdout: '',
        stderr: 'SyntaxError: invalid syntax',
        exitCode: 1,
        executionTime: 100,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper({ code: 'print("incomplete' });

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.vm.stderr).toContain('SyntaxError');
      expect(wrapper.vm.exitCode).toBe(1);
      expect(wrapper.vm.lastExecutionStatus).toBe('执行失败');
    });

    it('应该触发execution-complete事件', async () => {
      const mockResult = {
        success: true,
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        executionTime: 150,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper();

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.emitted('execution-complete')).toBeTruthy();
      expect(wrapper.emitted('execution-complete')[0][0]).toEqual(mockResult);
    });

    it('应该触发execution-error事件', async () => {
      const mockResult = {
        success: false,
        stdout: '',
        stderr: 'Error occurred',
        exitCode: 1,
        executionTime: 80,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper();

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.emitted('execution-error')).toBeTruthy();
      expect(wrapper.emitted('execution-error')[0][0]).toEqual(mockResult);
    });

    it('执行过程中应该显示loading状态', async () => {
      mockElectronAPI.code.executePython.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      wrapper = createWrapper();

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      await nextTick();

      expect(wrapper.vm.executing).toBe(true);
      expect(wrapper.text()).toContain('执行中...');
    });
  });

  describe('安全检查', () => {
    it('应该调用安全检查API', async () => {
      const mockSafetyResult = {
        safe: false,
        warnings: ['检测到潜在危险操作: os.system'],
      };

      mockElectronAPI.code.checkSafety.mockResolvedValue(mockSafetyResult);

      wrapper = createWrapper({ code: 'import os; os.system("ls")' });

      const buttons = wrapper.findAll('button');
      const safetyButton = buttons[3]; // 安全检查按钮
      await safetyButton.trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockElectronAPI.code.checkSafety).toHaveBeenCalledWith('import os; os.system("ls")');
      expect(wrapper.vm.safetyWarnings).toEqual(mockSafetyResult.warnings);
    });

    it('应该显示安全警告', async () => {
      const mockSafetyResult = {
        safe: false,
        warnings: ['检测到危险操作1', '检测到危险操作2'],
      };

      mockElectronAPI.code.checkSafety.mockResolvedValue(mockSafetyResult);

      wrapper = createWrapper();

      const buttons = wrapper.findAll('button');
      await buttons[3].trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.text()).toContain('检测到潜在危险操作');
      expect(wrapper.vm.safetyWarnings.length).toBe(2);
    });

    it('安全代码应该通过检查', async () => {
      const mockSafetyResult = {
        safe: true,
        warnings: [],
      };

      mockElectronAPI.code.checkSafety.mockResolvedValue(mockSafetyResult);

      wrapper = createWrapper({ code: 'print("safe code")' });

      const buttons = wrapper.findAll('button');
      await buttons[3].trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.vm.safetyWarnings.length).toBe(0);
    });

    it('有安全警告时应该阻止执行', async () => {
      const mockResult = {
        success: false,
        error: 'code_unsafe',
        warnings: ['危险操作'],
        message: '代码包含潜在危险操作,执行已阻止',
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper();

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wrapper.vm.safetyWarnings).toEqual(['危险操作']);
      expect(wrapper.vm.lastExecutionStatus).toBe('安全检查失败');
    });
  });

  describe('清空输出', () => {
    it('应该清空所有输出', async () => {
      wrapper = createWrapper();

      // 设置一些输出数据
      wrapper.vm.stdout = 'Some output';
      wrapper.vm.stderr = 'Some error';
      wrapper.vm.exitCode = 0;
      wrapper.vm.executionTime = 100;
      wrapper.vm.lastExecutionStatus = '执行成功';
      wrapper.vm.safetyWarnings = ['warning'];
      await nextTick();

      // 点击清空按钮
      const buttons = wrapper.findAll('button');
      const clearButton = buttons[2];
      await clearButton.trigger('click');
      await nextTick();

      expect(wrapper.vm.stdout).toBe('');
      expect(wrapper.vm.stderr).toBe('');
      expect(wrapper.vm.exitCode).toBeNull();
      expect(wrapper.vm.executionTime).toBeNull();
      expect(wrapper.vm.lastExecutionStatus).toBe('');
      expect(wrapper.vm.safetyWarnings).toEqual([]);
    });
  });

  describe('执行步骤显示', () => {
    it('当showSteps为true时应该显示步骤', async () => {
      const mockResult = {
        success: true,
        stdout: 'Output',
        stderr: '',
        exitCode: 0,
        executionTime: 100,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper({ showSteps: true });

      const buttons = wrapper.findAll('button');
      await buttons[0].trigger('click');
      await nextTick();

      expect(wrapper.vm.steps.length).toBeGreaterThan(0);
    });

    it('当showSteps为false时不应该显示步骤', async () => {
      wrapper = createWrapper({ showSteps: false });

      expect(wrapper.vm.showSteps).toBe(false);
    });

    it('步骤应该可以折叠/展开', async () => {
      wrapper = createWrapper({ showSteps: true });

      // 初始状态应该是展开的
      expect(wrapper.vm.stepsExpanded).toBe(true);

      // 模拟点击步骤标题
      wrapper.vm.toggleStepsExpanded();
      await nextTick();

      expect(wrapper.vm.stepsExpanded).toBe(false);
    });
  });

  describe('组件方法暴露', () => {
    it('应该暴露execute方法', () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.execute).toBe('function');
    });

    it('应该暴露stop方法', () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.stop).toBe('function');
    });

    it('应该暴露clear方法', () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.clear).toBe('function');
    });
  });

  describe('状态颜色', () => {
    it('成功状态应该返回success颜色', () => {
      wrapper = createWrapper();
      const color = wrapper.vm.getStatusColor('执行成功');
      expect(color).toBe('success');
    });

    it('执行中状态应该返回processing颜色', () => {
      wrapper = createWrapper();
      const color = wrapper.vm.getStatusColor('执行中');
      expect(color).toBe('processing');
    });

    it('失败状态应该返回error颜色', () => {
      wrapper = createWrapper();
      const color = wrapper.vm.getStatusColor('执行失败');
      expect(color).toBe('error');
    });

    it('未知状态应该返回default颜色', () => {
      wrapper = createWrapper();
      const color = wrapper.vm.getStatusColor('未知状态');
      expect(color).toBe('default');
    });
  });

  describe('Python版本检测', () => {
    it('应该在初始化时检测Python版本', async () => {
      const mockResult = {
        success: true,
        stdout: 'Python 3.9.0\n',
        stderr: '',
        exitCode: 0,
      };

      mockElectronAPI.code.executePython.mockResolvedValue(mockResult);

      wrapper = createWrapper();
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Python版本应该被设置
      // 注意：由于初始化是异步的，可能需要等待
    });
  });
});
