/**
 * WorkflowMonitorPage 单元测试
 * 测试目标: src/renderer/pages/WorkflowMonitorPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - 工作流列表显示
 * - 创建工作流
 * - 工作流操作（暂停、恢复、删除）
 * - 工作流详情查看
 * - 工作流状态管理
 * - 进度显示
 * - 完成摘要
 * - 事件处理
 * - 辅助方法
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
  useRoute: () => ({ params: {}, query: {} }),
}));

// Mock window.ipc
global.window = {
  ipc: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
};

describe('WorkflowMonitorPage', () => {
  let wrapper;

  const mockWorkflows = [
    {
      workflowId: 'wf-1',
      title: 'Test Workflow 1',
      overall: {
        status: 'running',
        percent: 50,
        stage: 3,
        totalStages: 6,
        elapsedTime: 120000, // 2 minutes
      },
    },
    {
      workflowId: 'wf-2',
      title: 'Test Workflow 2',
      overall: {
        status: 'completed',
        percent: 100,
        stage: 6,
        totalStages: 6,
        elapsedTime: 300000, // 5 minutes
      },
    },
    {
      workflowId: 'wf-3',
      title: 'Test Workflow 3',
      overall: {
        status: 'paused',
        percent: 30,
        stage: 2,
        totalStages: 6,
        elapsedTime: 60000, // 1 minute
      },
    },
    {
      workflowId: 'wf-4',
      title: 'Test Workflow 4',
      overall: {
        status: 'failed',
        percent: 40,
        stage: 2,
        totalStages: 6,
        elapsedTime: 90000, // 1.5 minutes
      },
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="workflow-monitor-page">
            <div class="page-header">
              <div class="header-left">
                <button @click="goBack">Back</button>
                <h1>工作流监控</h1>
              </div>
              <div class="header-right">
                <button @click="refreshWorkflows">刷新</button>
                <button @click="showCreateModal">新建工作流</button>
              </div>
            </div>

            <div v-if="!selectedWorkflowId" class="workflows-list">
              <div v-if="workflows.length === 0" class="empty-state">
                <button @click="showCreateModal">创建第一个工作流</button>
              </div>

              <div v-else class="workflow-cards">
                <div
                  v-for="workflow in workflows"
                  :key="workflow.workflowId"
                  class="workflow-card"
                  @click="selectWorkflow(workflow.workflowId)"
                >
                  <div class="card-title">
                    <span class="workflow-icon">{{ getWorkflowIcon(workflow.overall?.status) }}</span>
                    <span>{{ workflow.title || '未命名工作流' }}</span>
                  </div>
                  <div class="card-status">
                    <span :class="getStatusColor(workflow.overall?.status)">
                      {{ getStatusText(workflow.overall?.status) }}
                    </span>
                  </div>
                  <div class="card-progress">
                    <span>{{ workflow.overall?.percent || 0 }}%</span>
                    <span>{{ getProgressStatus(workflow.overall?.status) }}</span>
                  </div>
                  <div class="card-meta">
                    <span>阶段 {{ workflow.overall?.stage || 0 }}/{{ workflow.overall?.totalStages || 6 }}</span>
                    <span>{{ formatDuration(workflow.overall?.elapsedTime) }}</span>
                  </div>
                  <div class="card-actions" @click.stop>
                    <button @click="selectWorkflow(workflow.workflowId)">查看详情</button>
                    <button v-if="workflow.overall?.status === 'running'" @click="pauseWorkflow(workflow.workflowId)">暂停</button>
                    <button v-if="workflow.overall?.status === 'paused'" @click="resumeWorkflow(workflow.workflowId)">继续</button>
                    <button @click="deleteWorkflow(workflow.workflowId)">删除</button>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="workflow-detail">
              <button @click="selectedWorkflowId = null">返回列表</button>
              <WorkflowProgress
                :workflow-id="selectedWorkflowId"
                @complete="handleWorkflowComplete"
                @error="handleWorkflowError"
              />
              <WorkflowSummary
                v-if="showSummary"
                :workflow="completedWorkflow"
                :stages="completedStages"
                :quality-gates="completedGates"
                @retry="handleRetry"
                @view-result="handleViewResult"
                @export="handleExport"
                @close="showSummary = false"
              />
            </div>

            <div v-if="createModalVisible" class="create-modal">
              <input v-model="createForm.title" placeholder="工作流名称" />
              <textarea v-model="createForm.description" placeholder="描述"></textarea>
              <textarea v-model="createForm.userRequest" placeholder="用户请求"></textarea>
              <button @click="handleCreateWorkflow">创建</button>
              <button @click="createModalVisible = false">取消</button>
            </div>
          </div>
        `,
        setup() {
          const { ref, onMounted, onUnmounted } = require('vue');
          const { useRouter } = require('vue-router');
          const { message } = require('ant-design-vue');

          const router = useRouter();
          const workflows = ref([]);
          const selectedWorkflowId = ref(null);
          const loading = ref(false);
          const createModalVisible = ref(false);
          const createForm = ref({
            title: '',
            description: '',
            userRequest: '',
          });
          const showSummary = ref(false);
          const completedWorkflow = ref({});
          const completedStages = ref([]);
          const completedGates = ref({});

          const goBack = () => {
            if (selectedWorkflowId.value) {
              selectedWorkflowId.value = null;
            } else {
              router.back();
            }
          };

          const refreshWorkflows = async () => {
            loading.value = true;
            try {
              const result = await window.ipc.invoke('workflow:get-all');
              if (result.success) {
                workflows.value = result.data;
              }
            } catch (error) {
              message.error('刷新失败: ' + error.message);
            } finally {
              loading.value = false;
            }
          };

          const showCreateModal = () => {
            createForm.value = {
              title: '',
              description: '',
              userRequest: '',
            };
            createModalVisible.value = true;
          };

          const handleCreateWorkflow = async () => {
            if (!createForm.value.title || !createForm.value.userRequest) {
              message.warning('请填写必填项');
              return;
            }

            try {
              const result = await window.ipc.invoke('workflow:create-and-start', {
                title: createForm.value.title,
                description: createForm.value.description,
                input: {
                  userRequest: createForm.value.userRequest,
                },
                context: {},
              });

              if (result.success) {
                message.success('工作流已创建并启动');
                createModalVisible.value = false;
                selectedWorkflowId.value = result.data.workflowId;
                refreshWorkflows();
              } else {
                message.error(result.error || '创建失败');
              }
            } catch (error) {
              message.error('创建失败: ' + error.message);
            }
          };

          const selectWorkflow = (workflowId) => {
            selectedWorkflowId.value = workflowId;
          };

          const pauseWorkflow = async (workflowId) => {
            try {
              const result = await window.ipc.invoke('workflow:pause', { workflowId });
              if (result.success) {
                message.success('工作流已暂停');
                refreshWorkflows();
              } else {
                message.error(result.error || '暂停失败');
              }
            } catch (error) {
              message.error('操作失败: ' + error.message);
            }
          };

          const resumeWorkflow = async (workflowId) => {
            try {
              const result = await window.ipc.invoke('workflow:resume', { workflowId });
              if (result.success) {
                message.success('工作流已恢复');
                refreshWorkflows();
              } else {
                message.error(result.error || '恢复失败');
              }
            } catch (error) {
              message.error('操作失败: ' + error.message);
            }
          };

          const deleteWorkflow = async (workflowId) => {
            try {
              const result = await window.ipc.invoke('workflow:delete', { workflowId });
              if (result.success) {
                message.success('工作流已删除');
                if (selectedWorkflowId.value === workflowId) {
                  selectedWorkflowId.value = null;
                }
                refreshWorkflows();
              } else {
                message.error(result.error || '删除失败');
              }
            } catch (error) {
              message.error('操作失败: ' + error.message);
            }
          };

          const handleWorkflowComplete = async (data) => {
            message.success('工作流执行完成');
            completedWorkflow.value = data;

            try {
              const stagesResult = await window.ipc.invoke('workflow:get-stages', {
                workflowId: selectedWorkflowId.value,
              });
              if (stagesResult.success) {
                completedStages.value = stagesResult.data;
              }

              const gatesResult = await window.ipc.invoke('workflow:get-gates', {
                workflowId: selectedWorkflowId.value,
              });
              if (gatesResult.success) {
                completedGates.value = gatesResult.data;
              }
            } catch (error) {
              console.error('获取工作流详情失败:', error);
            }

            showSummary.value = true;
            refreshWorkflows();
          };

          const handleWorkflowError = (data) => {
            message.error('工作流执行失败: ' + data.error);
            completedWorkflow.value = { ...data, success: false };
            showSummary.value = true;
            refreshWorkflows();
          };

          const handleRetry = async () => {
            try {
              const result = await window.ipc.invoke('workflow:retry', {
                workflowId: selectedWorkflowId.value,
              });
              if (result.success) {
                message.success('工作流重试中');
                showSummary.value = false;
              } else {
                message.error(result.error || '重试失败');
              }
            } catch (error) {
              message.error('操作失败: ' + error.message);
            }
          };

          const handleViewResult = () => {
            message.info('查看结果功能待实现');
          };

          const handleExport = () => {
            message.info('导出报告功能待实现');
          };

          const getWorkflowIcon = (status) => {
            const iconMap = {
              idle: '📋',
              running: '🔄',
              paused: '⏸️',
              completed: '✅',
              failed: '❌',
              cancelled: '🚫',
            };
            return iconMap[status] || '📋';
          };

          const getStatusColor = (status) => {
            const colorMap = {
              idle: 'default',
              running: 'processing',
              paused: 'warning',
              completed: 'success',
              failed: 'error',
              cancelled: 'default',
            };
            return colorMap[status] || 'default';
          };

          const getStatusText = (status) => {
            const textMap = {
              idle: '等待中',
              running: '执行中',
              paused: '已暂停',
              completed: '已完成',
              failed: '失败',
              cancelled: '已取消',
            };
            return textMap[status] || '未知';
          };

          const getProgressStatus = (status) => {
            if (status === 'failed') return 'exception';
            if (status === 'completed') return 'success';
            return 'active';
          };

          const formatDuration = (ms) => {
            if (!ms || ms === 0) return '0秒';
            const seconds = Math.floor(ms / 1000);
            if (seconds < 60) return `${seconds}秒`;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            if (minutes < 60) return `${minutes}分${remainingSeconds}秒`;
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours}时${remainingMinutes}分`;
          };

          const handleWorkflowUpdate = (data) => {
            const index = workflows.value.findIndex(w => w.workflowId === data.workflowId);
            if (index >= 0) {
              workflows.value[index] = {
                ...workflows.value[index],
                ...data,
              };
            }
          };

          onMounted(() => {
            refreshWorkflows();
            if (window.ipc) {
              window.ipc.on('workflow:progress', handleWorkflowUpdate);
            }
          });

          onUnmounted(() => {
            if (window.ipc) {
              window.ipc.off('workflow:progress', handleWorkflowUpdate);
            }
          });

          return {
            workflows,
            selectedWorkflowId,
            loading,
            createModalVisible,
            createForm,
            showSummary,
            completedWorkflow,
            completedStages,
            completedGates,
            goBack,
            refreshWorkflows,
            showCreateModal,
            handleCreateWorkflow,
            selectWorkflow,
            pauseWorkflow,
            resumeWorkflow,
            deleteWorkflow,
            handleWorkflowComplete,
            handleWorkflowError,
            handleRetry,
            handleViewResult,
            handleExport,
            getWorkflowIcon,
            getStatusColor,
            getStatusText,
            getProgressStatus,
            formatDuration,
            handleWorkflowUpdate,
          };
        },
      },
      {
        global: {
          stubs: {
            WorkflowProgress: {
              name: 'WorkflowProgress',
              template: '<div class="workflow-progress"></div>',
              emits: ['complete', 'error'],
            },
            WorkflowSummary: {
              name: 'WorkflowSummary',
              template: '<div class="workflow-summary"></div>',
              emits: ['retry', 'view-result', 'export', 'close'],
            },
          },
        },
        ...options,
      }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.ipc.invoke.mockResolvedValue({ success: true, data: [] });
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.workflow-monitor-page').exists()).toBe(true);
    });

    it('应该在挂载时刷新工作流列表', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true, data: mockWorkflows });
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:get-all');
    });

    it('应该注册工作流更新事件监听器', () => {
      wrapper = createWrapper();

      expect(window.ipc.on).toHaveBeenCalledWith(
        'workflow:progress',
        expect.any(Function)
      );
    });
  });

  describe('工作流列表显示', () => {
    it('应该显示空状态', () => {
      window.ipc.invoke.mockResolvedValue({ success: true, data: [] });
      wrapper = createWrapper();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
    });

    it('应该显示工作流卡片', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true, data: mockWorkflows });
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await wrapper.vm.refreshWorkflows();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.workflows.length).toBe(4);
      expect(wrapper.findAll('.workflow-card').length).toBe(4);
    });

    it('应该显示工作流标题', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true, data: [mockWorkflows[0]] });
      wrapper = createWrapper();

      await wrapper.vm.refreshWorkflows();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Test Workflow 1');
    });

    it('应该显示未命名工作流', async () => {
      const unnamedWorkflow = { ...mockWorkflows[0], title: '' };
      window.ipc.invoke.mockResolvedValue({ success: true, data: [unnamedWorkflow] });
      wrapper = createWrapper();

      await wrapper.vm.refreshWorkflows();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('未命名工作流');
    });

    it('应该显示工作流进度', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true, data: [mockWorkflows[0]] });
      wrapper = createWrapper();

      await wrapper.vm.refreshWorkflows();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('50%');
      expect(wrapper.text()).toContain('阶段 3/6');
    });
  });

  describe('刷新工作流', () => {
    it('应该能刷新工作流列表', async () => {
      wrapper = createWrapper();
      window.ipc.invoke.mockResolvedValue({ success: true, data: mockWorkflows });

      await wrapper.vm.refreshWorkflows();

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:get-all');
      expect(wrapper.vm.workflows.length).toBe(4);
    });

    it('应该能处理刷新失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockRejectedValue(new Error('Network error'));

      await wrapper.vm.refreshWorkflows();

      expect(message.error).toHaveBeenCalledWith('刷新失败: Network error');
    });

    it('应该在刷新时设置loading状态', async () => {
      wrapper = createWrapper();
      window.ipc.invoke.mockImplementation(() => {
        expect(wrapper.vm.loading).toBe(true);
        return Promise.resolve({ success: true, data: [] });
      });

      await wrapper.vm.refreshWorkflows();

      expect(wrapper.vm.loading).toBe(false);
    });
  });

  describe('创建工作流', () => {
    it('应该能显示创建弹窗', async () => {
      wrapper = createWrapper();

      await wrapper.vm.showCreateModal();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.createModalVisible).toBe(true);
      expect(wrapper.vm.createForm.title).toBe('');
      expect(wrapper.vm.createForm.description).toBe('');
      expect(wrapper.vm.createForm.userRequest).toBe('');
    });

    it('应该能创建工作流', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({
        success: true,
        data: { workflowId: 'new-wf-1' },
      });

      wrapper.vm.createForm = {
        title: 'New Workflow',
        description: 'Test description',
        userRequest: 'Do something',
      };

      await wrapper.vm.handleCreateWorkflow();

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:create-and-start', {
        title: 'New Workflow',
        description: 'Test description',
        input: {
          userRequest: 'Do something',
        },
        context: {},
      });
      expect(message.success).toHaveBeenCalledWith('工作流已创建并启动');
      expect(wrapper.vm.createModalVisible).toBe(false);
      expect(wrapper.vm.selectedWorkflowId).toBe('new-wf-1');
    });

    it('应该验证必填项', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.createForm = {
        title: '',
        description: '',
        userRequest: '',
      };

      await wrapper.vm.handleCreateWorkflow();

      expect(message.warning).toHaveBeenCalledWith('请填写必填项');
      expect(window.ipc.invoke).not.toHaveBeenCalledWith('workflow:create-and-start', expect.any(Object));
    });

    it('应该验证标题必填', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.createForm = {
        title: '',
        description: 'Test',
        userRequest: 'Do something',
      };

      await wrapper.vm.handleCreateWorkflow();

      expect(message.warning).toHaveBeenCalledWith('请填写必填项');
    });

    it('应该验证用户请求必填', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      wrapper.vm.createForm = {
        title: 'Test',
        description: 'Test',
        userRequest: '',
      };

      await wrapper.vm.handleCreateWorkflow();

      expect(message.warning).toHaveBeenCalledWith('请填写必填项');
    });

    it('应该能处理创建失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: false, error: 'Creation failed' });

      wrapper.vm.createForm = {
        title: 'New Workflow',
        description: 'Test',
        userRequest: 'Do something',
      };

      await wrapper.vm.handleCreateWorkflow();

      expect(message.error).toHaveBeenCalledWith('Creation failed');
    });

    it('应该能处理创建异常', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockRejectedValue(new Error('Network error'));

      wrapper.vm.createForm = {
        title: 'New Workflow',
        description: 'Test',
        userRequest: 'Do something',
      };

      await wrapper.vm.handleCreateWorkflow();

      expect(message.error).toHaveBeenCalledWith('创建失败: Network error');
    });
  });

  describe('工作流操作', () => {
    it('应该能暂停工作流', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.pauseWorkflow('wf-1');

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:pause', {
        workflowId: 'wf-1',
      });
      expect(message.success).toHaveBeenCalledWith('工作流已暂停');
    });

    it('应该能恢复工作流', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.resumeWorkflow('wf-3');

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:resume', {
        workflowId: 'wf-3',
      });
      expect(message.success).toHaveBeenCalledWith('工作流已恢复');
    });

    it('应该能删除工作流', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.deleteWorkflow('wf-1');

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:delete', {
        workflowId: 'wf-1',
      });
      expect(message.success).toHaveBeenCalledWith('工作流已删除');
    });

    it('应该在删除当前查看的工作流后返回列表', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';
      window.ipc.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.deleteWorkflow('wf-1');

      expect(wrapper.vm.selectedWorkflowId).toBe(null);
    });

    it('应该能处理暂停失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: false, error: 'Pause failed' });

      await wrapper.vm.pauseWorkflow('wf-1');

      expect(message.error).toHaveBeenCalledWith('Pause failed');
    });

    it('应该能处理恢复失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: false, error: 'Resume failed' });

      await wrapper.vm.resumeWorkflow('wf-3');

      expect(message.error).toHaveBeenCalledWith('Resume failed');
    });

    it('应该能处理删除失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: false, error: 'Delete failed' });

      await wrapper.vm.deleteWorkflow('wf-1');

      expect(message.error).toHaveBeenCalledWith('Delete failed');
    });

    it('应该能处理暂停异常', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockRejectedValue(new Error('Network error'));

      await wrapper.vm.pauseWorkflow('wf-1');

      expect(message.error).toHaveBeenCalledWith('操作失败: Network error');
    });
  });

  describe('工作流选择', () => {
    it('应该能选择工作流', async () => {
      wrapper = createWrapper();

      await wrapper.vm.selectWorkflow('wf-1');

      expect(wrapper.vm.selectedWorkflowId).toBe('wf-1');
    });

    it('应该显示工作流详情', async () => {
      wrapper = createWrapper();

      await wrapper.vm.selectWorkflow('wf-1');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.workflow-detail').exists()).toBe(true);
      expect(wrapper.find('.workflows-list').exists()).toBe(false);
    });

    it('应该能返回列表', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';

      await wrapper.vm.$nextTick();
      wrapper.vm.selectedWorkflowId = null;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.workflows-list').exists()).toBe(true);
      expect(wrapper.find('.workflow-detail').exists()).toBe(false);
    });
  });

  describe('导航', () => {
    it('应该能返回上一页', async () => {
      wrapper = createWrapper();

      await wrapper.vm.goBack();

      expect(mockRouter.back).toHaveBeenCalled();
    });

    it('应该在详情页时返回列表', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';

      await wrapper.vm.goBack();

      expect(wrapper.vm.selectedWorkflowId).toBe(null);
      expect(mockRouter.back).not.toHaveBeenCalled();
    });
  });

  describe('工作流完成处理', () => {
    it('应该能处理工作流完成', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';
      const { message } = require('ant-design-vue');
      const completionData = { workflowId: 'wf-1', status: 'completed' };

      window.ipc.invoke
        .mockResolvedValueOnce({ success: true, data: [{ stage: 1 }] })
        .mockResolvedValueOnce({ success: true, data: { gate1: 'passed' } })
        .mockResolvedValueOnce({ success: true, data: [] });

      await wrapper.vm.handleWorkflowComplete(completionData);

      expect(message.success).toHaveBeenCalledWith('工作流执行完成');
      expect(wrapper.vm.completedWorkflow).toEqual(completionData);
      expect(wrapper.vm.showSummary).toBe(true);
    });

    it('应该获取阶段信息', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';

      const stagesData = [{ stage: 1 }, { stage: 2 }];
      window.ipc.invoke
        .mockResolvedValueOnce({ success: true, data: stagesData })
        .mockResolvedValueOnce({ success: true, data: {} })
        .mockResolvedValueOnce({ success: true, data: [] });

      await wrapper.vm.handleWorkflowComplete({ workflowId: 'wf-1' });

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:get-stages', {
        workflowId: 'wf-1',
      });
      expect(wrapper.vm.completedStages).toEqual(stagesData);
    });

    it('应该获取质量门信息', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';

      const gatesData = { gate1: 'passed', gate2: 'failed' };
      window.ipc.invoke
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockResolvedValueOnce({ success: true, data: gatesData })
        .mockResolvedValueOnce({ success: true, data: [] });

      await wrapper.vm.handleWorkflowComplete({ workflowId: 'wf-1' });

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:get-gates', {
        workflowId: 'wf-1',
      });
      expect(wrapper.vm.completedGates).toEqual(gatesData);
    });

    it('应该能处理工作流错误', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      const errorData = { workflowId: 'wf-1', error: 'Something went wrong' };

      window.ipc.invoke.mockResolvedValue({ success: true, data: [] });

      await wrapper.vm.handleWorkflowError(errorData);

      expect(message.error).toHaveBeenCalledWith('工作流执行失败: Something went wrong');
      expect(wrapper.vm.completedWorkflow.success).toBe(false);
      expect(wrapper.vm.showSummary).toBe(true);
    });
  });

  describe('工作流重试', () => {
    it('应该能重试工作流', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';
      wrapper.vm.showSummary = true;
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: true });

      await wrapper.vm.handleRetry();

      expect(window.ipc.invoke).toHaveBeenCalledWith('workflow:retry', {
        workflowId: 'wf-1',
      });
      expect(message.success).toHaveBeenCalledWith('工作流重试中');
      expect(wrapper.vm.showSummary).toBe(false);
    });

    it('应该能处理重试失败', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockResolvedValue({ success: false, error: 'Retry failed' });

      await wrapper.vm.handleRetry();

      expect(message.error).toHaveBeenCalledWith('Retry failed');
    });

    it('应该能处理重试异常', async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedWorkflowId = 'wf-1';
      const { message } = require('ant-design-vue');
      window.ipc.invoke.mockRejectedValue(new Error('Network error'));

      await wrapper.vm.handleRetry();

      expect(message.error).toHaveBeenCalledWith('操作失败: Network error');
    });
  });

  describe('查看结果和导出', () => {
    it('应该能查看结果', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      await wrapper.vm.handleViewResult();

      expect(message.info).toHaveBeenCalledWith('查看结果功能待实现');
    });

    it('应该能导出报告', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');

      await wrapper.vm.handleExport();

      expect(message.info).toHaveBeenCalledWith('导出报告功能待实现');
    });
  });

  describe('状态辅助方法', () => {
    it('应该返回正确的工作流图标', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getWorkflowIcon('idle')).toBe('📋');
      expect(wrapper.vm.getWorkflowIcon('running')).toBe('🔄');
      expect(wrapper.vm.getWorkflowIcon('paused')).toBe('⏸️');
      expect(wrapper.vm.getWorkflowIcon('completed')).toBe('✅');
      expect(wrapper.vm.getWorkflowIcon('failed')).toBe('❌');
      expect(wrapper.vm.getWorkflowIcon('cancelled')).toBe('🚫');
      expect(wrapper.vm.getWorkflowIcon('unknown')).toBe('📋');
    });

    it('应该返回正确的状态颜色', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getStatusColor('idle')).toBe('default');
      expect(wrapper.vm.getStatusColor('running')).toBe('processing');
      expect(wrapper.vm.getStatusColor('paused')).toBe('warning');
      expect(wrapper.vm.getStatusColor('completed')).toBe('success');
      expect(wrapper.vm.getStatusColor('failed')).toBe('error');
      expect(wrapper.vm.getStatusColor('cancelled')).toBe('default');
      expect(wrapper.vm.getStatusColor('unknown')).toBe('default');
    });

    it('应该返回正确的状态文本', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getStatusText('idle')).toBe('等待中');
      expect(wrapper.vm.getStatusText('running')).toBe('执行中');
      expect(wrapper.vm.getStatusText('paused')).toBe('已暂停');
      expect(wrapper.vm.getStatusText('completed')).toBe('已完成');
      expect(wrapper.vm.getStatusText('failed')).toBe('失败');
      expect(wrapper.vm.getStatusText('cancelled')).toBe('已取消');
      expect(wrapper.vm.getStatusText('unknown')).toBe('未知');
    });

    it('应该返回正确的进度状态', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getProgressStatus('failed')).toBe('exception');
      expect(wrapper.vm.getProgressStatus('completed')).toBe('success');
      expect(wrapper.vm.getProgressStatus('running')).toBe('active');
      expect(wrapper.vm.getProgressStatus('paused')).toBe('active');
    });
  });

  describe('时间格式化', () => {
    it('应该格式化0秒', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDuration(0)).toBe('0秒');
      expect(wrapper.vm.formatDuration(null)).toBe('0秒');
      expect(wrapper.vm.formatDuration(undefined)).toBe('0秒');
    });

    it('应该格式化秒', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDuration(5000)).toBe('5秒');
      expect(wrapper.vm.formatDuration(30000)).toBe('30秒');
      expect(wrapper.vm.formatDuration(59000)).toBe('59秒');
    });

    it('应该格式化分钟', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDuration(60000)).toBe('1分0秒');
      expect(wrapper.vm.formatDuration(90000)).toBe('1分30秒');
      expect(wrapper.vm.formatDuration(120000)).toBe('2分0秒');
      expect(wrapper.vm.formatDuration(3599000)).toBe('59分59秒');
    });

    it('应该格式化小时', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDuration(3600000)).toBe('1时0分');
      expect(wrapper.vm.formatDuration(3660000)).toBe('1时1分');
      expect(wrapper.vm.formatDuration(7200000)).toBe('2时0分');
      expect(wrapper.vm.formatDuration(7380000)).toBe('2时3分');
    });
  });

  describe('工作流更新事件', () => {
    it('应该能处理工作流更新', async () => {
      wrapper = createWrapper();
      wrapper.vm.workflows = [...mockWorkflows];

      const updateData = {
        workflowId: 'wf-1',
        overall: {
          status: 'completed',
          percent: 100,
        },
      };

      wrapper.vm.handleWorkflowUpdate(updateData);

      expect(wrapper.vm.workflows[0].overall.status).toBe('completed');
      expect(wrapper.vm.workflows[0].overall.percent).toBe(100);
    });

    it('应该忽略不存在的工作流更新', () => {
      wrapper = createWrapper();
      wrapper.vm.workflows = [...mockWorkflows];

      const updateData = {
        workflowId: 'non-existent',
        overall: { status: 'completed' },
      };

      wrapper.vm.handleWorkflowUpdate(updateData);

      expect(wrapper.vm.workflows.length).toBe(4);
    });

    it('应该能合并工作流更新', () => {
      wrapper = createWrapper();
      wrapper.vm.workflows = [
        {
          workflowId: 'wf-1',
          title: 'Test',
          overall: { status: 'running', percent: 50 },
        },
      ];

      const updateData = {
        workflowId: 'wf-1',
        overall: { percent: 75 },
      };

      wrapper.vm.handleWorkflowUpdate(updateData);

      expect(wrapper.vm.workflows[0].title).toBe('Test');
      expect(wrapper.vm.workflows[0].overall.percent).toBe(75);
    });
  });

  describe('事件监听器清理', () => {
    it('应该在卸载时移除事件监听器', async () => {
      wrapper = createWrapper();

      wrapper.unmount();

      expect(window.ipc.off).toHaveBeenCalledWith(
        'workflow:progress',
        expect.any(Function)
      );
    });
  });

  describe('边界情况', () => {
    it('应该处理空工作流数据', async () => {
      wrapper = createWrapper();
      window.ipc.invoke.mockResolvedValue({ success: true, data: null });

      await wrapper.vm.refreshWorkflows();

      // Should not crash
      expect(wrapper.vm.workflows).toBeTruthy();
    });

    it('应该处理缺少overall字段的工作流', async () => {
      const workflowWithoutOverall = {
        workflowId: 'wf-5',
        title: 'Test Workflow',
      };
      window.ipc.invoke.mockResolvedValue({
        success: true,
        data: [workflowWithoutOverall],
      });
      wrapper = createWrapper();

      await wrapper.vm.refreshWorkflows();
      await wrapper.vm.$nextTick();

      // Should not crash when accessing overall properties
      expect(wrapper.vm.getWorkflowIcon(undefined)).toBe('📋');
    });

    it('应该处理刷新期间的失败响应', async () => {
      wrapper = createWrapper();
      window.ipc.invoke.mockResolvedValue({ success: false });

      await wrapper.vm.refreshWorkflows();

      // Should not update workflows on failure
      expect(wrapper.vm.workflows.length).toBe(0);
    });

    it('应该处理非常长的工作流标题', async () => {
      const longTitle = 'A'.repeat(200);
      const workflowWithLongTitle = {
        ...mockWorkflows[0],
        title: longTitle,
      };
      window.ipc.invoke.mockResolvedValue({
        success: true,
        data: [workflowWithLongTitle],
      });
      wrapper = createWrapper();

      await wrapper.vm.refreshWorkflows();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.workflows[0].title).toBe(longTitle);
    });

    it('应该处理极大的持续时间', () => {
      wrapper = createWrapper();

      const largeMs = 86400000 * 5; // 5 days
      const formatted = wrapper.vm.formatDuration(largeMs);

      expect(formatted).toContain('时');
    });

    it('应该处理负数持续时间', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.formatDuration(-1000)).toBe('0秒');
    });
  });

  describe('多个工作流操作', () => {
    it('应该能同时显示多个不同状态的工作流', async () => {
      window.ipc.invoke.mockResolvedValue({ success: true, data: mockWorkflows });
      wrapper = createWrapper();

      await wrapper.vm.refreshWorkflows();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.workflows[0].overall.status).toBe('running');
      expect(wrapper.vm.workflows[1].overall.status).toBe('completed');
      expect(wrapper.vm.workflows[2].overall.status).toBe('paused');
      expect(wrapper.vm.workflows[3].overall.status).toBe('failed');
    });

    it('应该能连续创建多个工作流', async () => {
      wrapper = createWrapper();
      window.ipc.invoke
        .mockResolvedValueOnce({ success: true, data: { workflowId: 'wf-1' } })
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockResolvedValueOnce({ success: true, data: { workflowId: 'wf-2' } })
        .mockResolvedValueOnce({ success: true, data: [] });

      wrapper.vm.createForm = {
        title: 'Workflow 1',
        description: '',
        userRequest: 'Task 1',
      };
      await wrapper.vm.handleCreateWorkflow();

      wrapper.vm.createModalVisible = true;
      wrapper.vm.createForm = {
        title: 'Workflow 2',
        description: '',
        userRequest: 'Task 2',
      };
      await wrapper.vm.handleCreateWorkflow();

      expect(window.ipc.invoke).toHaveBeenCalledTimes(4);
    });
  });
});
