package com.chainlesschain.android.core.did.resolver

import com.chainlesschain.android.core.did.model.DIDDocument
import com.chainlesschain.android.core.did.model.DIDResolutionResult

/**
 * DID解析器接口
 *
 * 负责解析DID到DID Document
 */
interface DIDResolver {

    /**
     * 解析DID
     *
     * @param did DID字符串
     * @return 解析结果
     */
    suspend fun resolve(did: String): DIDResolutionResult

    /**
     * 解析DID Document
     *
     * @param did DID字符串
     * @return DID Document，如果失败返回null
     */
    suspend fun resolveDocument(did: String): DIDDocument? {
        val result = resolve(did)
        return result.didDocument
    }

    /**
     * 检查是否支持该DID方法
     *
     * @param did DID字符串
     * @return 是否支持
     */
    fun supports(did: String): Boolean
}
