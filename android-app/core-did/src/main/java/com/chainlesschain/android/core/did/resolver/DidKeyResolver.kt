package com.chainlesschain.android.core.did.resolver

import timber.log.Timber
import com.chainlesschain.android.core.did.generator.DidKeyGenerator
import com.chainlesschain.android.core.did.model.DIDMethod
import com.chainlesschain.android.core.did.model.DIDResolutionMetadata
import com.chainlesschain.android.core.did.model.DIDResolutionResult
import javax.inject.Inject
import javax.inject.Singleton

/**
 * did:key解析器
 *
 * did:key是无需注册的DID方法，可以直接从DID推导出DID Document
 */
@Singleton
class DidKeyResolver @Inject constructor() : DIDResolver {

    override suspend fun resolve(did: String): DIDResolutionResult {
        Timber.d("Resolving did:key: $did")

        return try {
            // 验证DID格式
            if (!DidKeyGenerator.isValid(did)) {
                return DIDResolutionResult(
                    didDocument = null,
                    didResolutionMetadata = DIDResolutionMetadata(
                        error = "invalidDid"
                    )
                )
            }

            // 生成DID Document
            val didDocument = DidKeyGenerator.generateDocument(did)

            Timber.d("Resolved did:key successfully")

            DIDResolutionResult(
                didDocument = didDocument,
                didResolutionMetadata = DIDResolutionMetadata()
            )
        } catch (e: Exception) {
            Timber.e(e, "Failed to resolve did:key")

            DIDResolutionResult(
                didDocument = null,
                didResolutionMetadata = DIDResolutionMetadata(
                    error = "internalError"
                )
            )
        }
    }

    override fun supports(did: String): Boolean {
        return did.startsWith(DIDMethod.KEY.prefix)
    }
}
