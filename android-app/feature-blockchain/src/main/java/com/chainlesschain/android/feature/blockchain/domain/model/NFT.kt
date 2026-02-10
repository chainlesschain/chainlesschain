package com.chainlesschain.android.feature.blockchain.domain.model

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import kotlinx.serialization.Serializable

/**
 * NFT domain model (ERC721, ERC1155)
 */
@Serializable
data class NFT(
    val id: String,
    val contractAddress: String,
    val tokenId: String,
    val chain: SupportedChain,
    val standard: NFTStandard,
    val name: String? = null,
    val description: String? = null,
    val imageUrl: String? = null,
    val animationUrl: String? = null,
    val externalUrl: String? = null,
    val attributes: List<NFTAttribute> = emptyList(),
    val collection: NFTCollection? = null,
    val owner: String? = null,
    val balance: Int = 1, // For ERC1155
    val metadata: NFTMetadata? = null,
    val createdAt: Long = System.currentTimeMillis()
) {
    /**
     * Get unique identifier
     */
    val uniqueId: String
        get() = "${chain.chainId}:$contractAddress:$tokenId"

    /**
     * Get display name
     */
    val displayName: String
        get() = name ?: "#$tokenId"

    /**
     * Check if this is an ERC1155 token
     */
    val isErc1155: Boolean
        get() = standard == NFTStandard.ERC1155
}

/**
 * NFT standard
 */
@Serializable
enum class NFTStandard {
    ERC721,
    ERC1155
}

/**
 * NFT attribute
 */
@Serializable
data class NFTAttribute(
    val traitType: String,
    val value: String,
    val displayType: String? = null, // number, date, boost_percentage, etc.
    val maxValue: String? = null,
    val rarity: Double? = null // 0.0 to 1.0
)

/**
 * NFT collection
 */
@Serializable
data class NFTCollection(
    val address: String,
    val chain: SupportedChain,
    val name: String,
    val symbol: String? = null,
    val description: String? = null,
    val imageUrl: String? = null,
    val bannerUrl: String? = null,
    val externalUrl: String? = null,
    val totalSupply: Long? = null,
    val floorPrice: Double? = null,
    val floorPriceCurrency: String? = null,
    val isVerified: Boolean = false,
    val creator: String? = null,
    val royaltyBps: Int? = null, // Basis points (100 = 1%)
    val stats: NFTCollectionStats? = null
)

/**
 * NFT collection statistics
 */
@Serializable
data class NFTCollectionStats(
    val totalVolume: Double? = null,
    val volume24h: Double? = null,
    val volumeChange24h: Double? = null,
    val averagePrice: Double? = null,
    val numOwners: Int? = null,
    val numItems: Int? = null,
    val updatedAt: Long = System.currentTimeMillis()
)

/**
 * NFT metadata (raw from tokenURI)
 */
@Serializable
data class NFTMetadata(
    val tokenUri: String? = null,
    val rawMetadata: String? = null,
    val metadataType: MetadataType = MetadataType.JSON,
    val lastRefreshed: Long = System.currentTimeMillis()
)

/**
 * Metadata type
 */
@Serializable
enum class MetadataType {
    JSON,
    IPFS,
    ARWEAVE,
    DATA_URI,
    UNKNOWN
}

/**
 * NFT transfer history
 */
@Serializable
data class NFTTransfer(
    val nft: NFT,
    val from: String,
    val to: String,
    val transactionHash: String,
    val blockNumber: Long,
    val timestamp: Long,
    val transferType: NFTTransferType,
    val price: Double? = null,
    val priceCurrency: String? = null
)

/**
 * NFT transfer type
 */
@Serializable
enum class NFTTransferType {
    MINT,
    TRANSFER,
    SALE,
    BURN
}

/**
 * NFT ownership verification result
 */
@Serializable
data class NFTOwnershipResult(
    val nft: NFT,
    val owner: String,
    val isOwner: Boolean,
    val balance: Int = 0, // For ERC1155
    val verifiedAt: Long = System.currentTimeMillis()
)
