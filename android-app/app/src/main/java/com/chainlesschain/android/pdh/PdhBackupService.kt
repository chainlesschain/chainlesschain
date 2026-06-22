package com.chainlesschain.android.pdh

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.security.strongbox.KeystoreFacade

/**
 * §8.3 跨设备备份编排服务(接线层)—— module 101 Phase 7.
 *
 * 把已建好的所有 §8.3 组件组合成"对一台已连接的自有设备做一次备份同步":
 *  1. 由本机 DID 派生备份密钥([PdhBackupKey] → StrongBox/TEE)得到 cipher;
 *  2. **播种本机块库**([seedLocalStore]):读各资产源、加密成块、灌进
 *     [InMemoryBackupBlockStore] —— 这样对端能从本机 pull 到本机的块([PdhP2PResponder]
 *     的应答侧服务此库);
 *  3. 握手取对端清单([PdhBackupBlockChannel.fetchManifest]);
 *  4. 跑端到端双向同步([PdhBackupCoordinator.sync]):推本端独有 / 拉对端独有 / 解密校验 /
 *     按类型合并 / 写回资产源。
 *
 * **双向收敛靠两端各跑一次**:A 调 syncWith(B) 会播种 A 库并从 B 拉;B 调 syncWith(A) 同理。
 * 故两端都须先播种自己的库,对方才拉得到 —— 真机多设备时序由 UI/会话编排保证(2 真机验收)。
 *
 * 资产源 = [PdhVaultBridge](经 [CcRunnerVaultGateway])+ [PdhFileAssetSource](记忆/技能/
 * instinct 暂存)。cipher 用 [KeystoreFacade] seam(真 StrongBox);DID 来自 [DIDManager]。
 * 播种 + 编排可单测(fake 源 / fake facade / 配对 responder);真 P2P 收发与多设备时序是设备集成。
 */
class PdhBackupService(
    private val facade: KeystoreFacade,
    private val didManager: DIDManager,
    private val store: InMemoryBackupBlockStore,
    private val responder: PdhP2PResponder,
    private val sourcesProvider: () -> List<PdhBackupCoordinator.AssetSource>,
    private val codec: PdhBackupCoordinator.RecordCodec = PdhRecordCodec,
) {

    sealed class Result {
        data class Ok(val outcome: PdhBackupCoordinator.SyncOutcome) : Result()
        data class Failed(val reason: String) : Result()
    }

    /**
     * 播种本机块库:读各资产源全部记录 → 加密成内容寻址块 → 灌进 [store],供对端 pull。
     * 返回灌入块数。幂等(同内容同 hash 覆盖同键)。
     */
    fun seedLocalStore(cipher: PdhBackupEnvelope.BackupCipher): Int {
        var count = 0
        for (src in sourcesProvider()) {
            for (record in src.read()) {
                store.put(PdhBackupEnvelope.seal(src.kind, codec.encode(record), cipher))
                count += 1
            }
        }
        return count
    }

    /**
     * 对已连接的对端 [peerId] 做一次备份同步(播种本机库 → 取对端清单 → 跑协调器)。
     * DID 缺失 / 对端清单取不到(未就绪/不可达)→ [Result.Failed]。
     */
    suspend fun syncWith(peerId: String): Result {
        val did = didManager.getCurrentDID()
            ?: return Result.Failed("no current DID — finish onboarding (§7.3) first")
        PdhBackupKey.ensureKey(facade, did)
        val cipher = PdhBackupKey.cipherFor(facade, did)
        seedLocalStore(cipher) // 先播种,对端才 pull 得到本机块
        val channel = PdhBackupBlockChannel(peerId, responder)
        val remoteManifest = channel.fetchManifest()
            ?: return Result.Failed("peer manifest unavailable (peer not ready / unreachable)")
        val outcome = PdhBackupCoordinator.sync(sourcesProvider(), codec, cipher, channel, remoteManifest)
        return Result.Ok(outcome)
    }
}
