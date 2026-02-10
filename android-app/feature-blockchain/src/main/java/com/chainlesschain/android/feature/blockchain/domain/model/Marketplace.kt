package com.chainlesschain.android.feature.blockchain.domain.model

import com.chainlesschain.android.core.blockchain.model.SupportedChain
import kotlinx.serialization.Serializable

/**
 * NFT Listing for marketplace
 */
@Serializable
data class NFTListing(
    val id: String,
    val nft: NFT,
    val seller: String,
    val price: String, // In wei
    val priceFormatted: String,
    val currency: ListingCurrency,
    val listingType: ListingType,
    val status: ListingStatus,
    val startTime: Long,
    val endTime: Long? = null, // Null for fixed price
    val highestBid: NFTOffer? = null, // For auctions
    val royaltyBps: Int = 0, // Basis points (100 = 1%)
    val platformFeeBps: Int = 250, // 2.5% default
    val signature: String? = null, // For off-chain orders
    val createdAt: Long = System.currentTimeMillis()
) {
    /**
     * Check if listing is active
     */
    val isActive: Boolean
        get() = status == ListingStatus.ACTIVE &&
                System.currentTimeMillis() >= startTime &&
                (endTime == null || System.currentTimeMillis() < endTime)

    /**
     * Check if listing is auction
     */
    val isAuction: Boolean
        get() = listingType == ListingType.AUCTION ||
                listingType == ListingType.DUTCH_AUCTION

    /**
     * Get time remaining in milliseconds
     */
    fun timeRemaining(): Long? {
        return endTime?.let { it - System.currentTimeMillis() }
    }

    /**
     * Calculate seller proceeds after fees
     */
    fun sellerProceeds(): Double {
        val priceValue = price.toDoubleOrNull() ?: return 0.0
        val totalFeeBps = royaltyBps + platformFeeBps
        return priceValue * (10000 - totalFeeBps) / 10000 / 1e18
    }
}

/**
 * Listing currency
 */
@Serializable
data class ListingCurrency(
    val address: String, // 0x0 for native token
    val symbol: String,
    val decimals: Int
) {
    companion object {
        fun native(chain: SupportedChain) = ListingCurrency(
            address = "0x0000000000000000000000000000000000000000",
            symbol = chain.symbol,
            decimals = chain.decimals
        )
    }
}

/**
 * Listing type
 */
@Serializable
enum class ListingType {
    FIXED_PRICE,
    AUCTION,        // English auction (ascending)
    DUTCH_AUCTION,  // Descending price
    OFFER_ONLY      // Accept offers only
}

/**
 * Listing status
 */
@Serializable
enum class ListingStatus {
    ACTIVE,
    SOLD,
    CANCELLED,
    EXPIRED
}

/**
 * NFT Offer (bid)
 */
@Serializable
data class NFTOffer(
    val id: String,
    val listingId: String? = null, // Null for collection offers
    val nft: NFT? = null, // Null for collection offers
    val collectionAddress: String? = null, // For collection offers
    val offerer: String,
    val amount: String, // In wei
    val amountFormatted: String,
    val currency: ListingCurrency,
    val status: OfferStatus,
    val expiresAt: Long,
    val signature: String? = null,
    val createdAt: Long = System.currentTimeMillis()
) {
    /**
     * Check if offer is valid
     */
    val isValid: Boolean
        get() = status == OfferStatus.ACTIVE &&
                System.currentTimeMillis() < expiresAt

    /**
     * Check if this is a collection offer
     */
    val isCollectionOffer: Boolean
        get() = collectionAddress != null && nft == null
}

/**
 * Offer status
 */
@Serializable
enum class OfferStatus {
    ACTIVE,
    ACCEPTED,
    CANCELLED,
    EXPIRED,
    OUTBID
}

/**
 * Escrow transaction for P2P trading
 */
@Serializable
data class Escrow(
    val id: String,
    val chain: SupportedChain,
    val contractAddress: String,
    val seller: String,
    val buyer: String,
    val arbiter: String? = null,
    val asset: EscrowAsset,
    val payment: EscrowPayment,
    val status: EscrowStatus,
    val releaseConditions: List<ReleaseCondition> = emptyList(),
    val disputeReason: String? = null,
    val disputeResolution: String? = null,
    val transactionHash: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long? = null,
    val completedAt: Long? = null
) {
    /**
     * Check if escrow can be released
     */
    val canRelease: Boolean
        get() = status == EscrowStatus.FUNDED &&
                releaseConditions.all { it.isMet }

    /**
     * Check if escrow is expired
     */
    val isExpired: Boolean
        get() = expiresAt?.let { System.currentTimeMillis() > it } ?: false
}

/**
 * Escrow asset
 */
@Serializable
data class EscrowAsset(
    val type: EscrowAssetType,
    val nft: NFT? = null,
    val token: Token? = null,
    val amount: String? = null, // For tokens
    val amountFormatted: String? = null
)

/**
 * Escrow asset type
 */
@Serializable
enum class EscrowAssetType {
    NFT,
    TOKEN,
    NATIVE
}

/**
 * Escrow payment
 */
@Serializable
data class EscrowPayment(
    val amount: String,
    val amountFormatted: String,
    val currency: ListingCurrency,
    val isPaid: Boolean = false,
    val paidAt: Long? = null,
    val transactionHash: String? = null
)

/**
 * Escrow status
 */
@Serializable
enum class EscrowStatus {
    CREATED,
    FUNDED,
    COMPLETED,
    REFUNDED,
    DISPUTED,
    RESOLVED,
    EXPIRED
}

/**
 * Release condition for escrow
 */
@Serializable
data class ReleaseCondition(
    val type: ConditionType,
    val description: String,
    val isMet: Boolean = false,
    val metAt: Long? = null,
    val verifiedBy: String? = null
)

/**
 * Condition type
 */
@Serializable
enum class ConditionType {
    BUYER_CONFIRMATION,
    SELLER_CONFIRMATION,
    ARBITER_APPROVAL,
    TIME_LOCK,
    ORACLE_VERIFICATION,
    CUSTOM
}

/**
 * Marketplace statistics
 */
@Serializable
data class MarketplaceStats(
    val totalVolume: Double,
    val volume24h: Double,
    val volume7d: Double,
    val totalListings: Int,
    val activeListings: Int,
    val totalSales: Int,
    val sales24h: Int,
    val averagePrice: Double,
    val uniqueSellers: Int,
    val uniqueBuyers: Int,
    val updatedAt: Long = System.currentTimeMillis()
)
