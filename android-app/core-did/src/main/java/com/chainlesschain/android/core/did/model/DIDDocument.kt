package com.chainlesschain.android.core.did.model

import kotlinx.serialization.Serializable

/**
 * DID Document (W3C标准)
 *
 * 参考: https://www.w3.org/TR/did-core/
 *
 * 示例:
 * {
 *   "id": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
 *   "verificationMethod": [{
 *     "id": "did:key:z6Mk...#z6Mk...",
 *     "type": "Ed25519VerificationKey2020",
 *     "controller": "did:key:z6Mk...",
 *     "publicKeyMultibase": "z6Mk..."
 *   }],
 *   "authentication": ["did:key:z6Mk...#z6Mk..."],
 *   "assertionMethod": ["did:key:z6Mk...#z6Mk..."]
 * }
 */
@Serializable
data class DIDDocument(
    /** DID标识符 */
    val id: String,

    /** 验证方法（公钥） */
    val verificationMethod: List<VerificationMethod> = emptyList(),

    /** 认证方法（用于身份认证） */
    val authentication: List<String> = emptyList(),

    /** 断言方法（用于签名） */
    val assertionMethod: List<String> = emptyList(),

    /** 密钥协商（用于加密） */
    val keyAgreement: List<String> = emptyList(),

    /** 服务端点 */
    val service: List<Service> = emptyList(),

    /** 创建时间 */
    val created: String? = null,

    /** 更新时间 */
    val updated: String? = null
) {
    companion object {
        /**
         * 从did:key创建基本DID Document
         */
        fun fromDidKey(didKey: String, publicKeyMultibase: String): DIDDocument {
            val verificationMethodId = "$didKey#$publicKeyMultibase"

            val verificationMethod = VerificationMethod(
                id = verificationMethodId,
                type = "Ed25519VerificationKey2020",
                controller = didKey,
                publicKeyMultibase = publicKeyMultibase
            )

            return DIDDocument(
                id = didKey,
                verificationMethod = listOf(verificationMethod),
                authentication = listOf(verificationMethodId),
                assertionMethod = listOf(verificationMethodId),
                keyAgreement = listOf(verificationMethodId)
            )
        }
    }
}

/**
 * 验证方法（公钥信息）
 */
@Serializable
data class VerificationMethod(
    /** 验证方法ID */
    val id: String,

    /** 密钥类型 */
    val type: String,

    /** 控制者DID */
    val controller: String,

    /** 公钥（Multibase编码） */
    val publicKeyMultibase: String? = null,

    /** 公钥（JWK格式） */
    val publicKeyJwk: Map<String, String>? = null
)

/**
 * 服务端点
 */
@Serializable
data class Service(
    /** 服务ID */
    val id: String,

    /** 服务类型 */
    val type: String,

    /** 服务端点URL */
    val serviceEndpoint: String,

    /** 服务描述 */
    val description: String? = null
)

/**
 * DID解析结果
 */
data class DIDResolutionResult(
    /** DID Document */
    val didDocument: DIDDocument? = null,

    /** 解析元数据 */
    val didResolutionMetadata: DIDResolutionMetadata = DIDResolutionMetadata(),

    /** Document元数据 */
    val didDocumentMetadata: DIDDocumentMetadata = DIDDocumentMetadata()
)

/**
 * DID解析元数据
 */
data class DIDResolutionMetadata(
    /** 内容类型 */
    val contentType: String = "application/did+ld+json",

    /** 错误信息 */
    val error: String? = null
)

/**
 * DID Document元数据
 */
data class DIDDocumentMetadata(
    /** 创建时间 */
    val created: String? = null,

    /** 更新时间 */
    val updated: String? = null,

    /** 是否已废弃 */
    val deactivated: Boolean = false
)

/**
 * DID方法类型
 */
enum class DIDMethod(val prefix: String) {
    /** did:key方法（最简单，基于公钥） */
    KEY("did:key:"),

    /** did:peer方法（P2P场景） */
    PEER("did:peer:"),

    /** did:web方法（基于Web域名） */
    WEB("did:web:"),

    /** did:ion方法（基于比特币） */
    ION("did:ion:");

    companion object {
        fun fromDID(did: String): DIDMethod? {
            return values().find { did.startsWith(it.prefix) }
        }
    }
}
