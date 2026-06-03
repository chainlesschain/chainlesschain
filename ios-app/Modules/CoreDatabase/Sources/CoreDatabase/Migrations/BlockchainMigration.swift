import Foundation
import SQLite3

/// 区块链表迁移扩展
extension DatabaseManager {
    /// 迁移 v2: 创建区块链相关表
    func migration_v2() throws {
        // 1. 钱包表
        try execute("""
            CREATE TABLE IF NOT EXISTS blockchain_wallets (
                id TEXT PRIMARY KEY,
                address TEXT NOT NULL UNIQUE,
                wallet_type TEXT NOT NULL CHECK(wallet_type IN ('internal', 'external')),
                provider TEXT NOT NULL CHECK(provider IN ('builtin', 'metamask', 'walletconnect')),
                derivation_path TEXT,
                chain_id INTEGER NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
        """)

        // 钱包表索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_wallets_address
            ON blockchain_wallets(address);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_wallets_chain_id
            ON blockchain_wallets(chain_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_wallets_is_default
            ON blockchain_wallets(is_default);
        """)

        // 2. 钱包余额表
        try execute("""
            CREATE TABLE IF NOT EXISTS wallet_balances (
                wallet_id TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                balance TEXT NOT NULL,
                symbol TEXT NOT NULL,
                decimals INTEGER NOT NULL DEFAULT 18,
                token_address TEXT,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (wallet_id, chain_id, COALESCE(token_address, '')),
                FOREIGN KEY (wallet_id) REFERENCES blockchain_wallets(id) ON DELETE CASCADE
            );
        """)

        // 余额表索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_balances_wallet_id
            ON wallet_balances(wallet_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_balances_chain_id
            ON wallet_balances(chain_id);
        """)

        // 3. 区块链交易表
        try execute("""
            CREATE TABLE IF NOT EXISTS blockchain_transactions (
                id TEXT PRIMARY KEY,
                hash TEXT NOT NULL UNIQUE,
                from_address TEXT NOT NULL,
                to_address TEXT NOT NULL,
                value TEXT NOT NULL,
                gas_price TEXT NOT NULL,
                gas_limit TEXT NOT NULL,
                gas_used TEXT,
                data TEXT,
                nonce INTEGER NOT NULL,
                chain_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'failed')),
                type TEXT NOT NULL CHECK(type IN ('send', 'receive', 'contract')),
                block_number INTEGER,
                block_hash TEXT,
                timestamp INTEGER NOT NULL,
                confirmations INTEGER DEFAULT 0,
                error_message TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
        """)

        // 交易表索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_transactions_hash
            ON blockchain_transactions(hash);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_transactions_from
            ON blockchain_transactions(from_address);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_transactions_to
            ON blockchain_transactions(to_address);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_transactions_chain_id
            ON blockchain_transactions(chain_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_transactions_status
            ON blockchain_transactions(status);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_transactions_timestamp
            ON blockchain_transactions(timestamp DESC);
        """)

        // 4. ERC-20 Token 配置表
        try execute("""
            CREATE TABLE IF NOT EXISTS erc20_tokens (
                id TEXT PRIMARY KEY,
                chain_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                name TEXT NOT NULL,
                symbol TEXT NOT NULL,
                decimals INTEGER NOT NULL,
                logo_url TEXT,
                is_custom INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                UNIQUE(chain_id, address)
            );
        """)

        // Token表索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_tokens_chain_id
            ON erc20_tokens(chain_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_tokens_symbol
            ON erc20_tokens(symbol);
        """)

        // 5. NFT资产表
        try execute("""
            CREATE TABLE IF NOT EXISTS nft_assets (
                id TEXT PRIMARY KEY,
                wallet_id TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                contract_address TEXT NOT NULL,
                token_id TEXT NOT NULL,
                name TEXT,
                description TEXT,
                image_url TEXT,
                metadata_url TEXT,
                collection_name TEXT,
                token_standard TEXT DEFAULT 'ERC721' CHECK(token_standard IN ('ERC721', 'ERC1155')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(chain_id, contract_address, token_id),
                FOREIGN KEY (wallet_id) REFERENCES blockchain_wallets(id) ON DELETE CASCADE
            );
        """)

        // NFT表索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_nfts_wallet_id
            ON nft_assets(wallet_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_nfts_chain_id
            ON nft_assets(chain_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_nfts_contract
            ON nft_assets(contract_address);
        """)

        // 6. 智能合约ABI表（用于合约交互）
        try execute("""
            CREATE TABLE IF NOT EXISTS contract_abis (
                id TEXT PRIMARY KEY,
                chain_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                name TEXT NOT NULL,
                abi TEXT NOT NULL,
                is_verified INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(chain_id, address)
            );
        """)

        // ABI表索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_abis_chain_id
            ON contract_abis(chain_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_abis_address
            ON contract_abis(address);
        """)

        // 7. 地址簿表
        try execute("""
            CREATE TABLE IF NOT EXISTS address_book (
                id TEXT PRIMARY KEY,
                chain_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                name TEXT NOT NULL,
                note TEXT,
                is_favorite INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(chain_id, address)
            );
        """)

        // 地址簿索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_addressbook_chain_id
            ON address_book(chain_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_addressbook_address
            ON address_book(address);
        """)

        // 8. Gas价格历史表（用于Gas估算优化）
        try execute("""
            CREATE TABLE IF NOT EXISTS gas_price_history (
                id TEXT PRIMARY KEY,
                chain_id INTEGER NOT NULL,
                slow TEXT NOT NULL,
                standard TEXT NOT NULL,
                fast TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );
        """)

        // Gas价格历史索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_gas_history_chain_id
            ON gas_price_history(chain_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_gas_history_timestamp
            ON gas_price_history(timestamp DESC);
        """)

        // 9. 待处理交易队列表
        try execute("""
            CREATE TABLE IF NOT EXISTS pending_transactions (
                id TEXT PRIMARY KEY,
                wallet_id TEXT NOT NULL,
                chain_id INTEGER NOT NULL,
                to_address TEXT NOT NULL,
                value TEXT NOT NULL,
                data TEXT,
                gas_limit TEXT NOT NULL,
                gas_price TEXT NOT NULL,
                nonce INTEGER NOT NULL,
                raw_transaction TEXT,
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 3,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'broadcasting', 'confirmed', 'failed')),
                error_message TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (wallet_id) REFERENCES blockchain_wallets(id) ON DELETE CASCADE
            );
        """)

        // 待处理交易索引
        try execute("""
            CREATE INDEX IF NOT EXISTS idx_pending_tx_wallet_id
            ON pending_transactions(wallet_id);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_pending_tx_status
            ON pending_transactions(status);
        """)

        try execute("""
            CREATE INDEX IF NOT EXISTS idx_pending_tx_chain_id
            ON pending_transactions(chain_id);
        """)

        logger.database("Blockchain tables created successfully")
    }
}
