package com.chainlesschain.android.pdh

import android.content.Context
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

/**
 * §8.3 跨设备备份服务 DI 接线 —— module 101 Phase 7.
 *
 * 把 [CcRunnerVaultGateway] + [PdhBackupService] 装进 Hilt 图,使备份服务可被 UI @Inject。
 * 复用 [PdhBackupP2PModule] 提供的 [InMemoryBackupBlockStore] + [PdhP2PResponder],
 * core-security 的 [KeystoreFacade]、core-did 的 [DIDManager]、[LocalCcRunner] 均 @Singleton
 * @Inject(或 @Binds)→ 本模块编译即过 Hilt 图校验。
 *
 * **v1 资产源仅 vault**(经 [PdhVaultBridge] + [CcRunnerVaultGateway] 调真 `cc hub
 * export/import-events`)。记忆/技能/instinct 文件源待各自 cc 导出桥落地后,在
 * [providePdhBackupService] 的 sourcesProvider 里追加 [PdhFileAssetSource](暂存路径)。
 */
@Module
@InstallIn(SingletonComponent::class)
object PdhBackupServiceModule {

    @Provides
    @Singleton
    fun provideCcVaultGateway(
        runner: LocalCcRunner,
        @ApplicationContext context: Context,
    ): PdhVaultBridge.CcVaultGateway =
        CcRunnerVaultGateway(runner, File(context.cacheDir, "pdh-backup-import"))

    @Provides
    @Singleton
    fun providePdhBackupService(
        facade: KeystoreFacade,
        didManager: DIDManager,
        store: InMemoryBackupBlockStore,
        responder: PdhP2PResponder,
        ccVaultGateway: PdhVaultBridge.CcVaultGateway,
        runner: LocalCcRunner,
        @ApplicationContext context: Context,
    ): PdhBackupService = PdhBackupService(
        facade = facade,
        didManager = didManager,
        store = store,
        responder = responder,
        // vault(数据)+ memory(AI 对你的认知)两大高价值资产端到端备份。
        // instinct/trajectories/skills 同模式后续追加。
        sourcesProvider = {
            val tmp = File(context.cacheDir, "pdh-backup-import")
            listOf(
                PdhVaultBridge(ccVaultGateway), // 数据
                PdhMemoryAssetSource(runner, tmp), // AI 对你的认知(层次化记忆)
                // 学习层:习惯(instinct)+ 自进化轨迹(trajectories,含 synthesized skill)
                PdhCcRowsAssetSource(AssetKind.INSTINCTS, tmp, { runner.exportInstincts() }, { runner.importInstincts(it) }),
                PdhCcRowsAssetSource(AssetKind.TRAJECTORIES, tmp, { runner.exportTrajectories() }, { runner.importTrajectories(it) }),
            )
        },
    )
}
