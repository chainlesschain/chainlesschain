package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.di.IoDispatcher
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import javax.inject.Singleton

/**
 * §8.3 跨设备备份 P2P 栈 DI 接线 —— module 101 Phase 7.
 *
 * 把已建好的备份 P2P 组件装进 Hilt 图(均 @Singleton):
 *  - [InMemoryBackupBlockStore]:应答方块库(同步前装本机封装块供 pull、收 push 块待应用);
 *  - [P2PConnectionMessenger]:真 P2P 传输(包 core-p2p P2PConnectionManager;DID 惰性取);
 *  - [PdhP2PResponder]:requestId 关联 + 对称应答(onRequest 路由到 [PdhBackupRequestHandler])。
 *
 * 责任范围 = **传输栈**。Responder 惰性自启(首次 request 时 start(),幂等)→ 无需碰
 * MainActivity/AppInitializer 生命周期。其上的备份编排([PdhBackupCoordinator])用本机 DID
 * 派生 cipher([PdhBackupKey])+ 资产源([PdhVaultBridge] 等,待 CcVaultGateway 真实现)+
 * 把本机块封进 store,再经 [PdhBackupBlockChannel] 跑 sync —— 是上层 feature 接线(后续)。
 *
 * P2PConnectionManager / DIDManager 均 @Singleton @Inject,故本模块编译通过;CoroutineScope
 * 就地用 @IoDispatcher 创建(不引入新的 CoroutineScope 绑定,避免冲突)。
 */
@Module
@InstallIn(SingletonComponent::class)
object PdhBackupP2PModule {

    @Provides
    @Singleton
    fun provideBackupBlockStore(): InMemoryBackupBlockStore = InMemoryBackupBlockStore()

    @Provides
    @Singleton
    fun provideBackupBlockStoreSeam(
        impl: InMemoryBackupBlockStore,
    ): PdhBackupRequestHandler.BlockStore = impl

    @Provides
    @Singleton
    fun provideBackupMessenger(
        connectionManager: P2PConnectionManager,
        didManager: DIDManager,
    ): PdhP2PResponder.P2PMessenger =
        P2PConnectionMessenger(connectionManager) { didManager.getCurrentDID() ?: "" }

    @Provides
    @Singleton
    fun provideBackupResponder(
        messenger: PdhP2PResponder.P2PMessenger,
        store: PdhBackupRequestHandler.BlockStore,
        @IoDispatcher io: CoroutineDispatcher,
    ): PdhP2PResponder = PdhP2PResponder(
        messenger = messenger,
        scope = CoroutineScope(SupervisorJob() + io),
        onRequest = { type, data ->
            when (type) {
                PdhBackupBlockChannel.TYPE_PUSH -> PdhBackupRequestHandler.handlePush(data, store)
                PdhBackupBlockChannel.TYPE_PULL -> PdhBackupRequestHandler.handlePull(data, store)
                PdhBackupBlockChannel.TYPE_MANIFEST -> PdhBackupRequestHandler.handleManifest(store)
                else -> ByteArray(0)
            }
        },
    )
}
