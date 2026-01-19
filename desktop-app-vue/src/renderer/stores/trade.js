import { logger, createLogger } from '@/utils/logger';
import { defineStore } from 'pinia';

/**
 * 交易模块主Store
 *
 * 管理8个子模块的状态:
 * 1. 资产管理 (asset)
 * 2. 交易市场 (marketplace)
 * 3. 托管管理 (escrow)
 * 4. 智能合约 (contract)
 * 5. 信用评分 (credit)
 * 6. 评价管理 (review)
 * 7. 知识付费 (knowledge)
 * 8. UI状态 (ui)
 */
export const useTradeStore = defineStore('trade', {
  state: () => ({
    // ==================== 资产管理 ====================
    asset: {
      myAssets: [],              // 我的资产列表
      allAssets: [],             // 所有资产列表
      currentAsset: null,        // 当前查看的资产
      assetHistory: [],          // 资产历史记录
      balances: {},              // 余额映射 { assetId: amount }
      loading: false,
      creating: false,
    },

    // ==================== 交易市场 ====================
    marketplace: {
      orders: [],                // 市场订单列表
      myCreatedOrders: [],       // 我发布的订单
      myPurchasedOrders: [],     // 我购买的订单
      transactions: [],          // 交易记录
      currentOrder: null,        // 当前查看的订单
      filters: {
        orderType: '',           // '', 'buy', 'sell', 'service', 'barter'
        status: '',              // '', 'open', 'closed', 'cancelled'
        searchKeyword: '',
      },
      loading: false,
      purchasing: false,
    },

    // ==================== 托管管理 ====================
    escrow: {
      escrows: [],               // 托管列表
      currentEscrow: null,       // 当前托管详情
      escrowHistory: [],         // 托管历史
      statistics: {
        total: 0,
        locked: 0,
        released: 0,
        refunded: 0,
        disputed: 0,
      },
      loading: false,
    },

    // ==================== 智能合约 ====================
    contract: {
      contracts: [],             // 合约列表
      templates: [],             // 合约模板
      currentContract: null,     // 当前合约详情
      conditions: [],            // 合约条件
      events: [],                // 合约事件
      signatures: [],            // 签名列表
      filters: {
        status: '',              // '', 'draft', 'active', 'completed', 'cancelled'
        templateType: '',
      },
      loading: false,
      executing: false,
    },

    // ==================== 信用评分 ====================
    credit: {
      userCredit: null,          // 用户信用信息
      scoreHistory: [],          // 评分历史
      leaderboard: [],           // 排行榜
      statistics: null,          // 全局统计
      loading: false,
    },

    // ==================== 评价管理 ====================
    review: {
      reviews: [],               // 评价列表
      myReviews: [],             // 我的评价
      targetReviews: [],         // 某个目标的评价
      statistics: null,          // 评价统计
      currentReview: null,
      loading: false,
    },

    // ==================== 知识付费 ====================
    knowledge: {
      contents: [],              // 内容列表
      myContents: [],            // 我创建的内容
      myPurchases: [],           // 我的购买
      mySubscriptions: [],       // 我的订阅
      subscriptionPlans: [],     // 订阅计划
      currentContent: null,
      statistics: null,          // 创作者统计
      loading: false,
    },

    // ==================== UI状态 ====================
    ui: {
      activeTab: 'marketplace',  // TradingHub当前Tab
      selectedDid: null,         // 当前用户DID
    },
  }),

  getters: {
    // ===== 资产 Getters =====

    /**
     * 根据ID获取资产
     */
    getAssetById: (state) => (assetId) => {
      return state.asset.allAssets.find(a => a.id === assetId) ||
             state.asset.myAssets.find(a => a.id === assetId);
    },

    /**
     * 我的通证资产
     */
    myTokenAssets: (state) => {
      return state.asset.myAssets.filter(a => a.asset_type === 'token');
    },

    /**
     * 我的NFT资产
     */
    myNFTAssets: (state) => {
      return state.asset.myAssets.filter(a => a.asset_type === 'nft');
    },

    /**
     * 我的知识产品
     */
    myKnowledgeAssets: (state) => {
      return state.asset.myAssets.filter(a => a.asset_type === 'knowledge');
    },

    /**
     * 我的服务凭证
     */
    myServiceAssets: (state) => {
      return state.asset.myAssets.filter(a => a.asset_type === 'service');
    },

    // ===== 市场 Getters =====

    /**
     * 过滤后的订单列表
     */
    filteredOrders: (state) => {
      let orders = [...state.marketplace.orders];
      const { orderType, status, searchKeyword } = state.marketplace.filters;

      if (orderType) {
        orders = orders.filter(o => o.order_type === orderType);
      }
      if (status) {
        orders = orders.filter(o => o.status === status);
      }
      if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        orders = orders.filter(o =>
          o.title?.toLowerCase().includes(keyword) ||
          (o.description && o.description.toLowerCase().includes(keyword))
        );
      }

      return orders;
    },

    /**
     * 开放的订单（可购买）
     */
    openOrders: (state) => {
      return state.marketplace.orders.filter(o => o.status === 'open');
    },

    // ===== 合约 Getters =====

    /**
     * 过滤后的合约列表
     */
    filteredContracts: (state) => {
      let contracts = [...state.contract.contracts];
      const { status, templateType } = state.contract.filters;

      if (status) {
        contracts = contracts.filter(c => c.status === status);
      }
      if (templateType) {
        contracts = contracts.filter(c => c.template_type === templateType);
      }

      return contracts;
    },

    /**
     * 活跃的合约
     */
    activeContracts: (state) => {
      return state.contract.contracts.filter(c => c.status === 'active');
    },

    /**
     * 待签名的合约
     */
    pendingSignContracts: (state) => {
      return state.contract.contracts.filter(c => c.status === 'draft');
    },

    // ===== 信用 Getters =====

    /**
     * 信用等级
     */
    creditLevel: (state) => {
      if (!state.credit.userCredit) {return null;}
      return state.credit.userCredit.credit_level;
    },

    /**
     * 信用评分
     */
    creditScore: (state) => {
      if (!state.credit.userCredit) {return 0;}
      return state.credit.userCredit.credit_score;
    },

    /**
     * 信用等级颜色
     */
    creditLevelColor: (state) => {
      const score = state.credit.userCredit?.credit_score || 0;
      if (score >= 901) {return '#52c41a';}  // 钻石 - 绿色
      if (score >= 601) {return '#faad14';}  // 黄金 - 金色
      if (score >= 301) {return '#1890ff';}  // 白银 - 蓝色
      if (score >= 101) {return '#8c8c8c';}  // 青铜 - 灰色
      return '#d9d9d9';                    // 新手 - 浅灰
    },
  },

  actions: {
    // ==================== 资产管理 Actions ====================

    /**
     * 加载我的资产
     */
    async loadMyAssets(ownerDid) {
      this.asset.loading = true;
      try {
        const assets = await window.electronAPI.asset.getByOwner(ownerDid);
        this.asset.myAssets = assets || [];

        // 同时加载余额
        for (const asset of this.asset.myAssets) {
          try {
            const balance = await window.electronAPI.asset.getBalance(ownerDid, asset.id);
            this.asset.balances[asset.id] = balance || 0;
          } catch (error) {
            logger.warn(`加载资产 ${asset.id} 余额失败:`, error);
            this.asset.balances[asset.id] = 0;
          }
        }
      } catch (error) {
        logger.error('加载我的资产失败:', error);
        throw error;
      } finally {
        this.asset.loading = false;
      }
    },

    /**
     * 加载所有资产
     */
    async loadAllAssets(filters = {}) {
      this.asset.loading = true;
      try {
        const assets = await window.electronAPI.asset.getAll(filters);
        this.asset.allAssets = assets || [];
      } catch (error) {
        logger.error('加载所有资产失败:', error);
        throw error;
      } finally {
        this.asset.loading = false;
      }
    },

    /**
     * 创建资产
     */
    async createAsset(options) {
      this.asset.creating = true;
      try {
        const asset = await window.electronAPI.asset.create(options);
        this.asset.myAssets.push(asset);
        return asset;
      } catch (error) {
        logger.error('创建资产失败:', error);

        // 友好错误提示
        let userMessage = '创建资产失败';
        if (error.message.includes('DID')) {
          userMessage = '请先创建DID身份';
        } else if (error.message.includes('symbol')) {
          userMessage = '资产符号已存在，请更换';
        }

        throw new Error(userMessage);
      } finally {
        this.asset.creating = false;
      }
    },

    /**
     * 转账资产
     */
    async transferAsset(assetId, toDid, amount, memo) {
      try {
        const tx = await window.electronAPI.asset.transfer(assetId, toDid, amount, memo);

        // 更新余额
        const ownerDid = this.ui.selectedDid;
        if (ownerDid) {
          const newBalance = await window.electronAPI.asset.getBalance(ownerDid, assetId);
          this.asset.balances[assetId] = newBalance || 0;
        }

        return tx;
      } catch (error) {
        logger.error('转账失败:', error);
        throw error;
      }
    },

    /**
     * 铸造资产
     */
    async mintAsset(assetId, toDid, amount) {
      try {
        const result = await window.electronAPI.asset.mint(assetId, toDid, amount);

        // 刷新资产列表
        if (this.ui.selectedDid) {
          await this.loadMyAssets(this.ui.selectedDid);
        }

        return result;
      } catch (error) {
        logger.error('铸造资产失败:', error);
        throw error;
      }
    },

    /**
     * 销毁资产
     */
    async burnAsset(assetId, amount) {
      try {
        const result = await window.electronAPI.asset.burn(assetId, amount);

        // 更新余额
        const ownerDid = this.ui.selectedDid;
        if (ownerDid) {
          const newBalance = await window.electronAPI.asset.getBalance(ownerDid, assetId);
          this.asset.balances[assetId] = newBalance || 0;
        }

        return result;
      } catch (error) {
        logger.error('销毁资产失败:', error);
        throw error;
      }
    },

    /**
     * 加载资产历史
     */
    async loadAssetHistory(assetId, limit = 50) {
      try {
        const history = await window.electronAPI.asset.getHistory(assetId, limit);
        this.asset.assetHistory = history || [];
      } catch (error) {
        logger.error('加载资产历史失败:', error);
        throw error;
      }
    },

    /**
     * 设置当前资产
     */
    setCurrentAsset(asset) {
      this.asset.currentAsset = asset;
    },

    // ==================== 交易市场 Actions ====================

    /**
     * 加载订单列表
     */
    async loadOrders(filters = {}) {
      this.marketplace.loading = true;
      try {
        const orders = await window.electronAPI.marketplace.getOrders(filters);
        this.marketplace.orders = orders || [];
      } catch (error) {
        logger.error('加载订单失败:', error);
        throw error;
      } finally {
        this.marketplace.loading = false;
      }
    },

    /**
     * 加载我的订单
     */
    async loadMyOrders(userDid) {
      this.marketplace.loading = true;
      try {
        const result = await window.electronAPI.marketplace.getMyOrders(userDid);
        this.marketplace.myCreatedOrders = result.createdOrders || [];
        this.marketplace.myPurchasedOrders = result.purchasedOrders || [];
      } catch (error) {
        logger.error('加载我的订单失败:', error);
        throw error;
      } finally {
        this.marketplace.loading = false;
      }
    },

    /**
     * 创建订单
     */
    async createOrder(options) {
      try {
        const order = await window.electronAPI.marketplace.createOrder(options);
        this.marketplace.myCreatedOrders.push(order);
        this.marketplace.orders.push(order);
        return order;
      } catch (error) {
        logger.error('创建订单失败:', error);
        throw error;
      }
    },

    /**
     * 购买订单（匹配订单）
     */
    async purchaseOrder(orderId, quantity) {
      this.marketplace.purchasing = true;
      try {
        const transaction = await window.electronAPI.marketplace.matchOrder(orderId, quantity);

        // 刷新订单和交易列表
        await this.loadOrders();
        await this.loadTransactions();

        return transaction;
      } catch (error) {
        logger.error('购买订单失败:', error);
        throw error;
      } finally {
        this.marketplace.purchasing = false;
      }
    },

    /**
     * 取消订单
     */
    async cancelOrder(orderId) {
      try {
        await window.electronAPI.marketplace.cancelOrder(orderId);

        // 更新本地状态
        const orderIndex = this.marketplace.myCreatedOrders.findIndex(o => o.id === orderId);
        if (orderIndex !== -1) {
          this.marketplace.myCreatedOrders[orderIndex].status = 'cancelled';
        }

        // 刷新订单列表
        await this.loadOrders();
      } catch (error) {
        logger.error('取消订单失败:', error);
        throw error;
      }
    },

    /**
     * 加载交易记录
     */
    async loadTransactions(filters = {}) {
      try {
        const transactions = await window.electronAPI.marketplace.getTransactions(filters);
        this.marketplace.transactions = transactions || [];
      } catch (error) {
        logger.error('加载交易记录失败:', error);
        throw error;
      }
    },

    /**
     * 确认交付
     */
    async confirmDelivery(transactionId) {
      try {
        await window.electronAPI.marketplace.confirmDelivery(transactionId);
        await this.loadTransactions();
      } catch (error) {
        logger.error('确认交付失败:', error);
        throw error;
      }
    },

    /**
     * 申请退款
     */
    async requestRefund(transactionId, reason) {
      try {
        await window.electronAPI.marketplace.requestRefund(transactionId, reason);
        await this.loadTransactions();
      } catch (error) {
        logger.error('申请退款失败:', error);
        throw error;
      }
    },

    /**
     * 设置市场筛选条件
     */
    setMarketplaceFilter(key, value) {
      this.marketplace.filters[key] = value;
    },

    /**
     * 设置当前订单
     */
    setCurrentOrder(order) {
      this.marketplace.currentOrder = order;
    },

    // ==================== 托管管理 Actions ====================

    /**
     * 加载托管列表
     */
    async loadEscrows(filters = {}) {
      this.escrow.loading = true;
      try {
        const escrows = await window.electronAPI.escrow.getList(filters);
        this.escrow.escrows = escrows || [];
      } catch (error) {
        logger.error('加载托管列表失败:', error);
        throw error;
      } finally {
        this.escrow.loading = false;
      }
    },

    /**
     * 加载托管详情
     */
    async loadEscrowDetail(escrowId) {
      try {
        const escrow = await window.electronAPI.escrow.get(escrowId);
        this.escrow.currentEscrow = escrow;
      } catch (error) {
        logger.error('加载托管详情失败:', error);
        throw error;
      }
    },

    /**
     * 加载托管历史
     */
    async loadEscrowHistory(escrowId) {
      try {
        const history = await window.electronAPI.escrow.getHistory(escrowId);
        this.escrow.escrowHistory = history || [];
      } catch (error) {
        logger.error('加载托管历史失败:', error);
        throw error;
      }
    },

    /**
     * 发起托管争议
     */
    async disputeEscrow(escrowId, reason) {
      try {
        await window.electronAPI.escrow.dispute(escrowId, reason);
        await this.loadEscrowDetail(escrowId);
        await this.loadEscrows();
      } catch (error) {
        logger.error('发起争议失败:', error);
        throw error;
      }
    },

    /**
     * 加载托管统计
     */
    async loadEscrowStatistics() {
      try {
        const statistics = await window.electronAPI.escrow.getStatistics();
        this.escrow.statistics = statistics || {
          total: 0,
          locked: 0,
          released: 0,
          refunded: 0,
          disputed: 0,
        };
      } catch (error) {
        logger.error('加载托管统计失败:', error);
        throw error;
      }
    },

    // ==================== 智能合约 Actions ====================

    /**
     * 加载合约列表
     */
    async loadContracts(filters = {}) {
      this.contract.loading = true;
      try {
        const contracts = await window.electronAPI.contract.getList(filters);
        this.contract.contracts = contracts || [];
      } catch (error) {
        logger.error('加载合约失败:', error);
        throw error;
      } finally {
        this.contract.loading = false;
      }
    },

    /**
     * 加载合约模板
     */
    async loadContractTemplates() {
      try {
        const templates = await window.electronAPI.contract.getTemplates();
        this.contract.templates = templates || [];
      } catch (error) {
        logger.error('加载合约模板失败:', error);
        throw error;
      }
    },

    /**
     * 创建合约
     */
    async createContract(options) {
      try {
        const contract = await window.electronAPI.contract.create(options);
        this.contract.contracts.push(contract);
        return contract;
      } catch (error) {
        logger.error('创建合约失败:', error);
        throw error;
      }
    },

    /**
     * 从模板创建合约
     */
    async createContractFromTemplate(templateId, params) {
      try {
        const contract = await window.electronAPI.contract.createFromTemplate(templateId, params);
        this.contract.contracts.push(contract);
        return contract;
      } catch (error) {
        logger.error('从模板创建合约失败:', error);
        throw error;
      }
    },

    /**
     * 激活合约
     */
    async activateContract(contractId) {
      try {
        await window.electronAPI.contract.activate(contractId);

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('激活合约失败:', error);
        throw error;
      }
    },

    /**
     * 签名合约
     */
    async signContract(contractId, signature) {
      try {
        await window.electronAPI.contract.sign(contractId, signature);

        // 刷新合约详情
        const contract = await window.electronAPI.contract.get(contractId);
        this.contract.currentContract = contract;

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('签名合约失败:', error);
        throw error;
      }
    },

    /**
     * 执行合约
     */
    async executeContract(contractId) {
      this.contract.executing = true;
      try {
        await window.electronAPI.contract.execute(contractId);

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('执行合约失败:', error);
        throw error;
      } finally {
        this.contract.executing = false;
      }
    },

    /**
     * 取消合约
     */
    async cancelContract(contractId, reason) {
      try {
        await window.electronAPI.contract.cancel(contractId, reason);

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('取消合约失败:', error);
        throw error;
      }
    },

    /**
     * 检查合约条件
     */
    async checkContractConditions(contractId) {
      try {
        const result = await window.electronAPI.contract.checkConditions(contractId);
        return result;
      } catch (error) {
        logger.error('检查合约条件失败:', error);
        throw error;
      }
    },

    /**
     * 加载合约条件
     */
    async loadContractConditions(contractId) {
      try {
        const conditions = await window.electronAPI.contract.getConditions(contractId);
        this.contract.conditions = conditions || [];
      } catch (error) {
        logger.error('加载合约条件失败:', error);
        throw error;
      }
    },

    /**
     * 加载合约事件
     */
    async loadContractEvents(contractId) {
      try {
        const events = await window.electronAPI.contract.getEvents(contractId);
        this.contract.events = events || [];
      } catch (error) {
        logger.error('加载合约事件失败:', error);
        throw error;
      }
    },

    /**
     * 发起仲裁
     */
    async initiateArbitration(contractId, reason, evidence) {
      try {
        await window.electronAPI.contract.initiateArbitration(contractId, reason, evidence);
        await this.loadContracts();
      } catch (error) {
        logger.error('发起仲裁失败:', error);
        throw error;
      }
    },

    /**
     * 解决仲裁
     */
    async resolveArbitration(arbitrationId, resolution) {
      try {
        await window.electronAPI.contract.resolveArbitration(arbitrationId, resolution);
        await this.loadContracts();
      } catch (error) {
        logger.error('解决仲裁失败:', error);
        throw error;
      }
    },

    /**
     * 设置合约筛选条件
     */
    setContractFilter(key, value) {
      this.contract.filters[key] = value;
    },

    /**
     * 设置当前合约
     */
    setCurrentContract(contract) {
      this.contract.currentContract = contract;
    },

    // ==================== 信用评分 Actions ====================

    /**
     * 加载用户信用信息
     */
    async loadUserCredit(userDid) {
      this.credit.loading = true;
      try {
        const credit = await window.electronAPI.credit.getUserCredit(userDid);
        this.credit.userCredit = credit;
      } catch (error) {
        logger.error('加载信用信息失败:', error);
        throw error;
      } finally {
        this.credit.loading = false;
      }
    },

    /**
     * 更新信用评分
     */
    async updateCreditScore(userDid) {
      try {
        await window.electronAPI.credit.updateScore(userDid);
        await this.loadUserCredit(userDid);
      } catch (error) {
        logger.error('更新信用评分失败:', error);
        throw error;
      }
    },

    /**
     * 加载评分历史
     */
    async loadScoreHistory(userDid, limit = 50) {
      try {
        const history = await window.electronAPI.credit.getScoreHistory(userDid, limit);
        this.credit.scoreHistory = history || [];
      } catch (error) {
        logger.error('加载评分历史失败:', error);
        throw error;
      }
    },

    /**
     * 加载信用排行榜
     */
    async loadLeaderboard(limit = 50) {
      try {
        const leaderboard = await window.electronAPI.credit.getLeaderboard(limit);
        this.credit.leaderboard = leaderboard || [];
      } catch (error) {
        logger.error('加载排行榜失败:', error);
        throw error;
      }
    },

    /**
     * 加载信用统计
     */
    async loadCreditStatistics() {
      try {
        const statistics = await window.electronAPI.credit.getStatistics();
        this.credit.statistics = statistics;
      } catch (error) {
        logger.error('加载信用统计失败:', error);
        throw error;
      }
    },

    // ==================== 评价管理 Actions ====================

    /**
     * 加载评价列表
     */
    async loadReviews(targetId, targetType, filters = {}) {
      this.review.loading = true;
      try {
        const reviews = await window.electronAPI.review.getByTarget(targetId, targetType, filters);
        this.review.targetReviews = reviews || [];
      } catch (error) {
        logger.error('加载评价失败:', error);
        throw error;
      } finally {
        this.review.loading = false;
      }
    },

    /**
     * 加载我的评价
     */
    async loadMyReviews(userDid) {
      this.review.loading = true;
      try {
        const reviews = await window.electronAPI.review.getMyReviews(userDid);
        this.review.myReviews = reviews || [];
      } catch (error) {
        logger.error('加载我的评价失败:', error);
        throw error;
      } finally {
        this.review.loading = false;
      }
    },

    /**
     * 创建评价
     */
    async createReview(options) {
      try {
        const review = await window.electronAPI.review.create(options);
        this.review.myReviews.push(review);
        return review;
      } catch (error) {
        logger.error('创建评价失败:', error);
        throw error;
      }
    },

    /**
     * 更新评价
     */
    async updateReview(reviewId, updates) {
      try {
        const review = await window.electronAPI.review.update(reviewId, updates);

        // 更新本地列表
        const index = this.review.myReviews.findIndex(r => r.id === reviewId);
        if (index !== -1) {
          this.review.myReviews[index] = review;
        }

        return review;
      } catch (error) {
        logger.error('更新评价失败:', error);
        throw error;
      }
    },

    /**
     * 回复评价
     */
    async replyToReview(reviewId, content) {
      try {
        await window.electronAPI.review.reply(reviewId, content);

        // 刷新评价详情
        const review = await window.electronAPI.review.get(reviewId);
        this.review.currentReview = review;
      } catch (error) {
        logger.error('回复评价失败:', error);
        throw error;
      }
    },

    /**
     * 标记评价为有帮助/无帮助
     */
    async markReviewHelpful(reviewId, helpful) {
      try {
        await window.electronAPI.review.markHelpful(reviewId, helpful);
      } catch (error) {
        logger.error('标记评价失败:', error);
        throw error;
      }
    },

    /**
     * 举报评价
     */
    async reportReview(reviewId, reason, description) {
      try {
        await window.electronAPI.review.report(reviewId, reason, description);
      } catch (error) {
        logger.error('举报评价失败:', error);
        throw error;
      }
    },

    /**
     * 加载评价统计
     */
    async loadReviewStatistics(targetId, targetType) {
      try {
        const statistics = await window.electronAPI.review.getStatistics(targetId, targetType);
        this.review.statistics = statistics;
      } catch (error) {
        logger.error('加载评价统计失败:', error);
        throw error;
      }
    },

    // ==================== 知识付费 Actions ====================

    /**
     * 加载知识内容列表
     */
    async loadKnowledgeContents(filters = {}) {
      this.knowledge.loading = true;
      try {
        const contents = await window.electronAPI.knowledge.listContents(filters);
        this.knowledge.contents = contents || [];
      } catch (error) {
        logger.error('加载知识内容失败:', error);
        throw error;
      } finally {
        this.knowledge.loading = false;
      }
    },

    /**
     * 加载我的创作内容
     */
    async loadMyContents(creatorDid) {
      try {
        const contents = await window.electronAPI.knowledge.listContents({ creator_did: creatorDid });
        this.knowledge.myContents = contents || [];
      } catch (error) {
        logger.error('加载我的内容失败:', error);
        throw error;
      }
    },

    /**
     * 创建知识内容
     */
    async createKnowledgeContent(options) {
      try {
        const content = await window.electronAPI.knowledge.createContent(options);
        this.knowledge.myContents.push(content);
        return content;
      } catch (error) {
        logger.error('创建知识内容失败:', error);
        throw error;
      }
    },

    /**
     * 更新知识内容
     */
    async updateKnowledgeContent(contentId, updates) {
      try {
        const content = await window.electronAPI.knowledge.updateContent(contentId, updates);

        // 更新本地列表
        const index = this.knowledge.myContents.findIndex(c => c.id === contentId);
        if (index !== -1) {
          this.knowledge.myContents[index] = content;
        }

        return content;
      } catch (error) {
        logger.error('更新知识内容失败:', error);
        throw error;
      }
    },

    /**
     * 购买内容
     */
    async purchaseContent(contentId, paymentAssetId) {
      try {
        const purchase = await window.electronAPI.knowledge.purchaseContent(contentId, paymentAssetId);
        this.knowledge.myPurchases.push(purchase);
        return purchase;
      } catch (error) {
        logger.error('购买内容失败:', error);
        throw error;
      }
    },

    /**
     * 订阅创作者
     */
    async subscribeToCreator(planId, paymentAssetId) {
      try {
        const subscription = await window.electronAPI.knowledge.subscribe(planId, paymentAssetId);
        this.knowledge.mySubscriptions.push(subscription);
        return subscription;
      } catch (error) {
        logger.error('订阅失败:', error);
        throw error;
      }
    },

    /**
     * 取消订阅
     */
    async unsubscribe(planId) {
      try {
        await window.electronAPI.knowledge.unsubscribe(planId);

        // 从本地列表移除
        const index = this.knowledge.mySubscriptions.findIndex(s => s.plan_id === planId);
        if (index !== -1) {
          this.knowledge.mySubscriptions.splice(index, 1);
        }
      } catch (error) {
        logger.error('取消订阅失败:', error);
        throw error;
      }
    },

    /**
     * 加载我的购买记录
     */
    async loadMyPurchases(userDid) {
      try {
        const purchases = await window.electronAPI.knowledge.getMyPurchases(userDid);
        this.knowledge.myPurchases = purchases || [];
      } catch (error) {
        logger.error('加载购买记录失败:', error);
        throw error;
      }
    },

    /**
     * 加载我的订阅
     */
    async loadMySubscriptions(userDid) {
      try {
        const subscriptions = await window.electronAPI.knowledge.getMySubscriptions(userDid);
        this.knowledge.mySubscriptions = subscriptions || [];
      } catch (error) {
        logger.error('加载订阅记录失败:', error);
        throw error;
      }
    },

    /**
     * 访问内容（解密）
     */
    async accessContent(contentId) {
      try {
        const content = await window.electronAPI.knowledge.accessContent(contentId);
        this.knowledge.currentContent = content;
        return content;
      } catch (error) {
        logger.error('访问内容失败:', error);
        throw error;
      }
    },

    /**
     * 检查内容访问权限
     */
    async checkContentAccess(contentId, userDid) {
      try {
        const hasAccess = await window.electronAPI.knowledge.checkAccess(contentId, userDid);
        return hasAccess;
      } catch (error) {
        logger.error('检查访问权限失败:', error);
        return false;
      }
    },

    /**
     * 加载知识统计（创作者）
     */
    async loadKnowledgeStatistics(creatorDid) {
      try {
        const statistics = await window.electronAPI.knowledge.getStatistics(creatorDid);
        this.knowledge.statistics = statistics;
      } catch (error) {
        logger.error('加载知识统计失败:', error);
        throw error;
      }
    },

    // ==================== UI状态 ====================

    /**
     * 设置活跃Tab
     */
    setActiveTab(tab) {
      this.ui.activeTab = tab;
      // 保存到localStorage
      try {
        localStorage.setItem('trading-hub-active-tab', tab);
      } catch (error) {
        logger.warn('保存Tab状态失败:', error);
      }
    },

    /**
     * 设置选中的DID
     */
    setSelectedDid(did) {
      this.ui.selectedDid = did;
    },

    /**
     * 初始化UI状态
     */
    initUI() {
      // 从localStorage恢复活跃Tab
      try {
        const savedTab = localStorage.getItem('trading-hub-active-tab');
        if (savedTab) {
          this.ui.activeTab = savedTab;
        }
      } catch (error) {
        logger.warn('恢复Tab状态失败:', error);
      }
    },
  },
});
