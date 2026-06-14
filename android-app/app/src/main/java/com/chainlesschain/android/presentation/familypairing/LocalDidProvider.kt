package com.chainlesschain.android.presentation.familypairing

import com.chainlesschain.android.core.did.manager.DIDManager
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
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
}

@Singleton
class DidManagerLocalDidProvider @Inject constructor(
    private val didManager: DIDManager,
) : LocalDidProvider {
    override fun currentDid(): String? = didManager.getCurrentDID()
}

@Module
@InstallIn(SingletonComponent::class)
abstract class LocalDidProviderModule {
    @Binds
    @Singleton
    abstract fun bindLocalDidProvider(impl: DidManagerLocalDidProvider): LocalDidProvider
}
