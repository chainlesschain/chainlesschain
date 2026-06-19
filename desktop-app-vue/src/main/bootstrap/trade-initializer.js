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
  // 拍卖管理器
  // ========================================
  factory.register({
    name: "auctionManager",
    dependsOn: ["database", "escrowManager", "assetManager"],
    async init(context) {
      const { AuctionManager } = require("../trade/auction-manager");
      const mgr = new AuctionManager(
        context.database,
        context.escrowManager,
        context.assetManager,
      );
      await mgr.initialize();
      return mgr;
    },
  });

  // ========================================
  // 团购管理器
  // ========================================
  factory.register({
    name: "groupBuyingManager",
    dependsOn: ["database", "escrowManager", "assetManager"],
    async init(context) {
      const { GroupBuyingManager } = require("../trade/group-buying-manager");
      const mgr = new GroupBuyingManager(
        context.database,
        context.escrowManager,
        context.assetManager,
      );
      await mgr.initialize();
      return mgr;
    },
  });

  // ========================================
  // 分期付款管理器
  // ========================================
  factory.register({
    name: "installmentManager",
    dependsOn: ["database", "escrowManager", "creditScoreManager"],
    async init(context) {
      const { InstallmentManager } = require("../trade/installment-manager");
      const mgr = new InstallmentManager(
        context.database,
        context.escrowManager,
        context.creditScoreManager,
      );
      await mgr.initialize();
      return mgr;
    },
  });

  // ========================================
  // 闪电网络支付管理器
  // ========================================
  factory.register({
    name: "lightningPaymentManager",
    dependsOn: ["database", "assetManager"],
    async init(context) {
      const { LightningPaymentManager } = require("../trade/lightning-payment");
      const mgr = new LightningPaymentManager(
        context.database,
        context.assetManager,
      );
      await mgr.initialize();
      return mgr;
    },
  });

  // ========================================
  // P2P借贷管理器
  // ========================================
  factory.register({
    name: "lendingManager",
    dependsOn: ["database", "creditScoreManager", "escrowManager"],
    async init(context) {
      const { LendingManager } = require("../defi/lending-manager");
      const mgr = new LendingManager(
        context.database,
        context.creditScoreManager,
        context.escrowManager,
      );
      await mgr.initialize();
      return mgr;
    },
  });

  // ========================================
  // 保险池管理器
  // ========================================
  factory.register({
    name: "insurancePoolManager",
    dependsOn: ["database", "assetManager"],
    async init(context) {
      const {
        InsurancePoolManager,
      } = require("../defi/insurance-pool-manager");
      const mgr = new InsurancePoolManager(
        context.database,
        context.assetManager,
      );
      await mgr.initialize();
      return mgr;
    },
  });

  // ========================================
  // 跨链原子互换管理器
  // ========================================
  factory.register({
    name: "atomicSwapManager",
    dependsOn: ["database"],
    async init(context) {
      const { AtomicSwapManager } = require("../defi/atomic-swap-manager");
      const bridgeManager = context.blockchainModules?.bridgeManager || null;
      const mgr = new AtomicSwapManager(context.database, bridgeManager);
      await mgr.initialize();
      return mgr;
    },
  });

  // ========================================
  // 结算 escrow（core-settlement 集成 adapter）
  // ========================================
  // 把 @chainlesschain/core-settlement（联邦签名转账日志账本 + multisig 门控托管
  // escrow）桥接到桌面：复用本机 DID 身份签转账、复用桌面 db、release 放款经
  // governanceMultiSig 门控（fail-closed：无达阈提案不放款）。
  // 单节点联邦默认：本机身份同时担任 genesis（发 credits）与 custodian（托管）；
  // 跨设备联邦由各成员后续注册公钥 + 独立 custodian（follow-up）。
  // 详见 ../trade/settlement-escrow.js。
  factory.register({
    name: "settlementEscrow",
    dependsOn: ["database", "didManager", "governanceMultiSig"],
    required: false,
    async init(context) {
      const settlement = require("@chainlesschain/core-settlement");
      const {
        createSettlementEscrow,
        naclIdentityToMember,
      } = require("../trade/settlement-escrow.js");

      const identity = context.didManager.getCurrentIdentity();
      if (!identity || !identity.did) {
        logger.warn(
          "[Trade] settlementEscrow：当前无 DID 身份，结算 escrow 暂不激活（创建身份后重启生效）",
        );
        return null;
      }

      const db = context.database && context.database.db;
      if (!db) {
        logger.warn("[Trade] settlementEscrow：数据库句柄不可用，跳过");
        return null;
      }

      // 单节点联邦：本机身份既是 genesis 也是 custodian。
      const localMember = naclIdentityToMember(identity);
      const ledgerId = "desktop-fed";

      // 放款门控：接 governanceMultiSig（M-of-N 达阈才放款）。
      //  - community = ledgerId；proposalId 由开 hold 方携带。
      //  - fail-closed：无 governanceMultiSig / 缺 proposalId / 未达阈 → 不放款。
      const gov = context.governanceMultiSig || null;
      const proposalGate = (proposalId) => {
        if (!gov) {
          return {
            releasable: false,
            reason: "governance_multisig_unavailable",
          };
        }
        if (!proposalId) {
          return { releasable: false, reason: "no_proposal_id" };
        }
        try {
          const st = gov.getStatus(ledgerId, proposalId);
          if (st && st.complete) {
            return { releasable: true };
          }
          return {
            releasable: false,
            reason: `threshold_${st ? st.collected : 0}/${st ? st.threshold : "?"}`,
          };
        } catch (_err) {
          // 提案不存在（_readProposal 抛错）→ 不放款
          return { releasable: false, reason: "proposal_not_found" };
        }
      };

      const escrow = createSettlementEscrow({
        settlement,
        db,
        ledgerId,
        genesis: localMember,
        custodian: localMember,
        proposalGate,
      });
      logger.info(
        `[Trade] ✓ settlementEscrow 初始化成功（ledger=${ledgerId}, member=${identity.did}）`,
      );
      return escrow;
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
