/**
 * 交易模块初始化器
 * 负责资产管理、托管、市场、智能合约等交易相关模块的初始化
 *
 * @module bootstrap/trade-initializer
 */

const { logger } = require("../utils/logger.js");

/**
 * 注册交易模块初始化器
 * @param {import('./initializer-factory').InitializerFactory} factory - 初始化器工厂
 */
function registerTradeInitializers(factory) {
  // ========================================
  // 资产管理器
  // ========================================
  factory.register({
    name: "assetManager",
    dependsOn: ["database", "didManager", "p2pManager"],
    async init(context) {
      const { AssetManager } = require("../trade/asset-manager");
      const assetManager = new AssetManager(
        context.database,
        context.didManager,
        context.p2pManager,
      );
      await assetManager.initialize();
      return assetManager;
    },
  });

  // ========================================
  // 托管管理器
  // ========================================
  factory.register({
    name: "escrowManager",
    dependsOn: ["database", "didManager", "assetManager"],
    async init(context) {
      const { EscrowManager } = require("../trade/escrow-manager");
      const escrowManager = new EscrowManager(
        context.database,
        context.didManager,
        context.assetManager,
      );
      await escrowManager.initialize();
      return escrowManager;
    },
  });

  // ========================================
  // 交易市场管理器
  // ========================================
  factory.register({
    name: "marketplaceManager",
    dependsOn: ["database", "didManager", "assetManager", "escrowManager"],
    async init(context) {
      const { MarketplaceManager } = require("../trade/marketplace-manager");
      const marketplaceManager = new MarketplaceManager(
        context.database,
        context.didManager,
        context.assetManager,
        context.escrowManager,
      );
      await marketplaceManager.initialize();
      return marketplaceManager;
    },
  });

  // ========================================
  // 智能合约引擎
  // ========================================
  factory.register({
    name: "contractEngine",
    dependsOn: ["database", "didManager", "assetManager", "escrowManager"],
    async init(context) {
      const { SmartContractEngine } = require("../trade/contract-engine");
      const contractEngine = new SmartContractEngine(
        context.database,
        context.didManager,
        context.assetManager,
        context.escrowManager,
      );
      await contractEngine.initialize();
      return contractEngine;
    },
  });

  // ========================================
  // 知识付费管理器
  // ========================================
  factory.register({
    name: "knowledgePaymentManager",
    dependsOn: ["database", "assetManager", "p2pManager"],
    async init(context) {
      const KnowledgePaymentManager = require("../trade/knowledge-payment");
      const knowledgePaymentManager = new KnowledgePaymentManager(
        context.database,
        context.assetManager,
        context.p2pManager,
      );
      await knowledgePaymentManager.initialize();
      return knowledgePaymentManager;
    },
  });

  // ========================================
  // 信用评分管理器
  // ========================================
  factory.register({
    name: "creditScoreManager",
    dependsOn: ["database"],
    async init(context) {
      const CreditScoreManager = require("../trade/credit-score");
      return new CreditScoreManager(context.database);
    },
  });

  // ========================================
  // 评价管理器
  // ========================================
  factory.register({
    name: "reviewManager",
    dependsOn: ["database"],
    async init(context) {
      const ReviewManager = require("../trade/review-manager");
      return new ReviewManager(context.database);
    },
  });

  // ========================================
  // 项目统计收集器
  // ========================================
  factory.register({
    name: "statsCollector",
    dependsOn: ["database"],
    async init(context) {
      const { ProjectStatsCollector } = require("../project/stats-collector");
      return new ProjectStatsCollector(context.database.db);
    },
  });
}

module.exports = { registerTradeInitializers };
