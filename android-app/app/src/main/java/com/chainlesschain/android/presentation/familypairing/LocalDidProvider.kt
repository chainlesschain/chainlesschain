package com.chainlesschain.android.presentation.familypairing

import com.chainlesschain.android.core.did.manager.DIDManager
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 本机当前 DID 取数 seam (FAMILY-13 配对)。
 *
 * 配对签名走 [com.chainlesschain.android.core.did.manager.DIDManager] 的当前身份私钥,
 * 故 payload 的 inviterDid **必须**是本机真实 `did:key:` (其内嵌 Ed25519 公钥), 对端
 * 才能从 DID 串里 extractPublicKey 验签 (离线、跨设备)。此前用 demo `did:chain:local-*`
 * 常量 → 对端无法解析公钥 → 一律 InvalidSignature。
 *
 * 抽成接口只为让 [FamilyPairingViewModel] 可纯单测 (DIDManager 是 final concrete)。
 */
interface LocalDidProvider {
    /** 本机当前 DID (`did:key:...`)；未创建身份时为 null。 */
    fun currentDid(): String?

    /**
     * 返回本机 DID；**若还没有身份则现场创建一个真实 `did:key:` 再返回**。
     *
     * 关键 (#3 家长端看不到家人)：「本机角色」选择只存角色偏好、**不创建 DID**(RoleSelector
     * 不碰 DIDManager)，于是只设了角色没去 KeyManagement 建身份的用户在配对时 currentDid()==null，
     * 配对/同步全部失败。配对入口改用本方法，缺身份即自动补建，让配对开箱即用。
     * 注：此处走无助记词快速创建 (同 KeyManagement 快速档)；助记词备份引导是后续 UX。
     */
    suspend fun ensureDid(): String?
}

@Singleton
class DidManagerLocalDidProvider @Inject constructor(
    private val didManager: DIDManager,
) : LocalDidProvider {
    override fun currentDid(): String? = didManager.getCurrentDID()

    override suspend fun ensureDid(): String? {
        didManager.getCurrentDID()?.let { return it }
        // keystore/Ed25519 生成可能耗时，放 IO 线程避免主线程 ANR。
        return withContext(Dispatchers.IO) {
            runCatching { didManager.createIdentity() }.getOrNull()
            didManager.getCurrentDID()
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class LocalDidProviderModule {
    @Binds
    @Singleton
    abstract fun bindLocalDidProvider(impl: DidManagerLocalDidProvider): LocalDidProvider
}
