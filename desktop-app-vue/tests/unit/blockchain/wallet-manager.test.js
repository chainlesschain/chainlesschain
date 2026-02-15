/**
 * 钱包管理器单元测试
 * 测试目标: src/main/blockchain/wallet-manager.js
 *
 * Mock strategy:
 * - logger: vi.mock (relative path)
 * - uuid: vi.mock (ESM, frozen namespace can't use spyOn)
 * - ethers: vi.mock (ESM)
 * - bip39/hdkey: vi.spyOn on actual module default (CJS interop)
 * - crypto: real Node.js crypto
 * - database: stateful mock via constructor injection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";

// ============================================================
// vi.hoisted() - references survive mockReset:true
// ============================================================
const mocks = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const mockUuidV4 = vi.fn();

  const mockWalletInstance = {
    address: "",
    privateKey: "",
    signTransaction: vi.fn(),
    signMessage: vi.fn(),
    connect: vi.fn(),
  };

  const mockContractInstance = {
    balanceOf: vi.fn(),
  };

  const mockEthers = {
    Wallet: vi.fn(),
    formatEther: vi.fn(),
    hashMessage: vi.fn(),
    recoverAddress: vi.fn(),
    Signature: { from: vi.fn() },
    Transaction: { from: vi.fn() },
    Contract: vi.fn(),
  };

  const mockHDKeyDerivedNode = {
    privateKey: null,
  };

  const mockHDKeyInstance = {
    derive: vi.fn(),
  };

  return {
    mockLogger,
    mockUuidV4,
    mockWalletInstance,
    mockContractInstance,
    mockEthers,
    mockHDKeyDerivedNode,
    mockHDKeyInstance,
  };
});

// ============================================================
// vi.mock declarations
// ============================================================
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: mocks.mockLogger,
  createLogger: vi.fn(() => mocks.mockLogger),
}));

vi.mock("uuid", () => ({
  v4: mocks.mockUuidV4,
}));

vi.mock("ethers", () => ({
  ethers: mocks.mockEthers,
}));

// ============================================================
// Constants
// ============================================================
const TEST_PASSWORD = "password123";
const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_PRIVATE_KEY_HEX =
  "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const TEST_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";
const TEST_WALLET_ID = "test-wallet-id-123";

// ============================================================
// Stateful Database Mock
// ============================================================
function createMockDatabase() {
  const records = new Map();

  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
    return {
      run: (...params) => {
        if (s.includes("insert into blockchain_wallets")) {
          if (s.includes("mnemonic_encrypted")) {
            // 10-column INSERT (createWallet / importFromMnemonic)
            records.set(params[0], {
              id: params[0],
              address: params[1],
              wallet_type: params[2],
              provider: params[3],
              encrypted_private_key: params[4],
              mnemonic_encrypted: params[5],
              derivation_path: params[6],
              chain_id: params[7],
              is_default: params[8],
              created_at: params[9],
            });
          } else {
            // 9-column INSERT (importFromPrivateKey)
            records.set(params[0], {
              id: params[0],
              address: params[1],
              wallet_type: params[2],
              provider: params[3],
              encrypted_private_key: params[4],
              mnemonic_encrypted: null,
              derivation_path: params[5],
              chain_id: params[6],
              is_default: params[7],
              created_at: params[8],
            });
          }
        } else if (
          s.includes("update") &&
          s.includes("is_default = 0") &&
          !s.includes("where")
        ) {
          for (const rec of records.values()) {
            rec.is_default = 0;
          }
        } else if (
          s.includes("update") &&
          s.includes("is_default = 1") &&
          s.includes("where")
        ) {
          const rec = records.get(params[0]);
          if (rec) {
            rec.is_default = 1;
          }
        } else if (s.includes("delete from blockchain_wallets")) {
          records.delete(params[0]);
        }
      },
      get: (...params) => {
        if (s.includes("select 1 from blockchain_wallets")) {
          return { 1: 1 };
        }
        if (s.includes("where id =")) {
          return records.get(params[0]) || undefined;
        }
        if (s.includes("lower(address)")) {
          const addr = params[0].toLowerCase();
          for (const rec of records.values()) {
            if (rec.address.toLowerCase() === addr) {
              return rec;
            }
          }
          return undefined;
        }
        return undefined;
      },
      all: () =>
        Array.from(records.values()).sort((a, b) => {
          if (b.is_default !== a.is_default) {
            return b.is_default - a.is_default;
          }
          return (b.created_at || 0) - (a.created_at || 0);
        }),
    };
  }

  return {
    db: {
      prepare,
      transaction:
        (fn) =>
        (...args) =>
          fn(...args),
    },
    _records: records,
  };
}

// ============================================================
// Test Suite
// ============================================================
describe("WalletManager", () => {
  let WalletManager;
  let WalletType;
  let WalletProvider;
  let walletManager;
  let mockDatabase;
  let mockUKeyManager;
  let mockBlockchainAdapter;
  let actualBip39;
  let actualHDKey;

  beforeEach(async () => {
    mockDatabase = createMockDatabase();

    mockUKeyManager = {
      sign: vi.fn().mockResolvedValue(Buffer.alloc(64, 0xaa)),
    };

    mockBlockchainAdapter = {
      currentChainId: 1,
      switchChain: vi.fn().mockResolvedValue(undefined),
      getProvider: vi.fn(() => ({
        getBalance: vi.fn().mockResolvedValue(BigInt("1000000000000000000")),
      })),
    };

    // Re-setup hoisted mocks (cleared by mockReset:true)
    mocks.mockUuidV4.mockReturnValue(TEST_WALLET_ID);

    mocks.mockWalletInstance.address = TEST_ADDRESS;
    mocks.mockWalletInstance.privateKey = "0x" + TEST_PRIVATE_KEY_HEX;
    mocks.mockWalletInstance.signTransaction.mockResolvedValue("0x_signed_tx");
    mocks.mockWalletInstance.signMessage.mockResolvedValue("0x_signed_message");
    mocks.mockWalletInstance.connect.mockReturnValue(mocks.mockWalletInstance);

    mocks.mockEthers.Wallet.mockImplementation(() => mocks.mockWalletInstance);
    mocks.mockEthers.formatEther.mockReturnValue("1.0");
    mocks.mockEthers.hashMessage.mockReturnValue("0x" + "ab".repeat(32));
    mocks.mockEthers.recoverAddress.mockReturnValue(TEST_ADDRESS);
    mocks.mockEthers.Signature.from.mockReturnValue({
      serialized: "0x_signature",
    });
    mocks.mockEthers.Transaction.from.mockReturnValue({
      unsignedHash: "0x" + "cd".repeat(32),
      serialized: "0x_signed_tx_serialized",
      signature: null,
    });
    mocks.mockContractInstance.balanceOf.mockResolvedValue(
      BigInt("5000000000000000000"),
    );
    mocks.mockEthers.Contract.mockImplementation(
      () => mocks.mockContractInstance,
    );

    // SpyOn actual bip39 (CJS default)
    const bip39Mod = await vi.importActual("bip39");
    actualBip39 = bip39Mod.default || bip39Mod;
    vi.spyOn(actualBip39, "generateMnemonic").mockReturnValue(TEST_MNEMONIC);
    vi.spyOn(actualBip39, "validateMnemonic").mockImplementation(
      (m) => m === TEST_MNEMONIC,
    );
    vi.spyOn(actualBip39, "mnemonicToSeed").mockResolvedValue(Buffer.alloc(64));

    // SpyOn actual hdkey (CJS default)
    const hdkeyMod = await vi.importActual("hdkey");
    actualHDKey = hdkeyMod.default || hdkeyMod;
    mocks.mockHDKeyDerivedNode.privateKey = Buffer.from(
      TEST_PRIVATE_KEY_HEX,
      "hex",
    );
    mocks.mockHDKeyInstance.derive.mockReturnValue(mocks.mockHDKeyDerivedNode);
    vi.spyOn(actualHDKey, "fromMasterSeed").mockReturnValue(
      mocks.mockHDKeyInstance,
    );

    // Dynamic import of module under test
    const module =
      await import("../../../src/main/blockchain/wallet-manager.js");
    WalletManager = module.WalletManager;
    WalletType = module.WalletType;
    WalletProvider = module.WalletProvider;
  });

  afterEach(() => {
    if (walletManager) {
      walletManager.unlockedWallets.clear();
    }
    vi.restoreAllMocks();
  });

  // Helper
  async function helperCreateWallet(password = TEST_PASSWORD, chainId = 1) {
    return walletManager.createWallet(password, chainId);
  }

  // ============================================================
  // 1. Constructor
  // ============================================================
  describe("构造函数", () => {
    it("应该使用database创建实例", () => {
      walletManager = new WalletManager(mockDatabase);
      expect(walletManager.database).toBe(mockDatabase);
      expect(walletManager.ukeyManager).toBeNull();
      expect(walletManager.blockchainAdapter).toBeNull();
      expect(walletManager.unlockedWallets).toBeInstanceOf(Map);
      expect(walletManager.derivationPath).toBe("m/44'/60'/0'/0/0");
      expect(walletManager.initialized).toBe(false);
    });

    it("应该支持可选的ukeyManager参数", () => {
      walletManager = new WalletManager(mockDatabase, mockUKeyManager);
      expect(walletManager.ukeyManager).toBe(mockUKeyManager);
    });

    it("应该支持可选的blockchainAdapter参数", () => {
      walletManager = new WalletManager(
        mockDatabase,
        null,
        mockBlockchainAdapter,
      );
      expect(walletManager.blockchainAdapter).toBe(mockBlockchainAdapter);
    });

    it("应该继承EventEmitter", () => {
      walletManager = new WalletManager(mockDatabase);
      expect(typeof walletManager.on).toBe("function");
      expect(typeof walletManager.emit).toBe("function");
      expect(typeof walletManager.removeListener).toBe("function");
    });
  });

  // ============================================================
  // 2. Initialize
  // ============================================================
  describe("initialize", () => {
    it("应该成功初始化数据库表", async () => {
      walletManager = new WalletManager(mockDatabase);
      await walletManager.initialize();
      expect(walletManager.initialized).toBe(true);
      expect(mocks.mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("初始化钱包管理器"),
      );
    });

    it("应该在初始化后设置initialized标志", async () => {
      walletManager = new WalletManager(mockDatabase);
      expect(walletManager.initialized).toBe(false);
      await walletManager.initialize();
      expect(walletManager.initialized).toBe(true);
    });

    it("应该在表不存在时抛出错误", async () => {
      const brokenDb = {
        db: {
          prepare: () => ({
            get: () => {
              throw new Error("no such table: blockchain_wallets");
            },
          }),
          transaction:
            (fn) =>
            (...args) =>
              fn(...args),
        },
      };
      walletManager = new WalletManager(brokenDb);
      await expect(walletManager.initialize()).rejects.toThrow(
        "blockchain_wallets",
      );
    });
  });

  // ============================================================
  // 3. createWallet
  // ============================================================
  describe("createWallet", () => {
    beforeEach(() => {
      walletManager = new WalletManager(mockDatabase);
    });

    it("应该生成12个单词的BIP39助记词", async () => {
      const result = await helperCreateWallet();
      expect(actualBip39.generateMnemonic).toHaveBeenCalled();
      expect(result.mnemonic).toBe(TEST_MNEMONIC);
      expect(result.mnemonic.split(" ").length).toBe(12);
    });

    it("应该验证密码长度不少于8位", async () => {
      await expect(walletManager.createWallet("short")).rejects.toThrow(
        "密码长度不能少于8位",
      );
    });

    it("应该在密码为空时抛出错误", async () => {
      await expect(walletManager.createWallet("")).rejects.toThrow(
        "密码长度不能少于8位",
      );
      await expect(walletManager.createWallet(null)).rejects.toThrow(
        "密码长度不能少于8位",
      );
    });

    it("应该使用BIP44标准派生路径", async () => {
      await helperCreateWallet();
      expect(mocks.mockHDKeyInstance.derive).toHaveBeenCalledWith(
        "m/44'/60'/0'/0/0",
      );
    });

    it("应该加密存储私钥和助记词", async () => {
      const result = await helperCreateWallet();
      const saved = mockDatabase._records.get(result.id);
      expect(saved).toBeDefined();
      expect(saved.encrypted_private_key).toBeDefined();
      expect(saved.encrypted_private_key).not.toBe(TEST_PRIVATE_KEY_HEX);
      expect(saved.mnemonic_encrypted).toBeDefined();
      expect(saved.mnemonic_encrypted).not.toBe(TEST_MNEMONIC);
    });

    it("应该在首个钱包时设置为默认", async () => {
      const result = await helperCreateWallet();
      const saved = mockDatabase._records.get(result.id);
      expect(saved.is_default).toBe(1);
    });

    it("应该返回钱包信息包含id、address、mnemonic", async () => {
      const result = await helperCreateWallet();
      expect(result.id).toBe(TEST_WALLET_ID);
      expect(result.address).toBe(TEST_ADDRESS);
      expect(result.mnemonic).toBe(TEST_MNEMONIC);
      expect(result.chainId).toBe(1);
      expect(typeof result.createdAt).toBe("number");
    });
  });

  // ============================================================
  // 4. importFromMnemonic
  // ============================================================
  describe("importFromMnemonic", () => {
    beforeEach(() => {
      walletManager = new WalletManager(mockDatabase);
    });

    it("应该验证密码长度", async () => {
      await expect(
        walletManager.importFromMnemonic(TEST_MNEMONIC, "short"),
      ).rejects.toThrow("密码长度不能少于8位");
    });

    it("应该拒绝无效的助记词", async () => {
      await expect(
        walletManager.importFromMnemonic(
          "invalid words here foo bar baz one two three four five six",
          TEST_PASSWORD,
        ),
      ).rejects.toThrow("无效的助记词");
    });

    it("应该检测重复钱包", async () => {
      await walletManager.importFromMnemonic(TEST_MNEMONIC, TEST_PASSWORD);
      await expect(
        walletManager.importFromMnemonic(TEST_MNEMONIC, TEST_PASSWORD),
      ).rejects.toThrow("该钱包已存在");
    });

    it("应该正确导入有效助记词", async () => {
      const result = await walletManager.importFromMnemonic(
        TEST_MNEMONIC,
        TEST_PASSWORD,
      );
      expect(result.id).toBe(TEST_WALLET_ID);
      expect(result.address).toBe(TEST_ADDRESS);
      expect(result.chainId).toBe(1);
      expect(typeof result.createdAt).toBe("number");
      expect(result.mnemonic).toBeUndefined();
    });

    it("应该触发wallet:imported事件", async () => {
      const spy = vi.fn();
      walletManager.on("wallet:imported", spy);
      await walletManager.importFromMnemonic(TEST_MNEMONIC, TEST_PASSWORD);
      expect(spy).toHaveBeenCalledWith({
        walletId: TEST_WALLET_ID,
        address: TEST_ADDRESS,
      });
    });
  });

  // ============================================================
  // 5. importFromPrivateKey
  // ============================================================
  describe("importFromPrivateKey", () => {
    beforeEach(() => {
      walletManager = new WalletManager(mockDatabase);
    });

    it("应该验证密码长度", async () => {
      await expect(
        walletManager.importFromPrivateKey(
          "0x" + TEST_PRIVATE_KEY_HEX,
          "short",
        ),
      ).rejects.toThrow("密码长度不能少于8位");
    });

    it("应该支持带0x前缀的私钥", async () => {
      const result = await walletManager.importFromPrivateKey(
        "0x" + TEST_PRIVATE_KEY_HEX,
        TEST_PASSWORD,
      );
      expect(mocks.mockEthers.Wallet).toHaveBeenCalledWith(
        "0x" + TEST_PRIVATE_KEY_HEX,
      );
      expect(result.address).toBe(TEST_ADDRESS);
    });

    it("应该支持不带0x前缀的私钥", async () => {
      const result = await walletManager.importFromPrivateKey(
        TEST_PRIVATE_KEY_HEX,
        TEST_PASSWORD,
      );
      expect(mocks.mockEthers.Wallet).toHaveBeenCalledWith(
        "0x" + TEST_PRIVATE_KEY_HEX,
      );
      expect(result.address).toBe(TEST_ADDRESS);
    });

    it("应该拒绝无效的私钥", async () => {
      mocks.mockEthers.Wallet.mockImplementationOnce(() => {
        throw new Error("invalid private key");
      });
      await expect(
        walletManager.importFromPrivateKey("invalid-key", TEST_PASSWORD),
      ).rejects.toThrow("无效的私钥");
    });

    it("应该检测重复钱包", async () => {
      await walletManager.importFromPrivateKey(
        TEST_PRIVATE_KEY_HEX,
        TEST_PASSWORD,
      );
      await expect(
        walletManager.importFromPrivateKey(TEST_PRIVATE_KEY_HEX, TEST_PASSWORD),
      ).rejects.toThrow("该钱包已存在");
    });
  });

  // ============================================================
  // 6. unlockWallet
  // ============================================================
  describe("unlockWallet", () => {
    beforeEach(async () => {
      walletManager = new WalletManager(mockDatabase);
      await helperCreateWallet();
    });

    it("应该在钱包已解锁时返回缓存的实例", async () => {
      walletManager.unlockedWallets.set(
        TEST_WALLET_ID,
        mocks.mockWalletInstance,
      );
      const result = await walletManager.unlockWallet(
        TEST_WALLET_ID,
        TEST_PASSWORD,
      );
      expect(result).toBe(mocks.mockWalletInstance);
    });

    it("应该解密私钥并创建钱包实例", async () => {
      const result = await walletManager.unlockWallet(
        TEST_WALLET_ID,
        TEST_PASSWORD,
      );
      expect(result).toBeDefined();
      expect(result.address).toBe(TEST_ADDRESS);
    });

    it("应该在钱包不存在时抛出错误", async () => {
      await expect(
        walletManager.unlockWallet("non-existent-id", TEST_PASSWORD),
      ).rejects.toThrow("钱包不存在");
    });

    it("应该验证地址匹配", async () => {
      mocks.mockWalletInstance.address = "0xDIFFERENT_ADDRESS";
      await expect(
        walletManager.unlockWallet(TEST_WALLET_ID, TEST_PASSWORD),
      ).rejects.toThrow("密码错误或钱包数据损坏");
      mocks.mockWalletInstance.address = TEST_ADDRESS;
    });

    it("应该拒绝解锁外部钱包", async () => {
      mockDatabase._records.set("ext-wallet-id", {
        id: "ext-wallet-id",
        address: "0xEXTERNAL",
        wallet_type: "external",
        provider: "metamask",
        encrypted_private_key: "enc",
        mnemonic_encrypted: null,
        derivation_path: null,
        chain_id: 1,
        is_default: 0,
        created_at: Date.now(),
      });
      await expect(
        walletManager.unlockWallet("ext-wallet-id", TEST_PASSWORD),
      ).rejects.toThrow("只能解锁内置钱包");
    });

    it("应该触发wallet:unlocked事件", async () => {
      const spy = vi.fn();
      walletManager.on("wallet:unlocked", spy);
      await walletManager.unlockWallet(TEST_WALLET_ID, TEST_PASSWORD);
      expect(spy).toHaveBeenCalledWith({
        walletId: TEST_WALLET_ID,
        address: TEST_ADDRESS,
      });
    });

    it("应该缓存解锁的钱包", async () => {
      expect(walletManager.unlockedWallets.has(TEST_WALLET_ID)).toBe(false);
      await walletManager.unlockWallet(TEST_WALLET_ID, TEST_PASSWORD);
      expect(walletManager.unlockedWallets.has(TEST_WALLET_ID)).toBe(true);
    });
  });

  // ============================================================
  // 7. lockWallet
  // ============================================================
  describe("lockWallet", () => {
    it("应该从缓存中移除钱包", () => {
      walletManager = new WalletManager(mockDatabase);
      walletManager.unlockedWallets.set("w1", mocks.mockWalletInstance);
      walletManager.lockWallet("w1");
      expect(walletManager.unlockedWallets.has("w1")).toBe(false);
    });

    it("应该触发wallet:locked事件", () => {
      walletManager = new WalletManager(mockDatabase);
      const spy = vi.fn();
      walletManager.on("wallet:locked", spy);
      walletManager.lockWallet("w1");
      expect(spy).toHaveBeenCalledWith({ walletId: "w1" });
    });

    it("应该在钱包未解锁时安全执行", () => {
      walletManager = new WalletManager(mockDatabase);
      expect(() => walletManager.lockWallet("non-existent")).not.toThrow();
    });
  });

  // ============================================================
  // 8. signTransaction
  // ============================================================
  describe("signTransaction", () => {
    beforeEach(async () => {
      walletManager = new WalletManager(
        mockDatabase,
        mockUKeyManager,
        mockBlockchainAdapter,
      );
      await helperCreateWallet();
      await walletManager.unlockWallet(TEST_WALLET_ID, TEST_PASSWORD);
    });

    it("应该使用解锁的钱包签名交易", async () => {
      const tx = { to: "0x123", value: "1000" };
      const result = await walletManager.signTransaction(TEST_WALLET_ID, tx);
      expect(result).toBe("0x_signed_tx");
      expect(mocks.mockWalletInstance.signTransaction).toHaveBeenCalledWith(tx);
    });

    it("应该在钱包未解锁时抛出错误", async () => {
      walletManager.unlockedWallets.clear();
      await expect(
        walletManager.signTransaction("unknown", { to: "0x123" }),
      ).rejects.toThrow("钱包未解锁，请先解锁钱包");
    });

    it("应该支持连接到provider", async () => {
      await walletManager.signTransaction(TEST_WALLET_ID, {
        to: "0x123",
        value: "1000",
      });
      expect(mocks.mockWalletInstance.connect).toHaveBeenCalled();
      expect(mockBlockchainAdapter.getProvider).toHaveBeenCalled();
    });

    it("应该支持U-Key签名", async () => {
      mocks.mockEthers.recoverAddress.mockReturnValue(TEST_ADDRESS);
      const result = await walletManager.signTransaction(
        TEST_WALLET_ID,
        { to: "0x123", value: "1000", chainId: 1 },
        true,
      );
      expect(mockUKeyManager.sign).toHaveBeenCalled();
      expect(result).toBe("0x_signed_tx_serialized");
    });
  });

  // ============================================================
  // 9. signMessage
  // ============================================================
  describe("signMessage", () => {
    beforeEach(async () => {
      walletManager = new WalletManager(mockDatabase, mockUKeyManager);
      await helperCreateWallet();
      await walletManager.unlockWallet(TEST_WALLET_ID, TEST_PASSWORD);
    });

    it("应该使用解锁的钱包签名消息", async () => {
      const result = await walletManager.signMessage(TEST_WALLET_ID, "hello");
      expect(result).toBe("0x_signed_message");
      expect(mocks.mockWalletInstance.signMessage).toHaveBeenCalledWith(
        "hello",
      );
    });

    it("应该在钱包未解锁时抛出错误", async () => {
      walletManager.unlockedWallets.clear();
      await expect(
        walletManager.signMessage("unknown", "hello"),
      ).rejects.toThrow("钱包未解锁，请先解锁钱包");
    });

    it("应该支持U-Key签名消息", async () => {
      mocks.mockEthers.recoverAddress.mockReturnValue(TEST_ADDRESS);
      const result = await walletManager.signMessage(
        TEST_WALLET_ID,
        "hello",
        true,
      );
      expect(mockUKeyManager.sign).toHaveBeenCalled();
      expect(result).toBe("0x_signature");
    });
  });

  // ============================================================
  // 10. getBalance
  // ============================================================
  describe("getBalance", () => {
    beforeEach(() => {
      walletManager = new WalletManager(
        mockDatabase,
        null,
        mockBlockchainAdapter,
      );
    });

    it("应该在未初始化blockchainAdapter时抛出错误", async () => {
      walletManager.blockchainAdapter = null;
      await expect(walletManager.getBalance("0x123", 1)).rejects.toThrow(
        "BlockchainAdapter 未初始化",
      );
    });

    it("应该查询原生币余额", async () => {
      const result = await walletManager.getBalance(TEST_ADDRESS, 1);
      expect(mockBlockchainAdapter.getProvider).toHaveBeenCalled();
      expect(mocks.mockEthers.formatEther).toHaveBeenCalled();
      expect(result).toBe("1.0");
    });

    it("应该在链ID不匹配时切换链", async () => {
      mockBlockchainAdapter.currentChainId = 137;
      await walletManager.getBalance(TEST_ADDRESS, 1);
      expect(mockBlockchainAdapter.switchChain).toHaveBeenCalledWith(1);
    });

    it("应该查询ERC-20代币余额", async () => {
      const tokenAddr = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
      const result = await walletManager.getBalance(TEST_ADDRESS, 1, tokenAddr);
      expect(mocks.mockEthers.Contract).toHaveBeenCalled();
      expect(mocks.mockContractInstance.balanceOf).toHaveBeenCalledWith(
        TEST_ADDRESS,
      );
      expect(result).toBe("5000000000000000000");
    });
  });

  // ============================================================
  // 11. Wallet management
  // ============================================================
  describe("钱包管理", () => {
    beforeEach(async () => {
      walletManager = new WalletManager(mockDatabase);
    });

    it("应该获取所有钱包列表", async () => {
      await helperCreateWallet();
      const wallets = await walletManager.getAllWallets();
      expect(Array.isArray(wallets)).toBe(true);
      expect(wallets.length).toBe(1);
      expect(wallets[0].address).toBe(TEST_ADDRESS);
    });

    it("应该根据ID获取钱包", async () => {
      await helperCreateWallet();
      const wallet = await walletManager.getWallet(TEST_WALLET_ID);
      expect(wallet).toBeDefined();
      expect(wallet.id).toBe(TEST_WALLET_ID);
      expect(wallet.address).toBe(TEST_ADDRESS);
    });

    it("应该根据地址获取钱包（不区分大小写）", async () => {
      await helperCreateWallet();
      const wallet = await walletManager.getWalletByAddress(
        TEST_ADDRESS.toLowerCase(),
      );
      expect(wallet).toBeDefined();
      expect(wallet.id).toBe(TEST_WALLET_ID);
    });

    it("应该设置默认钱包", async () => {
      await helperCreateWallet();
      mockDatabase._records.set("second", {
        id: "second",
        address: "0xSECOND",
        wallet_type: "internal",
        provider: "builtin",
        encrypted_private_key: "enc",
        mnemonic_encrypted: null,
        derivation_path: "m/44'/60'/0'/0/0",
        chain_id: 1,
        is_default: 0,
        created_at: Date.now(),
      });
      const spy = vi.fn();
      walletManager.on("wallet:default-changed", spy);
      await walletManager.setDefaultWallet("second");
      expect(mockDatabase._records.get(TEST_WALLET_ID).is_default).toBe(0);
      expect(mockDatabase._records.get("second").is_default).toBe(1);
      expect(spy).toHaveBeenCalledWith({ walletId: "second" });
    });

    it("应该删除钱包", async () => {
      await helperCreateWallet();
      const spy = vi.fn();
      walletManager.on("wallet:deleted", spy);
      await walletManager.deleteWallet(TEST_WALLET_ID);
      expect(mockDatabase._records.has(TEST_WALLET_ID)).toBe(false);
      expect(spy).toHaveBeenCalledWith({ walletId: TEST_WALLET_ID });
    });
  });

  // ============================================================
  // 12. exportPrivateKey
  // ============================================================
  describe("exportPrivateKey", () => {
    beforeEach(async () => {
      walletManager = new WalletManager(mockDatabase);
      await helperCreateWallet();
    });

    it("应该导出私钥（带0x前缀）", async () => {
      const result = await walletManager.exportPrivateKey(
        TEST_WALLET_ID,
        TEST_PASSWORD,
      );
      expect(result).toMatch(/^0x/);
      expect(result).toBe("0x" + TEST_PRIVATE_KEY_HEX);
    });

    it("应该在密码错误时解密失败", async () => {
      await expect(
        walletManager.exportPrivateKey(TEST_WALLET_ID, "wrong_password_here"),
      ).rejects.toThrow();
    });

    it("应该拒绝导出外部钱包的私钥", async () => {
      mockDatabase._records.set("ext", {
        id: "ext",
        address: "0xEXT",
        wallet_type: "external",
        provider: "metamask",
        encrypted_private_key: "enc",
        mnemonic_encrypted: null,
        derivation_path: null,
        chain_id: 1,
        is_default: 0,
        created_at: Date.now(),
      });
      await expect(
        walletManager.exportPrivateKey("ext", TEST_PASSWORD),
      ).rejects.toThrow("只能导出内置钱包的私钥");
    });
  });

  // ============================================================
  // 13. exportMnemonic
  // ============================================================
  describe("exportMnemonic", () => {
    beforeEach(async () => {
      walletManager = new WalletManager(mockDatabase);
      await helperCreateWallet();
    });

    it("应该导出助记词", async () => {
      const result = await walletManager.exportMnemonic(
        TEST_WALLET_ID,
        TEST_PASSWORD,
      );
      expect(result).toBe(TEST_MNEMONIC);
    });

    it("应该在钱包无助记词时抛出错误", async () => {
      mockDatabase._records.clear();
      const result = await walletManager.importFromPrivateKey(
        TEST_PRIVATE_KEY_HEX,
        TEST_PASSWORD,
      );
      await expect(
        walletManager.exportMnemonic(result.id, TEST_PASSWORD),
      ).rejects.toThrow("该钱包没有助记词（可能是从私钥导入的）");
    });

    it("应该在密码错误时解密失败", async () => {
      await expect(
        walletManager.exportMnemonic(TEST_WALLET_ID, "wrong_password_here"),
      ).rejects.toThrow();
    });
  });

  // ============================================================
  // 14. Encryption / Decryption (real crypto)
  // ============================================================
  describe("加密和解密", () => {
    beforeEach(() => {
      walletManager = new WalletManager(mockDatabase);
    });

    it("应该使用AES-256-GCM加密数据", () => {
      const encrypted = walletManager._encryptData("test data", "strongpass12");
      expect(typeof encrypted).toBe("string");
      expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
      expect(encrypted).not.toContain("test data");
    });

    it("应该生成随机盐和IV", () => {
      const e1 = walletManager._encryptData("test", "strongpass12");
      const e2 = walletManager._encryptData("test", "strongpass12");
      expect(e1).not.toBe(e2);
    });

    it("应该使用PBKDF2派生密钥", () => {
      const spy = vi.spyOn(crypto, "pbkdf2Sync");
      walletManager._encryptData("test", "strongpass12");
      expect(spy).toHaveBeenCalledWith(
        "strongpass12",
        expect.any(Buffer),
        100000,
        32,
        "sha256",
      );
      spy.mockRestore();
    });

    it("应该成功解密加密的数据", () => {
      const plaintext = "hello world 123 测试数据";
      const encrypted = walletManager._encryptData(plaintext, "mysecretpw12");
      const decrypted = walletManager._decryptData(encrypted, "mysecretpw12");
      expect(decrypted).toBe(plaintext);
    });

    it("应该在密码错误时解密失败", () => {
      const encrypted = walletManager._encryptData("sensitive", "correctpass1");
      expect(() => {
        walletManager._decryptData(encrypted, "wrongpasswd1");
      }).toThrow("数据解密失败（密码可能错误）");
    });
  });

  // ============================================================
  // 15. Security
  // ============================================================
  describe("安全性", () => {
    beforeEach(() => {
      walletManager = new WalletManager(mockDatabase);
    });

    it("应该使用100000次PBKDF2迭代", () => {
      const spy = vi.spyOn(crypto, "pbkdf2Sync");
      walletManager._encryptData("t", "password12345678");
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        100000,
        expect.anything(),
        expect.anything(),
      );
      spy.mockRestore();
    });

    it("应该使用32字节密钥长度（256位）", () => {
      const spy = vi.spyOn(crypto, "pbkdf2Sync");
      walletManager._encryptData("t", "password12345678");
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        32,
        expect.anything(),
      );
      spy.mockRestore();
    });

    it("应该使用SHA-256哈希算法", () => {
      const spy = vi.spyOn(crypto, "pbkdf2Sync");
      walletManager._encryptData("t", "password12345678");
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "sha256",
      );
      spy.mockRestore();
    });

    it("应该使用64字节盐值", () => {
      const encrypted = walletManager._encryptData("t", "password12345678");
      const combined = Buffer.from(encrypted, "base64");
      // salt(64) + iv(16) + tag(16) + ciphertext >= 97
      expect(combined.length).toBeGreaterThanOrEqual(64 + 16 + 16);
    });

    it("应该使用16字节IV", () => {
      const encrypted = walletManager._encryptData("t", "password12345678");
      const combined = Buffer.from(encrypted, "base64");
      const iv = combined.subarray(64, 80);
      expect(iv.length).toBe(16);
    });

    it("应该不在日志中暴露私钥", async () => {
      const pk =
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      mocks.mockLogger.info.mockClear();
      mocks.mockLogger.error.mockClear();
      mocks.mockLogger.warn.mockClear();
      mocks.mockLogger.debug.mockClear();
      try {
        await walletManager.importFromPrivateKey(pk, TEST_PASSWORD);
      } catch (_) {
        /* ignore */
      }
      const all = [
        ...mocks.mockLogger.info.mock.calls,
        ...mocks.mockLogger.error.mock.calls,
        ...mocks.mockLogger.warn.mock.calls,
        ...mocks.mockLogger.debug.mock.calls,
      ];
      all.forEach((c) => expect(JSON.stringify(c)).not.toContain(pk));
    });

    it("应该不在日志中暴露助记词", async () => {
      mocks.mockLogger.info.mockClear();
      mocks.mockLogger.error.mockClear();
      mocks.mockLogger.warn.mockClear();
      mocks.mockLogger.debug.mockClear();
      try {
        await walletManager.importFromMnemonic(TEST_MNEMONIC, TEST_PASSWORD);
      } catch (_) {
        /* ignore */
      }
      const all = [
        ...mocks.mockLogger.info.mock.calls,
        ...mocks.mockLogger.error.mock.calls,
        ...mocks.mockLogger.warn.mock.calls,
        ...mocks.mockLogger.debug.mock.calls,
      ];
      all.forEach((c) =>
        expect(JSON.stringify(c)).not.toContain(TEST_MNEMONIC),
      );
    });
  });

  // ============================================================
  // 16. cleanup
  // ============================================================
  describe("cleanup", () => {
    it("应该清除所有解锁的钱包", async () => {
      walletManager = new WalletManager(mockDatabase);
      walletManager.unlockedWallets.set("w1", mocks.mockWalletInstance);
      walletManager.unlockedWallets.set("w2", mocks.mockWalletInstance);
      walletManager.initialized = true;
      await walletManager.cleanup();
      expect(walletManager.unlockedWallets.size).toBe(0);
      expect(walletManager.initialized).toBe(false);
    });

    it("应该在没有解锁钱包时安全执行", async () => {
      walletManager = new WalletManager(mockDatabase);
      await expect(walletManager.cleanup()).resolves.not.toThrow();
    });
  });

  // ============================================================
  // 17. Events (through real code paths)
  // ============================================================
  describe("事件发射", () => {
    it("应该在创建钱包时发射wallet:created", async () => {
      walletManager = new WalletManager(mockDatabase);
      const spy = vi.fn();
      walletManager.on("wallet:created", spy);
      await helperCreateWallet();
      expect(spy).toHaveBeenCalledWith({
        walletId: TEST_WALLET_ID,
        address: TEST_ADDRESS,
      });
    });

    it("应该在导入钱包时发射wallet:imported", async () => {
      walletManager = new WalletManager(mockDatabase);
      const spy = vi.fn();
      walletManager.on("wallet:imported", spy);
      await walletManager.importFromMnemonic(TEST_MNEMONIC, TEST_PASSWORD);
      expect(spy).toHaveBeenCalledWith({
        walletId: TEST_WALLET_ID,
        address: TEST_ADDRESS,
      });
    });

    it("应该在解锁钱包时发射wallet:unlocked", async () => {
      walletManager = new WalletManager(mockDatabase);
      await helperCreateWallet();
      const spy = vi.fn();
      walletManager.on("wallet:unlocked", spy);
      await walletManager.unlockWallet(TEST_WALLET_ID, TEST_PASSWORD);
      expect(spy).toHaveBeenCalledWith({
        walletId: TEST_WALLET_ID,
        address: TEST_ADDRESS,
      });
    });
  });

  // ============================================================
  // 18. Edge cases
  // ============================================================
  describe("边界情况", () => {
    beforeEach(() => {
      walletManager = new WalletManager(mockDatabase);
    });

    it("应该处理超长密码", () => {
      const long = "a".repeat(10000);
      const encrypted = walletManager._encryptData("data", long);
      expect(walletManager._decryptData(encrypted, long)).toBe("data");
    });

    it("应该处理包含特殊字符的密码", () => {
      const special = "!@#$%^&*()_+-=[]{}|;:'\",.<>?/`~";
      const encrypted = walletManager._encryptData("data", special);
      expect(walletManager._decryptData(encrypted, special)).toBe("data");
    });

    it("应该处理Unicode密码", () => {
      const unicode = "密码测试🔑🔐パスワード가나다라";
      const encrypted = walletManager._encryptData("data", unicode);
      expect(walletManager._decryptData(encrypted, unicode)).toBe("data");
    });

    it("应该处理并发解锁请求", async () => {
      walletManager.unlockedWallets.set("wid", mocks.mockWalletInstance);
      const results = await Promise.all([
        walletManager.unlockWallet("wid", "p1"),
        walletManager.unlockWallet("wid", "p2"),
        walletManager.unlockWallet("wid", "p3"),
      ]);
      results.forEach((r) => expect(r).toBe(mocks.mockWalletInstance));
    });
  });

  // ============================================================
  // 19. WalletType constants
  // ============================================================
  describe("WalletType常量", () => {
    it("应该定义INTERNAL类型", () => {
      expect(WalletType.INTERNAL).toBe("internal");
    });
    it("应该定义EXTERNAL类型", () => {
      expect(WalletType.EXTERNAL).toBe("external");
    });
  });

  // ============================================================
  // 20. WalletProvider constants
  // ============================================================
  describe("WalletProvider常量", () => {
    it("应该定义BUILTIN提供者", () => {
      expect(WalletProvider.BUILTIN).toBe("builtin");
    });
    it("应该定义METAMASK提供者", () => {
      expect(WalletProvider.METAMASK).toBe("metamask");
    });
    it("应该定义WALLETCONNECT提供者", () => {
      expect(WalletProvider.WALLETCONNECT).toBe("walletconnect");
    });
  });
});
