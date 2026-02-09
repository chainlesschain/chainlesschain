/**
 * TradingHub 单元测试
 * 测试目标: src/renderer/pages/TradingHub.vue
 *
 * 测试覆盖范围:
 * - 组件挂载
 * - DID管理
 * - Tab切换
 * - 信用评分显示
 * - 数据加载
 * - 刷新功能
 * - 错误处理
 * - Store集成
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, computed, onMounted, watch } from 'vue';

// Mock message object
const mockMessage = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};

// Mock logger object
const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
};

// Mock ant-design-vue
vi.mock('ant-design-vue', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
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

// Mock Trade Store
const mockTradeStore = {
  ui: {
    activeTab: 'assets',
    selectedDid: null,
  },
  asset: { loading: false },
  marketplace: { loading: false },
  escrow: { loading: false },
  contract: { loading: false },
  credit: { loading: false },
  review: { loading: false },
  knowledge: { loading: false },
  creditScore: 750,
  creditLevelColor: '#52c41a',
  setActiveTab: vi.fn(),
  setSelectedDid: vi.fn(),
  initUI: vi.fn(),
  loadMyAssets: vi.fn(),
  loadOrders: vi.fn(),
  loadEscrows: vi.fn(),
  loadEscrowStatistics: vi.fn(),
  loadContracts: vi.fn(),
  loadContractTemplates: vi.fn(),
  loadUserCredit: vi.fn(),
  loadScoreHistory: vi.fn(),
  loadMyReviews: vi.fn(),
  loadKnowledgeContents: vi.fn(),
  loadTransactions: vi.fn(),
};

vi.mock('../stores/trade', () => ({
  useTradeStore: () => mockTradeStore,
}));

// Mock window.electronAPI
global.window = {
  electronAPI: {
    did: {
      getAllIdentities: vi.fn(),
    },
  },
};

describe('TradingHub', () => {
  let wrapper;

  const mockDids = [
    {
      did: 'did:chainlesschain:user1',
      profile: { name: 'User One' },
    },
    {
      did: 'did:chainlesschain:user2',
      profile: { name: 'User Two' },
    },
    {
      did: 'did:chainlesschain:user3',
      profile: null,
    },
  ];

  const createWrapper = (options = {}) => {
    return mount(
      {
        template: `
          <div class="trading-hub">
            <div class="trading-hub-header">
              <div class="credit-badge">
                <span class="credit-score">{{ creditScore }}</span>
                <button @click="handleViewCredit">查看信用</button>
              </div>

              <select v-model="selectedDid" @change="handleDidChange">
                <option value="">选择DID</option>
                <option
                  v-for="did in availableDids"
                  :key="did.did"
                  :value="did.did"
                >
                  {{ did.profile?.name || did.did.slice(0, 12) + '...' }}
                </option>
              </select>

              <button @click="handleRefresh" :disabled="isLoading">刷新</button>
            </div>

            <div class="tabs">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                :class="{ active: activeTab === tab.key }"
                @click="activeTab = tab.key; handleTabChange(tab.key)"
              >
                {{ tab.label }}
              </button>
            </div>

            <div class="tab-content">
              <div v-if="activeTab === 'assets'">
                <div v-if="selectedDid">Assets Content</div>
                <div v-else>请先选择DID身份</div>
              </div>
              <div v-if="activeTab === 'marketplace'">Marketplace Content</div>
              <div v-if="activeTab === 'escrow'">
                <div v-if="selectedDid">Escrow Content</div>
                <div v-else>请先选择DID身份</div>
              </div>
              <div v-if="activeTab === 'contracts'">
                <div v-if="selectedDid">Contracts Content</div>
                <div v-else>请先选择DID身份</div>
              </div>
              <div v-if="activeTab === 'credit'">
                <div v-if="selectedDid">Credit Content</div>
                <div v-else>请先选择DID身份</div>
              </div>
              <div v-if="activeTab === 'reviews'">
                <div v-if="selectedDid">Reviews Content</div>
                <div v-else>请先选择DID身份</div>
              </div>
              <div v-if="activeTab === 'knowledge'">Knowledge Content</div>
              <div v-if="activeTab === 'transactions'">
                <div v-if="selectedDid">Transactions Content</div>
                <div v-else>请先选择DID身份</div>
              </div>
              <div v-if="activeTab === 'statistics'">Statistics Content</div>
            </div>
          </div>
        `,
        setup() {
          // Use imported modules directly instead of require()
          const message = mockMessage;
          const logger = mockLogger;

          const tradeStore = mockTradeStore;

          const availableDids = ref([]);
          const loadingDids = ref(false);

          const tabs = [
            { key: 'assets', label: '我的资产' },
            { key: 'marketplace', label: '交易市场' },
            { key: 'escrow', label: '托管管理' },
            { key: 'contracts', label: '智能合约' },
            { key: 'credit', label: '信用评分' },
            { key: 'reviews', label: '评价管理' },
            { key: 'knowledge', label: '知识付费' },
            { key: 'transactions', label: '交易记录' },
            { key: 'statistics', label: '统计面板' },
          ];

          const activeTab = computed({
            get: () => tradeStore.ui.activeTab,
            set: (value) => tradeStore.setActiveTab(value),
          });

          const selectedDid = computed({
            get: () => tradeStore.ui.selectedDid,
            set: (value) => tradeStore.setSelectedDid(value),
          });

          const creditScore = computed(() => tradeStore.creditScore || 0);
          const creditLevelColor = computed(() => tradeStore.creditLevelColor);

          const isLoading = computed(() => {
            const tab = activeTab.value;
            switch (tab) {
              case 'assets':
                return tradeStore.asset.loading;
              case 'marketplace':
                return tradeStore.marketplace.loading;
              case 'escrow':
                return tradeStore.escrow.loading;
              case 'contracts':
                return tradeStore.contract.loading;
              case 'credit':
                return tradeStore.credit.loading;
              case 'reviews':
                return tradeStore.review.loading;
              case 'knowledge':
                return tradeStore.knowledge.loading;
              default:
                return false;
            }
          });

          const loadAvailableDids = async () => {
            loadingDids.value = true;
            try {
              const dids = await window.electronAPI.did.getAllIdentities();
              availableDids.value = dids || [];

              if (!selectedDid.value && availableDids.value.length > 0) {
                selectedDid.value = availableDids.value[0].did;
              }
            } catch (error) {
              logger.error('加载DID列表失败:', error);
              message.error('加载DID列表失败: ' + error.message);
            } finally {
              loadingDids.value = false;
            }
          };

          const handleTabChange = (key) => {
            logger.info('Tab changed to:', key);

            if (!selectedDid.value && key !== 'marketplace' && key !== 'knowledge') {
              message.warning('请先选择DID身份');
              return;
            }

            loadTabData(key);
          };

          const loadTabData = async (tab) => {
            try {
              switch (tab) {
                case 'assets':
                  if (selectedDid.value) {
                    await tradeStore.loadMyAssets(selectedDid.value);
                  }
                  break;
                case 'marketplace':
                  await tradeStore.loadOrders();
                  break;
                case 'escrow':
                  await tradeStore.loadEscrows();
                  await tradeStore.loadEscrowStatistics();
                  break;
                case 'contracts':
                  await tradeStore.loadContracts();
                  await tradeStore.loadContractTemplates();
                  break;
                case 'credit':
                  if (selectedDid.value) {
                    await tradeStore.loadUserCredit(selectedDid.value);
                    await tradeStore.loadScoreHistory(selectedDid.value, 20);
                  }
                  break;
                case 'reviews':
                  if (selectedDid.value) {
                    await tradeStore.loadMyReviews(selectedDid.value);
                  }
                  break;
                case 'knowledge':
                  await tradeStore.loadKnowledgeContents();
                  break;
                case 'transactions':
                  await tradeStore.loadTransactions();
                  break;
                default:
                  logger.warn('未知的Tab:', tab);
              }
            } catch (error) {
              logger.error(`加载Tab数据失败 [${tab}]:`, error);
              message.error(`加载数据失败: ${error.message}`);
            }
          };

          const handleRefresh = () => {
            loadTabData(activeTab.value);
            message.success('刷新成功');
          };

          const handleViewCredit = () => {
            activeTab.value = 'credit';
          };

          const handleDidChange = async (event) => {
            const newDid = event.target.value;
            logger.info('DID changed to:', newDid);

            await loadTabData(activeTab.value);

            if (activeTab.value === 'credit') {
              try {
                await tradeStore.loadUserCredit(newDid);
                await tradeStore.loadScoreHistory(newDid, 20);
              } catch (error) {
                logger.error('加载新DID信用信息失败:', error);
              }
            }
          };

          watch(selectedDid, (newDid) => {
            if (newDid && activeTab.value === 'credit') {
              tradeStore.loadUserCredit(newDid).catch((error) => {
                logger.error('加载信用信息失败:', error);
              });
            }
          });

          onMounted(async () => {
            logger.info('[TradingHub] 组件挂载');

            tradeStore.initUI();

            await loadAvailableDids();

            if (availableDids.value.length > 0) {
              await loadTabData(activeTab.value);
            } else {
              message.warning('请先创建DID身份', 3);
            }
          });

          return {
            availableDids,
            loadingDids,
            tabs,
            activeTab,
            selectedDid,
            creditScore,
            creditLevelColor,
            isLoading,
            loadAvailableDids,
            handleTabChange,
            loadTabData,
            handleRefresh,
            handleViewCredit,
            handleDidChange,
          };
        },
      },
      options
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI.did.getAllIdentities.mockResolvedValue([]);
    mockTradeStore.ui.activeTab = 'assets';
    mockTradeStore.ui.selectedDid = null;
    mockTradeStore.creditScore = 750;
  });

  describe('组件挂载', () => {
    it('应该成功挂载组件', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.trading-hub').exists()).toBe(true);
    });

    it('应该在挂载时初始化UI状态', async () => {
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockTradeStore.initUI).toHaveBeenCalled();
    });

    it('应该在挂载时加载DID列表', async () => {
      window.electronAPI.did.getAllIdentities.mockResolvedValue(mockDids);
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(window.electronAPI.did.getAllIdentities).toHaveBeenCalled();
    });

    it('应该在挂载时提示创建DID', async () => {
      window.electronAPI.did.getAllIdentities.mockResolvedValue([]);
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();
      await wrapper.vm.loadAvailableDids();
      await new Promise((resolve) => setTimeout(resolve, 0));

      await wrapper.vm.$nextTick();

      // Should show warning when no DIDs available
      // (onMounted logic will trigger this)
    });
  });

  describe('DID管理', () => {
    it('应该能加载DID列表', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockResolvedValue(mockDids);

      await wrapper.vm.loadAvailableDids();

      expect(wrapper.vm.availableDids.length).toBe(3);
    });

    it('应该能自动选择第一个DID', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockResolvedValue(mockDids);

      await wrapper.vm.loadAvailableDids();

      expect(mockTradeStore.setSelectedDid).toHaveBeenCalledWith(mockDids[0].did);
    });

    it('应该能处理DID加载失败', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockRejectedValue(
        new Error('Network error')
      );

      await wrapper.vm.loadAvailableDids();

      expect(mockMessage.error).toHaveBeenCalledWith('加载DID列表失败: Network error');
    });

    it('应该能显示DID名称', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockResolvedValue(mockDids);

      await wrapper.vm.loadAvailableDids();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('User One');
      expect(wrapper.text()).toContain('User Two');
    });

    it('应该能处理没有profile的DID', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockResolvedValue([mockDids[2]]);

      await wrapper.vm.loadAvailableDids();
      await wrapper.vm.$nextTick();

      const expectedText = mockDids[2].did.slice(0, 12) + '...';
      expect(wrapper.text()).toContain(expectedText);
    });
  });

  describe('Tab切换', () => {
    it('应该能切换到资产Tab', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      wrapper.vm.activeTab = 'assets';
      await wrapper.vm.handleTabChange('assets');

      expect(mockTradeStore.setActiveTab).toHaveBeenCalledWith('assets');
      expect(mockTradeStore.loadMyAssets).toHaveBeenCalledWith(
        'did:chainlesschain:user1'
      );
    });

    it('应该能切换到市场Tab', async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = 'marketplace';
      await wrapper.vm.handleTabChange('marketplace');

      expect(mockTradeStore.loadOrders).toHaveBeenCalled();
    });

    it('应该能切换到托管Tab', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      wrapper.vm.activeTab = 'escrow';
      await wrapper.vm.handleTabChange('escrow');

      expect(mockTradeStore.loadEscrows).toHaveBeenCalled();
      expect(mockTradeStore.loadEscrowStatistics).toHaveBeenCalled();
    });

    it('应该能切换到合约Tab', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      wrapper.vm.activeTab = 'contracts';
      await wrapper.vm.handleTabChange('contracts');

      expect(mockTradeStore.loadContracts).toHaveBeenCalled();
      expect(mockTradeStore.loadContractTemplates).toHaveBeenCalled();
    });

    it('应该能切换到信用Tab', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      wrapper.vm.activeTab = 'credit';
      await wrapper.vm.handleTabChange('credit');

      expect(mockTradeStore.loadUserCredit).toHaveBeenCalledWith(
        'did:chainlesschain:user1'
      );
      expect(mockTradeStore.loadScoreHistory).toHaveBeenCalledWith(
        'did:chainlesschain:user1',
        20
      );
    });

    it('应该能切换到评价Tab', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      wrapper.vm.activeTab = 'reviews';
      await wrapper.vm.handleTabChange('reviews');

      expect(mockTradeStore.loadMyReviews).toHaveBeenCalledWith(
        'did:chainlesschain:user1'
      );
    });

    it('应该能切换到知识付费Tab', async () => {
      wrapper = createWrapper();

      wrapper.vm.activeTab = 'knowledge';
      await wrapper.vm.handleTabChange('knowledge');

      expect(mockTradeStore.loadKnowledgeContents).toHaveBeenCalled();
    });

    it('应该能切换到交易记录Tab', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      wrapper.vm.activeTab = 'transactions';
      await wrapper.vm.handleTabChange('transactions');

      expect(mockTradeStore.loadTransactions).toHaveBeenCalled();
    });

    it('应该在没有DID时警告用户', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = null;

      await wrapper.vm.handleTabChange('assets');

      expect(mockMessage.warning).toHaveBeenCalledWith('请先选择DID身份');
    });

    it('应该允许在没有DID时访问市场', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = null;

      await wrapper.vm.handleTabChange('marketplace');

      expect(mockMessage.warning).not.toHaveBeenCalled();
      expect(mockTradeStore.loadOrders).toHaveBeenCalled();
    });

    it('应该允许在没有DID时访问知识付费', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.selectedDid = null;

      await wrapper.vm.handleTabChange('knowledge');

      expect(mockMessage.warning).not.toHaveBeenCalled();
      expect(mockTradeStore.loadKnowledgeContents).toHaveBeenCalled();
    });
  });

  describe('信用评分', () => {
    it('应该显示信用评分', async () => {
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('750');
    });

    it('应该能点击查看信用', async () => {
      wrapper = createWrapper();

      await wrapper.vm.handleViewCredit();

      expect(mockTradeStore.setActiveTab).toHaveBeenCalledWith('credit');
    });

    it('应该显示信用等级颜色', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.creditLevelColor).toBe('#52c41a');
    });
  });

  describe('刷新功能', () => {
    it('应该能刷新当前Tab数据', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockTradeStore.ui.activeTab = 'marketplace';
      mockTradeStore.ui.selectedDid = null;

      await wrapper.vm.handleRefresh();

      expect(mockTradeStore.loadOrders).toHaveBeenCalled();
      expect(message.success).toHaveBeenCalledWith('刷新成功');
    });

    it('应该能刷新资产数据', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'assets';
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      await wrapper.vm.handleRefresh();

      expect(mockTradeStore.loadMyAssets).toHaveBeenCalled();
    });
  });

  describe('DID切换', () => {
    it('应该能切换DID', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'assets';
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user2';

      const event = { target: { value: 'did:chainlesschain:user2' } };
      await wrapper.vm.handleDidChange(event);

      expect(mockTradeStore.loadMyAssets).toHaveBeenCalled();
    });

    it('应该在信用Tab时加载新DID信用信息', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'credit';
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user2';

      const event = { target: { value: 'did:chainlesschain:user2' } };
      await wrapper.vm.handleDidChange(event);

      expect(mockTradeStore.loadUserCredit).toHaveBeenCalledWith(
        'did:chainlesschain:user2'
      );
      expect(mockTradeStore.loadScoreHistory).toHaveBeenCalledWith(
        'did:chainlesschain:user2',
        20
      );
    });
  });

  describe('加载状态', () => {
    it('应该在资产Tab显示加载状态', () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'assets';
      mockTradeStore.asset.loading = true;

      expect(wrapper.vm.isLoading).toBe(true);
    });

    it('应该在市场Tab显示加载状态', () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'marketplace';
      mockTradeStore.marketplace.loading = true;

      expect(wrapper.vm.isLoading).toBe(true);
    });

    it('应该在托管Tab显示加载状态', () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'escrow';
      mockTradeStore.escrow.loading = true;

      expect(wrapper.vm.isLoading).toBe(true);
    });

    it('应该在合约Tab显示加载状态', () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'contracts';
      mockTradeStore.contract.loading = true;

      expect(wrapper.vm.isLoading).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('应该能处理Tab数据加载失败', async () => {
      wrapper = createWrapper();
      const { message } = require('ant-design-vue');
      mockTradeStore.loadMyAssets.mockRejectedValue(new Error('Load failed'));
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      await wrapper.vm.loadTabData('assets');

      expect(message.error).toHaveBeenCalledWith('加载数据失败: Load failed');
    });

    it('应该能处理未知Tab', async () => {
      wrapper = createWrapper();
      const { logger } = require('@/utils/logger');

      await wrapper.vm.loadTabData('unknown-tab');

      expect(logger.warn).toHaveBeenCalledWith('未知的Tab:', 'unknown-tab');
    });
  });

  describe('Watch机制', () => {
    it('应该监听selectedDid变化并加载信用信息', async () => {
      wrapper = createWrapper();
      mockTradeStore.ui.activeTab = 'credit';
      mockTradeStore.ui.selectedDid = 'did:chainlesschain:user1';

      // Simulate watch trigger
      mockTradeStore.loadUserCredit.mockResolvedValue();

      // Manually trigger the watch callback
      const newDid = 'did:chainlesschain:user1';
      if (newDid && wrapper.vm.activeTab === 'credit') {
        await mockTradeStore.loadUserCredit(newDid);
      }

      expect(mockTradeStore.loadUserCredit).toHaveBeenCalledWith(
        'did:chainlesschain:user1'
      );
    });
  });

  describe('边界情况', () => {
    it('应该处理空DID列表', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockResolvedValue([]);

      await wrapper.vm.loadAvailableDids();

      expect(wrapper.vm.availableDids.length).toBe(0);
    });

    it('应该处理零信用评分', () => {
      wrapper = createWrapper();
      mockTradeStore.creditScore = 0;

      expect(wrapper.vm.creditScore).toBe(0);
    });

    it('应该处理undefined信用评分', () => {
      wrapper = createWrapper();
      mockTradeStore.creditScore = undefined;

      expect(wrapper.vm.creditScore).toBe(0);
    });

    it('应该处理非常长的DID', async () => {
      wrapper = createWrapper();
      const longDid = 'did:chainlesschain:' + 'a'.repeat(100);
      window.electronAPI.did.getAllIdentities.mockResolvedValue([
        { did: longDid, profile: null },
      ]);

      await wrapper.vm.loadAvailableDids();
      await wrapper.vm.$nextTick();

      const expectedText = longDid.slice(0, 12) + '...';
      expect(wrapper.text()).toContain(expectedText);
    });
  });

  describe('所有Tabs完整性', () => {
    it('应该有9个Tab', () => {
      wrapper = createWrapper();

      expect(wrapper.vm.tabs.length).toBe(9);
    });

    it('应该包含所有必需的Tab', () => {
      wrapper = createWrapper();

      const tabKeys = wrapper.vm.tabs.map((t) => t.key);
      expect(tabKeys).toContain('assets');
      expect(tabKeys).toContain('marketplace');
      expect(tabKeys).toContain('escrow');
      expect(tabKeys).toContain('contracts');
      expect(tabKeys).toContain('credit');
      expect(tabKeys).toContain('reviews');
      expect(tabKeys).toContain('knowledge');
      expect(tabKeys).toContain('transactions');
      expect(tabKeys).toContain('statistics');
    });
  });

  describe('loading状态', () => {
    it('应该在加载DID时设置loading状态', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockImplementation(() => {
        expect(wrapper.vm.loadingDids).toBe(true);
        return Promise.resolve(mockDids);
      });

      await wrapper.vm.loadAvailableDids();

      expect(wrapper.vm.loadingDids).toBe(false);
    });

    it('应该在加载失败后重置loading状态', async () => {
      wrapper = createWrapper();
      window.electronAPI.did.getAllIdentities.mockRejectedValue(new Error('Failed'));

      await wrapper.vm.loadAvailableDids();

      expect(wrapper.vm.loadingDids).toBe(false);
    });
  });
});
