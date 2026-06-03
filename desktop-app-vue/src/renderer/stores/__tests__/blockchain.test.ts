/**
 * useBlockchainStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape (seeded networks + default chain)
 *  - Wallet getters: internalWallets / currentAddress / currentWalletType /
 *    hasWallet (external-wallet precedence)
 *  - Network getters: currentNetwork / mainnetNetworks / testnetNetworks / isTestnet
 *  - Transaction getters: pendingTransactionCount / recentTransactions (top 10) /
 *    getTransactionByHash (curried)
 *  - Contract/asset getters: contractsOnCurrentChain / assetsOnCurrentChain
 *  - Pure actions: selectWallet / disconnectExternalWallet / modal toggles /
 *    removeConfirmedTransaction
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useBlockchainStore } from "../blockchain";
import type { Wallet, Network, Transaction } from "../blockchain";

function wallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "w1",
    address: "0xabc",
    wallet_type: "internal",
    is_default: 0,
    ...overrides,
  };
}

function network(
  chainId: number,
  testnet: boolean,
  overrides: Partial<Network> = {},
): Network {
  return {
    chainId,
    name: `net-${chainId}`,
    symbol: "ETH",
    rpcUrl: "http://localhost",
    blockExplorer: null,
    testnet,
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    tx_hash: "0xhash",
    from_address: "0xa",
    to_address: "0xb",
    value: "1",
    status: "confirmed",
    chain_id: 31337,
    created_at: 1700000000000,
    ...overrides,
  };
}

describe("useBlockchainStore", () => {
  const mockInvoke = vi.fn();
  const mockGetTxHistory = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    mockGetTxHistory.mockReset().mockResolvedValue([]);
    (window as any).electronAPI = {
      invoke: mockInvoke,
      // removeConfirmedTransaction fires loadTransactions() → blockchain.getTransactionHistory
      blockchain: { getTransactionHistory: mockGetTxHistory },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("defaults to Hardhat chain with seeded networks and no wallet", () => {
      const store = useBlockchainStore();
      expect(store.currentChainId).toBe(31337);
      expect(store.networks.length).toBeGreaterThan(0);
      expect(store.wallets).toEqual([]);
      expect(store.currentWallet).toBeNull();
      expect(store.externalWalletConnected).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Wallet getters
  // -------------------------------------------------------------------------

  describe("wallet getters", () => {
    it("internalWallets filters wallet_type === 'internal'", () => {
      const store = useBlockchainStore();
      store.wallets = [
        wallet({ id: "a", wallet_type: "internal" }),
        wallet({ id: "b", wallet_type: "external" }),
      ];
      expect(store.internalWallets.map((w) => w.id)).toEqual(["a"]);
    });

    it("currentAddress + currentWalletType prefer a connected external wallet", () => {
      const store = useBlockchainStore();
      store.currentWallet = wallet({
        address: "0xinternal",
        wallet_type: "internal",
      });
      // internal wallet selected
      expect(store.currentAddress).toBe("0xinternal");
      expect(store.currentWalletType).toBe("internal");
      // external connection takes precedence
      store.externalWalletConnected = true;
      store.externalWalletAddress = "0xexternal";
      expect(store.currentAddress).toBe("0xexternal");
      expect(store.currentWalletType).toBe("external");
    });

    it("currentAddress is null with no wallet at all", () => {
      const store = useBlockchainStore();
      expect(store.currentAddress).toBeNull();
      expect(store.currentWalletType).toBeNull();
    });

    it("hasWallet is true with internal wallets OR an external connection", () => {
      const store = useBlockchainStore();
      expect(store.hasWallet).toBe(false);
      store.externalWalletConnected = true;
      expect(store.hasWallet).toBe(true);
      store.externalWalletConnected = false;
      store.wallets = [wallet()];
      expect(store.hasWallet).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Network getters
  // -------------------------------------------------------------------------

  describe("network getters", () => {
    beforeEach(() => {
      // override seeded networks deterministically
    });

    it("currentNetwork / isTestnet resolve via currentChainId", () => {
      const store = useBlockchainStore();
      store.networks = [network(1, false), network(2, true)];
      store.currentChainId = 2;
      expect(store.currentNetwork?.chainId).toBe(2);
      expect(store.isTestnet).toBe(true);
      store.currentChainId = 1;
      expect(store.isTestnet).toBe(false);
      store.currentChainId = 999; // unknown
      expect(store.currentNetwork).toBeNull();
      expect(store.isTestnet).toBe(false);
    });

    it("mainnetNetworks / testnetNetworks split by testnet flag", () => {
      const store = useBlockchainStore();
      store.networks = [network(1, false), network(2, true), network(3, false)];
      expect(store.mainnetNetworks.map((n) => n.chainId)).toEqual([1, 3]);
      expect(store.testnetNetworks.map((n) => n.chainId)).toEqual([2]);
    });
  });

  // -------------------------------------------------------------------------
  // Transaction getters
  // -------------------------------------------------------------------------

  describe("transaction getters", () => {
    it("pendingTransactionCount + recentTransactions (top 10) + getTransactionByHash", () => {
      const store = useBlockchainStore();
      store.pendingTransactions = [tx({ id: "p1" }), tx({ id: "p2" })];
      expect(store.pendingTransactionCount).toBe(2);

      store.transactions = Array.from({ length: 15 }, (_, i) =>
        tx({ id: `t${i}`, tx_hash: `0x${i}` }),
      );
      expect(store.recentTransactions).toHaveLength(10);
      expect(store.recentTransactions[0].id).toBe("t0");

      expect(store.getTransactionByHash("0x3")?.id).toBe("t3");
      expect(store.getTransactionByHash("0xmissing")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Contract / asset getters
  // -------------------------------------------------------------------------

  describe("contract / asset getters", () => {
    it("filter deployed items to the current chain", () => {
      const store = useBlockchainStore();
      store.currentChainId = 1;
      store.deployedContracts = [
        { id: "c1", chain_id: 1 } as any,
        { id: "c2", chain_id: 2 } as any,
      ];
      store.deployedAssets = [
        { id: "a1", chain_id: 1 } as any,
        { id: "a2", chain_id: 1 } as any,
        { id: "a3", chain_id: 5 } as any,
      ];
      expect(store.contractsOnCurrentChain.map((c) => c.id)).toEqual(["c1"]);
      expect(store.assetsOnCurrentChain.map((a) => a.id)).toEqual(["a1", "a2"]);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("selectWallet sets currentWallet and clears any external connection", () => {
      const store = useBlockchainStore();
      store.externalWalletConnected = true;
      store.externalWalletAddress = "0xext";
      store.externalWalletProvider = "metamask";
      const w = wallet({ id: "w9" });
      store.selectWallet(w);
      expect(store.currentWallet?.id).toBe("w9");
      expect(store.externalWalletConnected).toBe(false);
      expect(store.externalWalletAddress).toBeNull();
      expect(store.externalWalletProvider).toBeNull();
    });

    it("disconnectExternalWallet clears external connection state", () => {
      const store = useBlockchainStore();
      store.externalWalletConnected = true;
      store.externalWalletAddress = "0xext";
      store.externalWalletProvider = "metamask";
      store.disconnectExternalWallet();
      expect(store.externalWalletConnected).toBe(false);
      expect(store.externalWalletAddress).toBeNull();
      expect(store.externalWalletProvider).toBeNull();
    });

    it("modal toggles flip ui flags; transaction modal carries the tx", () => {
      const store = useBlockchainStore();
      store.showWalletModal();
      expect(store.ui.showWalletModal).toBe(true);
      store.hideWalletModal();
      expect(store.ui.showWalletModal).toBe(false);

      store.showNetworkModal();
      expect(store.ui.showNetworkModal).toBe(true);
      store.hideNetworkModal();
      expect(store.ui.showNetworkModal).toBe(false);

      const t = tx({ id: "tx-modal" });
      store.showTransactionModal(t);
      expect(store.ui.showTransactionModal).toBe(true);
      expect(store.ui.currentTransaction?.id).toBe("tx-modal");
      store.hideTransactionModal();
      expect(store.ui.showTransactionModal).toBe(false);
      expect(store.ui.currentTransaction).toBeNull();
    });

    it("removeConfirmedTransaction drops the matching pending tx (and refreshes)", () => {
      const store = useBlockchainStore();
      store.pendingTransactions = [
        tx({ id: "p1", tx_hash: "0x1" }),
        tx({ id: "p2", tx_hash: "0x2" }),
      ];
      store.removeConfirmedTransaction("0x1");
      expect(store.pendingTransactions.map((t) => t.tx_hash)).toEqual(["0x2"]);
      // triggers loadTransactions() → blockchain.getTransactionHistory
      expect(mockGetTxHistory).toHaveBeenCalled();
    });
  });
});
