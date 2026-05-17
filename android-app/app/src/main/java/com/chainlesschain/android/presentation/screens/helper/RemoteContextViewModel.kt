package com.chainlesschain.android.presentation.screens.helper

import androidx.lifecycle.ViewModel
import com.chainlesschain.android.core.p2p.pairing.PairedDesktop
import com.chainlesschain.android.core.p2p.pairing.PairedDesktopsStore
import com.chainlesschain.android.remote.client.SignalingRpcClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import timber.log.Timber
import javax.inject.Inject

/**
 * 迷你 helper VM — 让任意 Composable (e.g. ProjectDetailScreenV2) 读 paired
 * desktops，无需扩 feature-project ViewModel 的 module dep。
 *
 * Sub-phase 5-6 (2026-05-17): 项目详情页远程终端入口 fallback —
 * 当 project.sourcePeerId == null 但 project.pcRootPath != null（说明是从 PC 拉
 * 的但 sourcePeerId 字段未填）时，用首个 paired PC 的 pcPeerId 兜替。
 *
 * Sub-phase 5-6 fix (2026-05-17): 加 [findPcProjectPathByName] 让 LOCAL 项目设置
 * PC 路径时能从桌面 project.list 查同名项目自动预填。
 */
@HiltViewModel
class RemoteContextViewModel @Inject constructor(
    pairedDesktopsStore: PairedDesktopsStore,
    private val rpc: SignalingRpcClient,
) : ViewModel() {
    val pairedDesktops: StateFlow<List<PairedDesktop>> = pairedDesktopsStore.devices

    /**
     * 调桌面 `project.list` RPC 找同名项目，返其 `pcRootPath`。
     * 失败 / 没找到 / 路径为空都返 null。3 秒超时（UI 等待要快）。
     */
    suspend fun findPcProjectPathByName(pcPeerId: String, name: String): String? {
        if (pcPeerId.isBlank() || name.isBlank()) return null
        return runCatching {
            val res = rpc.invoke(
                pcPeerId,
                "project.list",
                mapOf("limit" to 500),
                timeoutMs = 5_000L,
            )
            val json = res.getOrNull()
            if (json == null) {
                Timber.w("[RemoteCtxVM] project.list failed: %s", res.exceptionOrNull()?.message)
                return@runCatching null
            }
            val arr = json.optJSONArray("projects")
            Timber.i(
                "[RemoteCtxVM] project.list ok: total=%d looking for name=%s",
                arr?.length() ?: -1, name,
            )
            if (arr == null) return@runCatching null
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val itemName = item.optString("name")
                if (itemName == name) {
                    val rawPc = if (item.isNull("pcRootPath")) "" else item.optString("pcRootPath", "")
                    val rawRoot = if (item.isNull("rootPath")) "" else item.optString("rootPath", "")
                    Timber.i(
                        "[RemoteCtxVM] match #%d name=%s pcRootPath=%s rootPath=%s",
                        i, itemName, rawPc.ifBlank { "<null/empty>" }, rawRoot.ifBlank { "<null/empty>" },
                    )
                    val path = rawPc.takeIf { it.isNotBlank() } ?: rawRoot.takeIf { it.isNotBlank() }
                    if (path != null) return@runCatching path
                }
            }
            Timber.w("[RemoteCtxVM] no match for name=%s (scanned %d projects)", name, arr.length())
            null
        }.onFailure { Timber.w(it, "[RemoteCtxVM] project.list lookup exception") }.getOrNull()
    }

    /**
     * Sub-phase 5-6 fix (2026-05-17): 把 Android 端用户输入的 PC 路径推到桌面
     * `projects.pc_root_path`，让其它设备 project.list 能拿到值。fire-and-forget，
     * 失败 silent 不阻塞本地 dialog 关闭 / 终端打开流程。3s 超时。
     */
    suspend fun pushPcRootPathToDesktop(
        pcPeerId: String,
        projectId: String,
        pcRootPath: String,
    ): Boolean {
        if (pcPeerId.isBlank() || projectId.isBlank()) return false
        return runCatching {
            val res = rpc.invoke(
                pcPeerId,
                "project.updatePath",
                mapOf("projectId" to projectId, "pcRootPath" to pcRootPath),
                timeoutMs = 3_000L,
            )
            val json = res.getOrNull()
            val ok = json?.optBoolean("ok", false) == true
            Timber.i(
                "[RemoteCtxVM] project.updatePath → projectId=%s ok=%s err=%s",
                projectId,
                ok,
                if (ok) "-" else json?.optString("error", "?") ?: res.exceptionOrNull()?.message,
            )
            ok
        }.onFailure { Timber.w(it, "[RemoteCtxVM] project.updatePath exception") }.getOrDefault(false)
    }
}
