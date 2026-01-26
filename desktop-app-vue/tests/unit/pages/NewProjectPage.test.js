/**
 * NewProjectPage 单元测试
 * 测试目标: src/renderer/pages/projects/NewProjectPage.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - Tab切换
 * - 创建项目
 * - 模板推荐
 * - 模板选择
 * - 导航功能
 * - localStorage交互
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
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

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  createLogger: vi.fn(),
}));

// Mock stores
const mockProjectStore = {};
const mockAuthStore = {
  currentUser: { id: 'user-123' },
};

vi.mock('@/stores/project', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
global.localStorage = localStorageMock;

describe('NewProjectPage', () => {
  let wrapper;

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="new-project-page">
            <div class="page-header">
              <button @click="handleBack">返回</button>
              <h1>新建项目</h1>
            </div>

            <div class="page-content">
              <div class="tabs">
                <button
                  :class="{ active: activeTab === 'ai' }"
                  @click="activeTab = 'ai'"
                >
                  自定义创建
                </button>
                <button
                  :class="{ active: activeTab === 'manual' }"
                  @click="activeTab = 'manual'"
                >
                  手动创建
                </button>
              </div>

              <div v-if="activeTab === 'ai'" class="ai-creator">
                <AIProjectCreator @create="handleCreateProject" />
              </div>

              <div v-if="activeTab === 'manual'" class="manual-form">
                <ManualProjectForm @create="handleCreateProject" />
              </div>
            </div>

            <div v-if="showTemplateRecommendModal" class="template-recommend-modal">
              <h3>是否要基于模板创建项目？</h3>
              <button @click="handleTemplateRecommendDecline">跳过，手动创建</button>
              <button @click="handleTemplateRecommendAccept">浏览模板</button>
            </div>

            <div v-if="showTemplateSelectorModal" class="template-selector-modal">
              <TemplateSelectionModal
                :open="showTemplateSelectorModal"
                @confirm="handleTemplateSelect"
                @cancel="handleTemplateSelectorCancel"
              />
            </div>
          </div>
        `,
        setup() {
          const { ref, onMounted } = require('vue');
          const { useRouter } = require('vue-router');
          const { message } = require('ant-design-vue');
          const { useProjectStore } = require('@/stores/project');
          const { useAuthStore } = require('@/stores/auth');
          const { logger } = require('@/utils/logger');

          const router = useRouter();
          const projectStore = useProjectStore();
          const authStore = useAuthStore();

          const activeTab = ref('ai');
          const showTemplateRecommendModal = ref(false);
          const showTemplateSelectorModal = ref(false);
          const hasShownTemplateRecommend = ref(false);

          const handleBack = () => {
            router.push('/projects');
          };

          const handleCreateProject = async (createData) => {
            await startCreateProcess(createData);
          };

          const handleTemplateSelect = async (template) => {
            const createData = {
              userPrompt: `使用${template.name}模板创建项目${template.description ? '：' + template.description : ''}`,
              name: `基于${template.name}的新项目`,
              projectType: template.project_type || 'general',
              userId: authStore.currentUser?.id || 'default-user',
            };

            if (template.id) {
              createData.templateId = template.id;
            }

            await startCreateProcess(createData);
          };

          const startCreateProcess = async (createData) => {
            try {
              router.push({
                path: `/projects/ai-creating`,
                query: {
                  createData: JSON.stringify(createData),
                },
              });
            } catch (error) {
              logger.error('Start create process failed:', error);
              message.error('启动创建流程失败：' + error.message);
            }
          };

          const handleTemplateRecommendAccept = () => {
            showTemplateRecommendModal.value = false;
            showTemplateSelectorModal.value = true;
          };

          const handleTemplateRecommendDecline = () => {
            showTemplateRecommendModal.value = false;
          };

          const handleTemplateSelectorCancel = () => {
            showTemplateSelectorModal.value = false;
          };

          const checkTemplateRecommend = () => {
            let hasVisited = false;
            try {
              hasVisited = localStorage.getItem('hasVisitedNewProject');
            } catch (error) {
              logger.warn('[NewProject] 读取访问记录失败:', error.message);
            }
            if (!hasVisited && !hasShownTemplateRecommend.value) {
              setTimeout(() => {
                showTemplateRecommendModal.value = true;
                hasShownTemplateRecommend.value = true;
              }, 500);
              try {
                localStorage.setItem('hasVisitedNewProject', 'true');
              } catch (error) {
                logger.warn('[NewProject] 保存访问记录失败:', error.message);
              }
            }
          };

          onMounted(() => {
            checkTemplateRecommend();
          });

          return {
            activeTab,
            showTemplateRecommendModal,
            showTemplateSelectorModal,
            hasShownTemplateRecommend,
            handleBack,
            handleCreateProject,
            handleTemplateSelect,
            startCreateProcess,
            handleTemplateRecommendAccept,
            handleTemplateRecommendDecline,
            handleTemplateSelectorCancel,
            checkTemplateRecommend,
          };
        },
      },
      {
        global: {
          stubs: {
            AIProjectCreator: {
              name: 'AIProjectCreator',
              template: '<div class="ai-project-creator"></div>',
              emits: ['create'],
            },
            ManualProjectForm: {
              name: 'ManualProjectForm',
              template: '<div class="manual-project-form"></div>',
              emits: ['create'],
            },
            TemplateSelectionModal: {
              name: 'TemplateSelectionModal',
              template: '<div class="template-selection-modal"></div>',
              props: ['open'],
              emits: ['confirm', 'cancel'],
            },
          },
        },
        ...options,
      }
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.new-project-page').exists()).toBe(true);
    });

    it('应该默认显示AI创建Tab', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.activeTab).toBe('ai');
    });

    it('应该在挂载时检查模板推荐', async () => {
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(localStorageMock.getItem).toHaveBeenCalledWith('hasVisitedNewProject');
    });
  });

  describe('Tab切换', () => {
    it('应该能切换到手动创建Tab', async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = 'manual';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('manual');
      expect(wrapper.find('.manual-form').exists()).toBe(true);
    });

    it('应该能切换回AI创建Tab', async () => {
      wrapper = createWrapper();
      wrapper.vm.activeTab = 'manual';

      wrapper.vm.activeTab = 'ai';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.activeTab).toBe('ai');
      expect(wrapper.find('.ai-creator').exists()).toBe(true);
    });
  });

  describe('创建项目', () => {
    it('应该能处理创建项目请求', async () => {
      wrapper = createWrapper();
      const createData = {
        name: 'Test Project',
        projectType: 'web',
        userPrompt: 'Create a web application',
      };

      await wrapper.vm.handleCreateProject(createData);

      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/projects/ai-creating',
        query: {
          createData: JSON.stringify(createData),
        },
      });
    });

    it('应该能处理创建失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockRouter.push.mockRejectedValue(new Error('Navigation failed'));

      const createData = { name: 'Test' };
      await wrapper.vm.handleCreateProject(createData);

      expect(message.error).toHaveBeenCalled();
    });
  });

  describe('模板推荐', () => {
    it('应该在首次访问时显示模板推荐', async () => {
      localStorageMock.getItem.mockReturnValue(null);
      wrapper = createWrapper();

      await wrapper.vm.checkTemplateRecommend();
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(wrapper.vm.showTemplateRecommendModal).toBe(true);
      expect(wrapper.vm.hasShownTemplateRecommend).toBe(true);
    });

    it('应该在已访问时不显示模板推荐', async () => {
      localStorageMock.getItem.mockReturnValue('true');
      wrapper = createWrapper();

      await wrapper.vm.checkTemplateRecommend();
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(wrapper.vm.showTemplateRecommendModal).toBe(false);
    });

    it('应该能保存访问记录', async () => {
      localStorageMock.getItem.mockReturnValue(null);
      wrapper = createWrapper();

      await wrapper.vm.checkTemplateRecommend();
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(localStorageMock.setItem).toHaveBeenCalledWith('hasVisitedNewProject', 'true');
    });

    it('应该能接受模板推荐', async () => {
      wrapper = createWrapper();
      wrapper.vm.showTemplateRecommendModal = true;

      await wrapper.vm.handleTemplateRecommendAccept();

      expect(wrapper.vm.showTemplateRecommendModal).toBe(false);
      expect(wrapper.vm.showTemplateSelectorModal).toBe(true);
    });

    it('应该能拒绝模板推荐', async () => {
      wrapper = createWrapper();
      wrapper.vm.showTemplateRecommendModal = true;

      await wrapper.vm.handleTemplateRecommendDecline();

      expect(wrapper.vm.showTemplateRecommendModal).toBe(false);
      expect(wrapper.vm.showTemplateSelectorModal).toBe(false);
    });

    it('应该能处理localStorage错误', async () => {
      const { logger } = require('@/utils/logger');
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('Storage error');
      });
      wrapper = createWrapper();

      await wrapper.vm.checkTemplateRecommend();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('应该能处理保存localStorage错误', async () => {
      const { logger } = require('@/utils/logger');
      localStorageMock.getItem.mockReturnValue(null);
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage error');
      });
      wrapper = createWrapper();

      await wrapper.vm.checkTemplateRecommend();
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('模板选择', () => {
    it('应该能选择模板', async () => {
      wrapper = createWrapper();
      const template = {
        id: 'template-1',
        name: 'Web App',
        description: 'A web application template',
        project_type: 'web',
      };

      await wrapper.vm.handleTemplateSelect(template);

      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/projects/ai-creating',
        })
      );
    });

    it('应该能处理没有templateId的模板', async () => {
      wrapper = createWrapper();
      const template = {
        name: 'Simple Template',
        description: 'A simple template',
        project_type: 'general',
      };

      await wrapper.vm.handleTemplateSelect(template);

      expect(mockRouter.push).toHaveBeenCalled();
      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);
      expect(createData.templateId).toBeUndefined();
    });

    it('应该能处理没有描述的模板', async () => {
      wrapper = createWrapper();
      const template = {
        id: 'template-2',
        name: 'Basic Template',
        project_type: 'general',
      };

      await wrapper.vm.handleTemplateSelect(template);

      expect(mockRouter.push).toHaveBeenCalled();
      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);
      expect(createData.userPrompt).toContain('Basic Template');
    });

    it('应该能取消模板选择', async () => {
      wrapper = createWrapper();
      wrapper.vm.showTemplateSelectorModal = true;

      await wrapper.vm.handleTemplateSelectorCancel();

      expect(wrapper.vm.showTemplateSelectorModal).toBe(false);
    });

    it('应该使用当前用户ID', async () => {
      wrapper = createWrapper();
      mockAuthStore.currentUser = { id: 'test-user-123' };
      const template = {
        id: 'template-1',
        name: 'Test',
        project_type: 'web',
      };

      await wrapper.vm.handleTemplateSelect(template);

      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);
      expect(createData.userId).toBe('test-user-123');
    });

    it('应该使用默认用户ID当没有当前用户时', async () => {
      wrapper = createWrapper();
      mockAuthStore.currentUser = null;
      const template = {
        id: 'template-1',
        name: 'Test',
        project_type: 'web',
      };

      await wrapper.vm.handleTemplateSelect(template);

      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);
      expect(createData.userId).toBe('default-user');
    });
  });

  describe('导航', () => {
    it('应该能返回项目列表', () => {
      wrapper = createWrapper();

      wrapper.vm.handleBack();

      expect(mockRouter.push).toHaveBeenCalledWith('/projects');
    });
  });

  describe('边界情况', () => {
    it('应该处理没有项目类型的模板', async () => {
      wrapper = createWrapper();
      const template = {
        id: 'template-1',
        name: 'No Type Template',
        description: 'Test',
      };

      await wrapper.vm.handleTemplateSelect(template);

      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);
      expect(createData.projectType).toBe('general');
    });

    it('应该处理已显示过推荐的情况', async () => {
      wrapper = createWrapper();
      wrapper.vm.hasShownTemplateRecommend = true;

      await wrapper.vm.checkTemplateRecommend();
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(wrapper.vm.showTemplateRecommendModal).toBe(false);
    });

    it('应该生成正确的userPrompt', async () => {
      wrapper = createWrapper();
      const template = {
        id: 'template-1',
        name: 'React App',
        description: 'Modern React application',
        project_type: 'web',
      };

      await wrapper.vm.handleTemplateSelect(template);

      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);
      expect(createData.userPrompt).toBe(
        '使用React App模板创建项目：Modern React application'
      );
    });

    it('应该生成正确的项目名称', async () => {
      wrapper = createWrapper();
      const template = {
        id: 'template-1',
        name: 'Vue App',
        project_type: 'web',
      };

      await wrapper.vm.handleTemplateSelect(template);

      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);
      expect(createData.name).toBe('基于Vue App的新项目');
    });
  });

  describe('创建数据验证', () => {
    it('应该创建正确格式的创建数据', async () => {
      wrapper = createWrapper();
      const template = {
        id: 'template-1',
        name: 'Full Template',
        description: 'Complete template',
        project_type: 'mobile',
      };

      await wrapper.vm.handleTemplateSelect(template);

      const callArgs = mockRouter.push.mock.calls[0][0];
      const createData = JSON.parse(callArgs.query.createData);

      expect(createData).toHaveProperty('userPrompt');
      expect(createData).toHaveProperty('name');
      expect(createData).toHaveProperty('projectType');
      expect(createData).toHaveProperty('userId');
      expect(createData).toHaveProperty('templateId');
    });

    it('应该正确序列化和传递创建数据', async () => {
      wrapper = createWrapper();
      const createData = {
        name: 'Complex Project',
        userPrompt: 'Create something complex',
        projectType: 'enterprise',
      };

      await wrapper.vm.startCreateProcess(createData);

      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/projects/ai-creating',
        query: {
          createData: JSON.stringify(createData),
        },
      });
    });
  });
});
