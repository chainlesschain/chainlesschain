/**
 * Trade Store - 交易模块主Store
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

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

// ===== 资产相关类型 =====

/**
 * 资产类型
 */
export type AssetType = 'token' | 'nft' | 'knowledge' | 'service';

/**
 * 资产信息
 */
export interface Asset {
  id: string;
  name: string;
  symbol: string;
  asset_type: AssetType;
  owner_did: string;
  total_supply?: number;
  metadata?: any;
  created_at?: number;
  [key: string]: any;
}

/**
 * 资产创建选项
 */
export interface AssetCreateOptions {
  name: string;
  symbol: string;
  asset_type: AssetType;
  owner_did: string;
  total_supply?: number;
  metadata?: any;
  [key: string]: any;
}

/**
 * 资产历史记录
 */
export interface AssetHistoryRecord {
  id: string;
  asset_id: string;
  action: string;
  amount?: number;
  from_did?: string;
  to_did?: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * 资产余额映射
 */
export type AssetBalances = Record<string, number>;

/**
 * 资产状态
 */
export interface AssetState {
  myAssets: Asset[];
  allAssets: Asset[];
  currentAsset: Asset | null;
  assetHistory: AssetHistoryRecord[];
  balances: AssetBalances;
  loading: boolean;
  creating: boolean;
}

// ===== 交易市场相关类型 =====

/**
 * 订单类型
 */
export type OrderType = 'buy' | 'sell' | 'service' | 'barter';

/**
 * 订单状态
 */
export type OrderStatus = 'open' | 'closed' | 'cancelled';

/**
 * 市场订单
 */
export interface MarketOrder {
  id: string;
  order_type: OrderType;
  title: string;
  description?: string;
  price: number;
  quantity: number;
  asset_id?: string;
  seller_did: string;
  status: OrderStatus;
  created_at?: number;
  [key: string]: any;
}

/**
 * 交易记录
 */
export interface Transaction {
  id: string;
  order_id: string;
  buyer_did: string;
  seller_did: string;
  amount: number;
  status: string;
  created_at?: number;
  [key: string]: any;
}

/**
 * 市场筛选条件
 */
export interface MarketplaceFilters {
  orderType: OrderType | '';
  status: OrderStatus | '';
  searchKeyword: string;
}

/**
 * 创建订单选项
 */
export interface CreateOrderOptions {
  order_type: OrderType;
  title: string;
  description?: string;
  price: number;
  quantity: number;
  asset_id?: string;
  seller_did: string;
  [key: string]: any;
}

/**
 * 市场状态
 */
export interface MarketplaceState {
  orders: MarketOrder[];
  myCreatedOrders: MarketOrder[];
  myPurchasedOrders: MarketOrder[];
  transactions: Transaction[];
  currentOrder: MarketOrder | null;
  filters: MarketplaceFilters;
  loading: boolean;
  purchasing: boolean;
}

// ===== 托管相关类型 =====

/**
 * 托管状态类型
 */
export type EscrowStatus = 'locked' | 'released' | 'refunded' | 'disputed';

/**
 * 托管信息
 */
export interface Escrow {
  id: string;
  transaction_id: string;
  amount: number;
  status: EscrowStatus;
  buyer_did: string;
  seller_did: string;
  created_at?: number;
  [key: string]: any;
}

/**
 * 托管历史记录
 */
export interface EscrowHistoryRecord {
  id: string;
  escrow_id: string;
  action: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * 托管统计
 */
export interface EscrowStatistics {
  total: number;
  locked: number;
  released: number;
  refunded: number;
  disputed: number;
}

/**
 * 托管状态
 */
export interface EscrowState {
  escrows: Escrow[];
  currentEscrow: Escrow | null;
  escrowHistory: EscrowHistoryRecord[];
  statistics: EscrowStatistics;
  loading: boolean;
}

// ===== 智能合约相关类型 =====

/**
 * 合约状态类型
 */
export type ContractStatus = 'draft' | 'active' | 'completed' | 'cancelled';

/**
 * 合约信息
 */
export interface Contract {
  id: string;
  title: string;
  template_type?: string;
  status: ContractStatus;
  parties: string[];
  created_at?: number;
  [key: string]: any;
}

/**
 * 合约模板
 */
export interface ContractTemplate {
  id: string;
  name: string;
  template_type: string;
  content: string;
  [key: string]: any;
}

/**
 * 合约条件
 */
export interface ContractCondition {
  id: string;
  contract_id: string;
  condition_type: string;
  value: any;
  status: string;
  [key: string]: any;
}

/**
 * 合约事件
 */
export interface ContractEvent {
  id: string;
  contract_id: string;
  event_type: string;
  data: any;
  timestamp: number;
  [key: string]: any;
}

/**
 * 合约签名
 */
export interface ContractSignature {
  id: string;
  contract_id: string;
  signer_did: string;
  signature: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * 合约筛选条件
 */
export interface ContractFilters {
  status: ContractStatus | '';
  templateType: string;
}

/**
 * 创建合约选项
 */
export interface CreateContractOptions {
  title: string;
  template_type?: string;
  parties: string[];
  conditions?: any[];
  [key: string]: any;
}

/**
 * 合约状态
 */
export interface ContractState {
  contracts: Contract[];
  templates: ContractTemplate[];
  currentContract: Contract | null;
  conditions: ContractCondition[];
  events: ContractEvent[];
  signatures: ContractSignature[];
  filters: ContractFilters;
  loading: boolean;
  executing: boolean;
}

// ===== 信用评分相关类型 =====

/**
 * 信用等级
 */
export type CreditLevel = 'diamond' | 'gold' | 'silver' | 'bronze' | 'newbie';

/**
 * 用户信用信息
 */
export interface UserCredit {
  user_did: string;
  credit_score: number;
  credit_level: CreditLevel;
  total_transactions: number;
  successful_transactions: number;
  [key: string]: any;
}

/**
 * 评分历史记录
 */
export interface ScoreHistoryRecord {
  id: string;
  user_did: string;
  score_change: number;
  reason: string;
  timestamp: number;
  [key: string]: any;
}

/**
 * 排行榜项
 */
export interface LeaderboardItem {
  rank: number;
  user_did: string;
  credit_score: number;
  credit_level: CreditLevel;
  [key: string]: any;
}

/**
 * 信用统计
 */
export interface CreditStatistics {
  totalUsers: number;
  averageScore: number;
  levelDistribution: Record<CreditLevel, number>;
  [key: string]: any;
}

/**
 * 信用状态
 */
export interface CreditState {
  userCredit: UserCredit | null;
  scoreHistory: ScoreHistoryRecord[];
  leaderboard: LeaderboardItem[];
  statistics: CreditStatistics | null;
  loading: boolean;
}

// ===== 评价相关类型 =====

/**
 * 评价目标类型
 */
export type ReviewTargetType = 'order' | 'user' | 'content' | 'service';

/**
 * 评价信息
 */
export interface Review {
  id: string;
  target_id: string;
  target_type: ReviewTargetType;
  reviewer_did: string;
  rating: number;
  content: string;
  reply?: string;
  helpful_count?: number;
  created_at?: number;
  [key: string]: any;
}

/**
 * 创建评价选项
 */
export interface CreateReviewOptions {
  target_id: string;
  target_type: ReviewTargetType;
  reviewer_did: string;
  rating: number;
  content: string;
  [key: string]: any;
}

/**
 * 评价统计
 */
export interface ReviewStatistics {
  totalReviews: number;
  averageRating: number;
  ratingDistribution: Record<number, number>;
  [key: string]: any;
}

/**
 * 评价状态
 */
export interface ReviewState {
  reviews: Review[];
  myReviews: Review[];
  targetReviews: Review[];
  statistics: ReviewStatistics | null;
  currentReview: Review | null;
  loading: boolean;
}

// ===== 知识付费相关类型 =====

/**
 * 内容类型
 */
export type ContentType = 'article' | 'video' | 'audio' | 'course' | 'ebook';

/**
 * 知识内容
 */
export interface KnowledgeContent {
  id: string;
  title: string;
  content_type: ContentType;
  creator_did: string;
  price: number;
  encrypted_content?: string;
  preview?: string;
  created_at?: number;
  [key: string]: any;
}

/**
 * 创建内容选项
 */
export interface CreateContentOptions {
  title: string;
  content_type: ContentType;
  creator_did: string;
  price: number;
  content: string;
  preview?: string;
  [key: string]: any;
}

/**
 * 购买记录
 */
export interface PurchaseRecord {
  id: string;
  content_id: string;
  buyer_did: string;
  amount: number;
  timestamp: number;
  [key: string]: any;
}

/**
 * 订阅计划
 */
export interface SubscriptionPlan {
  id: string;
  creator_did: string;
  name: string;
  price: number;
  duration_days: number;
  benefits: string[];
  [key: string]: any;
}

/**
 * 订阅记录
 */
export interface Subscription {
  id: string;
  plan_id: string;
  subscriber_did: string;
  start_date: number;
  end_date: number;
  status: string;
  [key: string]: any;
}

/**
 * 创作者统计
 */
export interface CreatorStatistics {
  totalContents: number;
  totalPurchases: number;
  totalSubscribers: number;
  totalRevenue: number;
  [key: string]: any;
}

/**
 * 知识付费状态
 */
export interface KnowledgeState {
  contents: KnowledgeContent[];
  myContents: KnowledgeContent[];
  myPurchases: PurchaseRecord[];
  mySubscriptions: Subscription[];
  subscriptionPlans: SubscriptionPlan[];
  currentContent: KnowledgeContent | null;
  statistics: CreatorStatistics | null;
  loading: boolean;
}

// ===== UI状态 =====

/**
 * 活动Tab类型
 */
export type ActiveTab = 'marketplace' | 'assets' | 'escrow' | 'contracts' | 'credit' | 'knowledge';

/**
 * UI状态
 */
export interface UIState {
  activeTab: ActiveTab;
  selectedDid: string | null;
}

// ===== 完整Store状态 =====

/**
 * Trade Store 状态
 */
export interface TradeState {
  asset: AssetState;
  marketplace: MarketplaceState;
  escrow: EscrowState;
  contract: ContractState;
  credit: CreditState;
  review: ReviewState;
  knowledge: KnowledgeState;
  ui: UIState;
}

// ==================== Store ====================

export const useTradeStore = defineStore('trade', {
  state: (): TradeState => ({
    // ==================== 资产管理 ====================
    asset: {
      myAssets: [],
      allAssets: [],
      currentAsset: null,
      assetHistory: [],
      balances: {},
      loading: false,
      creating: false,
    },

    // ==================== 交易市场 ====================
    marketplace: {
      orders: [],
      myCreatedOrders: [],
      myPurchasedOrders: [],
      transactions: [],
      currentOrder: null,
      filters: {
        orderType: '',
        status: '',
        searchKeyword: '',
      },
      loading: false,
      purchasing: false,
    },

    // ==================== 托管管理 ====================
    escrow: {
      escrows: [],
      currentEscrow: null,
      escrowHistory: [],
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
      contracts: [],
      templates: [],
      currentContract: null,
      conditions: [],
      events: [],
      signatures: [],
      filters: {
        status: '',
        templateType: '',
      },
      loading: false,
      executing: false,
    },

    // ==================== 信用评分 ====================
    credit: {
      userCredit: null,
      scoreHistory: [],
      leaderboard: [],
      statistics: null,
      loading: false,
    },

    // ==================== 评价管理 ====================
    review: {
      reviews: [],
      myReviews: [],
      targetReviews: [],
      statistics: null,
      currentReview: null,
      loading: false,
    },

    // ==================== 知识付费 ====================
    knowledge: {
      contents: [],
      myContents: [],
      myPurchases: [],
      mySubscriptions: [],
      subscriptionPlans: [],
      currentContent: null,
      statistics: null,
      loading: false,
    },

    // ==================== UI状态 ====================
    ui: {
      activeTab: 'marketplace',
      selectedDid: null,
    },
  }),

  getters: {
    // ===== 资产 Getters =====

    /**
     * 根据ID获取资产
     */
    getAssetById(): (assetId: string) => Asset | undefined {
      return (assetId: string): Asset | undefined => {
        return (
          this.asset.allAssets.find((a) => a.id === assetId) ||
          this.asset.myAssets.find((a) => a.id === assetId)
        );
      };
    },

    /**
     * 我的通证资产
     */
    myTokenAssets(): Asset[] {
      return this.asset.myAssets.filter((a) => a.asset_type === 'token');
    },

    /**
     * 我的NFT资产
     */
    myNFTAssets(): Asset[] {
      return this.asset.myAssets.filter((a) => a.asset_type === 'nft');
    },

    /**
     * 我的知识产品
     */
    myKnowledgeAssets(): Asset[] {
      return this.asset.myAssets.filter((a) => a.asset_type === 'knowledge');
    },

    /**
     * 我的服务凭证
     */
    myServiceAssets(): Asset[] {
      return this.asset.myAssets.filter((a) => a.asset_type === 'service');
    },

    // ===== 市场 Getters =====

    /**
     * 过滤后的订单列表
     */
    filteredOrders(): MarketOrder[] {
      let orders = [...this.marketplace.orders];
      const { orderType, status, searchKeyword } = this.marketplace.filters;

      if (orderType) {
        orders = orders.filter((o) => o.order_type === orderType);
      }
      if (status) {
        orders = orders.filter((o) => o.status === status);
      }
      if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        orders = orders.filter(
          (o) =>
            o.title?.toLowerCase().includes(keyword) ||
            (o.description && o.description.toLowerCase().includes(keyword))
        );
      }

      return orders;
    },

    /**
     * 开放的订单（可购买）
     */
    openOrders(): MarketOrder[] {
      return this.marketplace.orders.filter((o) => o.status === 'open');
    },

    // ===== 合约 Getters =====

    /**
     * 过滤后的合约列表
     */
    filteredContracts(): Contract[] {
      let contracts = [...this.contract.contracts];
      const { status, templateType } = this.contract.filters;

      if (status) {
        contracts = contracts.filter((c) => c.status === status);
      }
      if (templateType) {
        contracts = contracts.filter((c) => c.template_type === templateType);
      }

      return contracts;
    },

    /**
     * 活跃的合约
     */
    activeContracts(): Contract[] {
      return this.contract.contracts.filter((c) => c.status === 'active');
    },

    /**
     * 待签名的合约
     */
    pendingSignContracts(): Contract[] {
      return this.contract.contracts.filter((c) => c.status === 'draft');
    },

    // ===== 信用 Getters =====

    /**
     * 信用等级
     */
    creditLevel(): CreditLevel | null {
      if (!this.credit.userCredit) {
        return null;
      }
      return this.credit.userCredit.credit_level;
    },

    /**
     * 信用评分
     */
    creditScore(): number {
      if (!this.credit.userCredit) {
        return 0;
      }
      return this.credit.userCredit.credit_score;
    },

    /**
     * 信用等级颜色
     */
    creditLevelColor(): string {
      const score = this.credit.userCredit?.credit_score || 0;
      if (score >= 901) {
        return '#52c41a';
      } // 钻石 - 绿色
      if (score >= 601) {
        return '#faad14';
      } // 黄金 - 金色
      if (score >= 301) {
        return '#1890ff';
      } // 白银 - 蓝色
      if (score >= 101) {
        return '#8c8c8c';
      } // 青铜 - 灰色
      return '#d9d9d9'; // 新手 - 浅灰
    },
  },

  actions: {
    // ==================== 资产管理 Actions ====================

    /**
     * 加载我的资产
     */
    async loadMyAssets(ownerDid: string): Promise<void> {
      this.asset.loading = true;
      try {
        const assets: Asset[] = await (window as any).electronAPI.asset.getByOwner(ownerDid);
        this.asset.myAssets = assets || [];

        // 同时加载余额
        for (const asset of this.asset.myAssets) {
          try {
            const balance: number = await (window as any).electronAPI.asset.getBalance(
              ownerDid,
              asset.id
            );
            this.asset.balances[asset.id] = balance || 0;
          } catch (error) {
            logger.warn(`加载资产 ${asset.id} 余额失败:`, error as any);
            this.asset.balances[asset.id] = 0;
          }
        }
      } catch (error) {
        logger.error('加载我的资产失败:', error as any);
        throw error;
      } finally {
        this.asset.loading = false;
      }
    },

    /**
     * 加载所有资产
     */
    async loadAllAssets(filters: Record<string, any> = {}): Promise<void> {
      this.asset.loading = true;
      try {
        const assets: Asset[] = await (window as any).electronAPI.asset.getAll(filters);
        this.asset.allAssets = assets || [];
      } catch (error) {
        logger.error('加载所有资产失败:', error as any);
        throw error;
      } finally {
        this.asset.loading = false;
      }
    },

    /**
     * 创建资产
     */
    async createAsset(options: AssetCreateOptions): Promise<Asset> {
      this.asset.creating = true;
      try {
        const asset: Asset = await (window as any).electronAPI.asset.create(options);
        this.asset.myAssets.push(asset);
        return asset;
      } catch (error) {
        logger.error('创建资产失败:', error as any);

        // 友好错误提示
        let userMessage = '创建资产失败';
        if ((error as Error).message.includes('DID')) {
          userMessage = '请先创建DID身份';
        } else if ((error as Error).message.includes('symbol')) {
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
    async transferAsset(
      assetId: string,
      toDid: string,
      amount: number,
      memo?: string
    ): Promise<Transaction> {
      try {
        const tx: Transaction = await (window as any).electronAPI.asset.transfer(
          assetId,
          toDid,
          amount,
          memo
        );

        // 更新余额
        const ownerDid = this.ui.selectedDid;
        if (ownerDid) {
          const newBalance: number = await (window as any).electronAPI.asset.getBalance(
            ownerDid,
            assetId
          );
          this.asset.balances[assetId] = newBalance || 0;
        }

        return tx;
      } catch (error) {
        logger.error('转账失败:', error as any);
        throw error;
      }
    },

    /**
     * 铸造资产
     */
    async mintAsset(assetId: string, toDid: string, amount: number): Promise<any> {
      try {
        const result = await (window as any).electronAPI.asset.mint(assetId, toDid, amount);

        // 刷新资产列表
        if (this.ui.selectedDid) {
          await this.loadMyAssets(this.ui.selectedDid);
        }

        return result;
      } catch (error) {
        logger.error('铸造资产失败:', error as any);
        throw error;
      }
    },

    /**
     * 销毁资产
     */
    async burnAsset(assetId: string, amount: number): Promise<any> {
      try {
        const result = await (window as any).electronAPI.asset.burn(assetId, amount);

        // 更新余额
        const ownerDid = this.ui.selectedDid;
        if (ownerDid) {
          const newBalance: number = await (window as any).electronAPI.asset.getBalance(
            ownerDid,
            assetId
          );
          this.asset.balances[assetId] = newBalance || 0;
        }

        return result;
      } catch (error) {
        logger.error('销毁资产失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载资产历史
     */
    async loadAssetHistory(assetId: string, limit: number = 50): Promise<void> {
      try {
        const history: AssetHistoryRecord[] = await (window as any).electronAPI.asset.getHistory(
          assetId,
          limit
        );
        this.asset.assetHistory = history || [];
      } catch (error) {
        logger.error('加载资产历史失败:', error as any);
        throw error;
      }
    },

    /**
     * 设置当前资产
     */
    setCurrentAsset(asset: Asset | null): void {
      this.asset.currentAsset = asset;
    },

    // ==================== 交易市场 Actions ====================

    /**
     * 加载订单列表
     */
    async loadOrders(filters: Record<string, any> = {}): Promise<void> {
      this.marketplace.loading = true;
      try {
        const orders: MarketOrder[] =
          await (window as any).electronAPI.marketplace.getOrders(filters);
        this.marketplace.orders = orders || [];
      } catch (error) {
        logger.error('加载订单失败:', error as any);
        throw error;
      } finally {
        this.marketplace.loading = false;
      }
    },

    /**
     * 加载我的订单
     */
    async loadMyOrders(userDid: string): Promise<void> {
      this.marketplace.loading = true;
      try {
        const result: { createdOrders: MarketOrder[]; purchasedOrders: MarketOrder[] } =
          await (window as any).electronAPI.marketplace.getMyOrders(userDid);
        this.marketplace.myCreatedOrders = result.createdOrders || [];
        this.marketplace.myPurchasedOrders = result.purchasedOrders || [];
      } catch (error) {
        logger.error('加载我的订单失败:', error as any);
        throw error;
      } finally {
        this.marketplace.loading = false;
      }
    },

    /**
     * 创建订单
     */
    async createOrder(options: CreateOrderOptions): Promise<MarketOrder> {
      try {
        const order: MarketOrder =
          await (window as any).electronAPI.marketplace.createOrder(options);
        this.marketplace.myCreatedOrders.push(order);
        this.marketplace.orders.push(order);
        return order;
      } catch (error) {
        logger.error('创建订单失败:', error as any);
        throw error;
      }
    },

    /**
     * 购买订单（匹配订单）
     */
    async purchaseOrder(orderId: string, quantity: number): Promise<Transaction> {
      this.marketplace.purchasing = true;
      try {
        const transaction: Transaction = await (window as any).electronAPI.marketplace.matchOrder(
          orderId,
          quantity
        );

        // 刷新订单和交易列表
        await this.loadOrders();
        await this.loadTransactions();

        return transaction;
      } catch (error) {
        logger.error('购买订单失败:', error as any);
        throw error;
      } finally {
        this.marketplace.purchasing = false;
      }
    },

    /**
     * 取消订单
     */
    async cancelOrder(orderId: string): Promise<void> {
      try {
        await (window as any).electronAPI.marketplace.cancelOrder(orderId);

        // 更新本地状态
        const orderIndex = this.marketplace.myCreatedOrders.findIndex((o) => o.id === orderId);
        if (orderIndex !== -1) {
          this.marketplace.myCreatedOrders[orderIndex].status = 'cancelled';
        }

        // 刷新订单列表
        await this.loadOrders();
      } catch (error) {
        logger.error('取消订单失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载交易记录
     */
    async loadTransactions(filters: Record<string, any> = {}): Promise<void> {
      try {
        const transactions: Transaction[] =
          await (window as any).electronAPI.marketplace.getTransactions(filters);
        this.marketplace.transactions = transactions || [];
      } catch (error) {
        logger.error('加载交易记录失败:', error as any);
        throw error;
      }
    },

    /**
     * 确认交付
     */
    async confirmDelivery(transactionId: string): Promise<void> {
      try {
        await (window as any).electronAPI.marketplace.confirmDelivery(transactionId);
        await this.loadTransactions();
      } catch (error) {
        logger.error('确认交付失败:', error as any);
        throw error;
      }
    },

    /**
     * 申请退款
     */
    async requestRefund(transactionId: string, reason: string): Promise<void> {
      try {
        await (window as any).electronAPI.marketplace.requestRefund(transactionId, reason);
        await this.loadTransactions();
      } catch (error) {
        logger.error('申请退款失败:', error as any);
        throw error;
      }
    },

    /**
     * 设置市场筛选条件
     */
    setMarketplaceFilter<K extends keyof MarketplaceFilters>(
      key: K,
      value: MarketplaceFilters[K]
    ): void {
      this.marketplace.filters[key] = value;
    },

    /**
     * 设置当前订单
     */
    setCurrentOrder(order: MarketOrder | null): void {
      this.marketplace.currentOrder = order;
    },

    // ==================== 托管管理 Actions ====================

    /**
     * 加载托管列表
     */
    async loadEscrows(filters: Record<string, any> = {}): Promise<void> {
      this.escrow.loading = true;
      try {
        const escrows: Escrow[] = await (window as any).electronAPI.escrow.getList(filters);
        this.escrow.escrows = escrows || [];
      } catch (error) {
        logger.error('加载托管列表失败:', error as any);
        throw error;
      } finally {
        this.escrow.loading = false;
      }
    },

    /**
     * 加载托管详情
     */
    async loadEscrowDetail(escrowId: string): Promise<void> {
      try {
        const escrow: Escrow = await (window as any).electronAPI.escrow.get(escrowId);
        this.escrow.currentEscrow = escrow;
      } catch (error) {
        logger.error('加载托管详情失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载托管历史
     */
    async loadEscrowHistory(escrowId: string): Promise<void> {
      try {
        const history: EscrowHistoryRecord[] =
          await (window as any).electronAPI.escrow.getHistory(escrowId);
        this.escrow.escrowHistory = history || [];
      } catch (error) {
        logger.error('加载托管历史失败:', error as any);
        throw error;
      }
    },

    /**
     * 发起托管争议
     */
    async disputeEscrow(escrowId: string, reason: string): Promise<void> {
      try {
        await (window as any).electronAPI.escrow.dispute(escrowId, reason);
        await this.loadEscrowDetail(escrowId);
        await this.loadEscrows();
      } catch (error) {
        logger.error('发起争议失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载托管统计
     */
    async loadEscrowStatistics(): Promise<void> {
      try {
        const statistics: EscrowStatistics =
          await (window as any).electronAPI.escrow.getStatistics();
        this.escrow.statistics = statistics || {
          total: 0,
          locked: 0,
          released: 0,
          refunded: 0,
          disputed: 0,
        };
      } catch (error) {
        logger.error('加载托管统计失败:', error as any);
        throw error;
      }
    },

    // ==================== 智能合约 Actions ====================

    /**
     * 加载合约列表
     */
    async loadContracts(filters: Record<string, any> = {}): Promise<void> {
      this.contract.loading = true;
      try {
        const contracts: Contract[] = await (window as any).electronAPI.contract.getList(filters);
        this.contract.contracts = contracts || [];
      } catch (error) {
        logger.error('加载合约失败:', error as any);
        throw error;
      } finally {
        this.contract.loading = false;
      }
    },

    /**
     * 加载合约模板
     */
    async loadContractTemplates(): Promise<void> {
      try {
        const templates: ContractTemplate[] =
          await (window as any).electronAPI.contract.getTemplates();
        this.contract.templates = templates || [];
      } catch (error) {
        logger.error('加载合约模板失败:', error as any);
        throw error;
      }
    },

    /**
     * 创建合约
     */
    async createContract(options: CreateContractOptions): Promise<Contract> {
      try {
        const contract: Contract = await (window as any).electronAPI.contract.create(options);
        this.contract.contracts.push(contract);
        return contract;
      } catch (error) {
        logger.error('创建合约失败:', error as any);
        throw error;
      }
    },

    /**
     * 从模板创建合约
     */
    async createContractFromTemplate(
      templateId: string,
      params: Record<string, any>
    ): Promise<Contract> {
      try {
        const contract: Contract = await (window as any).electronAPI.contract.createFromTemplate(
          templateId,
          params
        );
        this.contract.contracts.push(contract);
        return contract;
      } catch (error) {
        logger.error('从模板创建合约失败:', error as any);
        throw error;
      }
    },

    /**
     * 激活合约
     */
    async activateContract(contractId: string): Promise<void> {
      try {
        await (window as any).electronAPI.contract.activate(contractId);

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('激活合约失败:', error as any);
        throw error;
      }
    },

    /**
     * 签名合约
     */
    async signContract(contractId: string, signature: string): Promise<void> {
      try {
        await (window as any).electronAPI.contract.sign(contractId, signature);

        // 刷新合约详情
        const contract: Contract = await (window as any).electronAPI.contract.get(contractId);
        this.contract.currentContract = contract;

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('签名合约失败:', error as any);
        throw error;
      }
    },

    /**
     * 执行合约
     */
    async executeContract(contractId: string): Promise<void> {
      this.contract.executing = true;
      try {
        await (window as any).electronAPI.contract.execute(contractId);

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('执行合约失败:', error as any);
        throw error;
      } finally {
        this.contract.executing = false;
      }
    },

    /**
     * 取消合约
     */
    async cancelContract(contractId: string, reason: string): Promise<void> {
      try {
        await (window as any).electronAPI.contract.cancel(contractId, reason);

        // 刷新合约列表
        await this.loadContracts();
      } catch (error) {
        logger.error('取消合约失败:', error as any);
        throw error;
      }
    },

    /**
     * 检查合约条件
     */
    async checkContractConditions(contractId: string): Promise<any> {
      try {
        const result = await (window as any).electronAPI.contract.checkConditions(contractId);
        return result;
      } catch (error) {
        logger.error('检查合约条件失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载合约条件
     */
    async loadContractConditions(contractId: string): Promise<void> {
      try {
        const conditions: ContractCondition[] =
          await (window as any).electronAPI.contract.getConditions(contractId);
        this.contract.conditions = conditions || [];
      } catch (error) {
        logger.error('加载合约条件失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载合约事件
     */
    async loadContractEvents(contractId: string): Promise<void> {
      try {
        const events: ContractEvent[] =
          await (window as any).electronAPI.contract.getEvents(contractId);
        this.contract.events = events || [];
      } catch (error) {
        logger.error('加载合约事件失败:', error as any);
        throw error;
      }
    },

    /**
     * 发起仲裁
     */
    async initiateArbitration(contractId: string, reason: string, evidence: any): Promise<void> {
      try {
        await (window as any).electronAPI.contract.initiateArbitration(contractId, reason, evidence);
        await this.loadContracts();
      } catch (error) {
        logger.error('发起仲裁失败:', error as any);
        throw error;
      }
    },

    /**
     * 解决仲裁
     */
    async resolveArbitration(arbitrationId: string, resolution: any): Promise<void> {
      try {
        await (window as any).electronAPI.contract.resolveArbitration(arbitrationId, resolution);
        await this.loadContracts();
      } catch (error) {
        logger.error('解决仲裁失败:', error as any);
        throw error;
      }
    },

    /**
     * 设置合约筛选条件
     */
    setContractFilter<K extends keyof ContractFilters>(key: K, value: ContractFilters[K]): void {
      this.contract.filters[key] = value;
    },

    /**
     * 设置当前合约
     */
    setCurrentContract(contract: Contract | null): void {
      this.contract.currentContract = contract;
    },

    // ==================== 信用评分 Actions ====================

    /**
     * 加载用户信用信息
     */
    async loadUserCredit(userDid: string): Promise<void> {
      this.credit.loading = true;
      try {
        const credit: UserCredit =
          await (window as any).electronAPI.credit.getUserCredit(userDid);
        this.credit.userCredit = credit;
      } catch (error) {
        logger.error('加载信用信息失败:', error as any);
        throw error;
      } finally {
        this.credit.loading = false;
      }
    },

    /**
     * 更新信用评分
     */
    async updateCreditScore(userDid: string): Promise<void> {
      try {
        await (window as any).electronAPI.credit.updateScore(userDid);
        await this.loadUserCredit(userDid);
      } catch (error) {
        logger.error('更新信用评分失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载评分历史
     */
    async loadScoreHistory(userDid: string, limit: number = 50): Promise<void> {
      try {
        const history: ScoreHistoryRecord[] =
          await (window as any).electronAPI.credit.getScoreHistory(userDid, limit);
        this.credit.scoreHistory = history || [];
      } catch (error) {
        logger.error('加载评分历史失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载信用排行榜
     */
    async loadLeaderboard(limit: number = 50): Promise<void> {
      try {
        const leaderboard: LeaderboardItem[] =
          await (window as any).electronAPI.credit.getLeaderboard(limit);
        this.credit.leaderboard = leaderboard || [];
      } catch (error) {
        logger.error('加载排行榜失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载信用统计
     */
    async loadCreditStatistics(): Promise<void> {
      try {
        const statistics: CreditStatistics =
          await (window as any).electronAPI.credit.getStatistics();
        this.credit.statistics = statistics;
      } catch (error) {
        logger.error('加载信用统计失败:', error as any);
        throw error;
      }
    },

    // ==================== 评价管理 Actions ====================

    /**
     * 加载评价列表
     */
    async loadReviews(
      targetId: string,
      targetType: ReviewTargetType,
      filters: Record<string, any> = {}
    ): Promise<void> {
      this.review.loading = true;
      try {
        const reviews: Review[] = await (window as any).electronAPI.review.getByTarget(
          targetId,
          targetType,
          filters
        );
        this.review.targetReviews = reviews || [];
      } catch (error) {
        logger.error('加载评价失败:', error as any);
        throw error;
      } finally {
        this.review.loading = false;
      }
    },

    /**
     * 加载我的评价
     */
    async loadMyReviews(userDid: string): Promise<void> {
      this.review.loading = true;
      try {
        const reviews: Review[] =
          await (window as any).electronAPI.review.getMyReviews(userDid);
        this.review.myReviews = reviews || [];
      } catch (error) {
        logger.error('加载我的评价失败:', error as any);
        throw error;
      } finally {
        this.review.loading = false;
      }
    },

    /**
     * 创建评价
     */
    async createReview(options: CreateReviewOptions): Promise<Review> {
      try {
        const review: Review = await (window as any).electronAPI.review.create(options);
        this.review.myReviews.push(review);
        return review;
      } catch (error) {
        logger.error('创建评价失败:', error as any);
        throw error;
      }
    },

    /**
     * 更新评价
     */
    async updateReview(reviewId: string, updates: Partial<Review>): Promise<Review> {
      try {
        const review: Review = await (window as any).electronAPI.review.update(reviewId, updates);

        // 更新本地列表
        const index = this.review.myReviews.findIndex((r) => r.id === reviewId);
        if (index !== -1) {
          this.review.myReviews[index] = review;
        }

        return review;
      } catch (error) {
        logger.error('更新评价失败:', error as any);
        throw error;
      }
    },

    /**
     * 回复评价
     */
    async replyToReview(reviewId: string, content: string): Promise<void> {
      try {
        await (window as any).electronAPI.review.reply(reviewId, content);

        // 刷新评价详情
        const review: Review = await (window as any).electronAPI.review.get(reviewId);
        this.review.currentReview = review;
      } catch (error) {
        logger.error('回复评价失败:', error as any);
        throw error;
      }
    },

    /**
     * 标记评价为有帮助/无帮助
     */
    async markReviewHelpful(reviewId: string, helpful: boolean): Promise<void> {
      try {
        await (window as any).electronAPI.review.markHelpful(reviewId, helpful);
      } catch (error) {
        logger.error('标记评价失败:', error as any);
        throw error;
      }
    },

    /**
     * 举报评价
     */
    async reportReview(reviewId: string, reason: string, description: string): Promise<void> {
      try {
        await (window as any).electronAPI.review.report(reviewId, reason, description);
      } catch (error) {
        logger.error('举报评价失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载评价统计
     */
    async loadReviewStatistics(targetId: string, targetType: ReviewTargetType): Promise<void> {
      try {
        const statistics: ReviewStatistics = await (window as any).electronAPI.review.getStatistics(
          targetId,
          targetType
        );
        this.review.statistics = statistics;
      } catch (error) {
        logger.error('加载评价统计失败:', error as any);
        throw error;
      }
    },

    // ==================== 知识付费 Actions ====================

    /**
     * 加载知识内容列表
     */
    async loadKnowledgeContents(filters: Record<string, any> = {}): Promise<void> {
      this.knowledge.loading = true;
      try {
        const contents: KnowledgeContent[] =
          await (window as any).electronAPI.knowledge.listContents(filters);
        this.knowledge.contents = contents || [];
      } catch (error) {
        logger.error('加载知识内容失败:', error as any);
        throw error;
      } finally {
        this.knowledge.loading = false;
      }
    },

    /**
     * 加载我的创作内容
     */
    async loadMyContents(creatorDid: string): Promise<void> {
      try {
        const contents: KnowledgeContent[] =
          await (window as any).electronAPI.knowledge.listContents({ creator_did: creatorDid });
        this.knowledge.myContents = contents || [];
      } catch (error) {
        logger.error('加载我的内容失败:', error as any);
        throw error;
      }
    },

    /**
     * 创建知识内容
     */
    async createKnowledgeContent(options: CreateContentOptions): Promise<KnowledgeContent> {
      try {
        const content: KnowledgeContent =
          await (window as any).electronAPI.knowledge.createContent(options);
        this.knowledge.myContents.push(content);
        return content;
      } catch (error) {
        logger.error('创建知识内容失败:', error as any);
        throw error;
      }
    },

    /**
     * 更新知识内容
     */
    async updateKnowledgeContent(
      contentId: string,
      updates: Partial<KnowledgeContent>
    ): Promise<KnowledgeContent> {
      try {
        const content: KnowledgeContent = await (window as any).electronAPI.knowledge.updateContent(
          contentId,
          updates
        );

        // 更新本地列表
        const index = this.knowledge.myContents.findIndex((c) => c.id === contentId);
        if (index !== -1) {
          this.knowledge.myContents[index] = content;
        }

        return content;
      } catch (error) {
        logger.error('更新知识内容失败:', error as any);
        throw error;
      }
    },

    /**
     * 购买内容
     */
    async purchaseContent(contentId: string, paymentAssetId: string): Promise<PurchaseRecord> {
      try {
        const purchase: PurchaseRecord =
          await (window as any).electronAPI.knowledge.purchaseContent(contentId, paymentAssetId);
        this.knowledge.myPurchases.push(purchase);
        return purchase;
      } catch (error) {
        logger.error('购买内容失败:', error as any);
        throw error;
      }
    },

    /**
     * 订阅创作者
     */
    async subscribeToCreator(planId: string, paymentAssetId: string): Promise<Subscription> {
      try {
        const subscription: Subscription = await (window as any).electronAPI.knowledge.subscribe(
          planId,
          paymentAssetId
        );
        this.knowledge.mySubscriptions.push(subscription);
        return subscription;
      } catch (error) {
        logger.error('订阅失败:', error as any);
        throw error;
      }
    },

    /**
     * 取消订阅
     */
    async unsubscribe(planId: string): Promise<void> {
      try {
        await (window as any).electronAPI.knowledge.unsubscribe(planId);

        // 从本地列表移除
        const index = this.knowledge.mySubscriptions.findIndex((s) => s.plan_id === planId);
        if (index !== -1) {
          this.knowledge.mySubscriptions.splice(index, 1);
        }
      } catch (error) {
        logger.error('取消订阅失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载我的购买记录
     */
    async loadMyPurchases(userDid: string): Promise<void> {
      try {
        const purchases: PurchaseRecord[] =
          await (window as any).electronAPI.knowledge.getMyPurchases(userDid);
        this.knowledge.myPurchases = purchases || [];
      } catch (error) {
        logger.error('加载购买记录失败:', error as any);
        throw error;
      }
    },

    /**
     * 加载我的订阅
     */
    async loadMySubscriptions(userDid: string): Promise<void> {
      try {
        const subscriptions: Subscription[] =
          await (window as any).electronAPI.knowledge.getMySubscriptions(userDid);
        this.knowledge.mySubscriptions = subscriptions || [];
      } catch (error) {
        logger.error('加载订阅记录失败:', error as any);
        throw error;
      }
    },

    /**
     * 访问内容（解密）
     */
    async accessContent(contentId: string): Promise<KnowledgeContent> {
      try {
        const content: KnowledgeContent =
          await (window as any).electronAPI.knowledge.accessContent(contentId);
        this.knowledge.currentContent = content;
        return content;
      } catch (error) {
        logger.error('访问内容失败:', error as any);
        throw error;
      }
    },

    /**
     * 检查内容访问权限
     */
    async checkContentAccess(contentId: string, userDid: string): Promise<boolean> {
      try {
        const hasAccess: boolean = await (window as any).electronAPI.knowledge.checkAccess(
          contentId,
          userDid
        );
        return hasAccess;
      } catch (error) {
        logger.error('检查访问权限失败:', error as any);
        return false;
      }
    },

    /**
     * 加载知识统计（创作者）
     */
    async loadKnowledgeStatistics(creatorDid: string): Promise<void> {
      try {
        const statistics: CreatorStatistics =
          await (window as any).electronAPI.knowledge.getStatistics(creatorDid);
        this.knowledge.statistics = statistics;
      } catch (error) {
        logger.error('加载知识统计失败:', error as any);
        throw error;
      }
    },

    // ==================== UI状态 ====================

    /**
     * 设置活跃Tab
     */
    setActiveTab(tab: ActiveTab): void {
      this.ui.activeTab = tab;
      // 保存到localStorage
      try {
        localStorage.setItem('trading-hub-active-tab', tab);
      } catch (error) {
        logger.warn('保存Tab状态失败:', error as any);
      }
    },

    /**
     * 设置选中的DID
     */
    setSelectedDid(did: string | null): void {
      this.ui.selectedDid = did;
    },

    /**
     * 初始化UI状态
     */
    initUI(): void {
      // 从localStorage恢复活跃Tab
      try {
        const savedTab = localStorage.getItem('trading-hub-active-tab') as ActiveTab | null;
        if (savedTab) {
          this.ui.activeTab = savedTab;
        }
      } catch (error) {
        logger.warn('恢复Tab状态失败:', error as any);
      }
    },
  },
});
