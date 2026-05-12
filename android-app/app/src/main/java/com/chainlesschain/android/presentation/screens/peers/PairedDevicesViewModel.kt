package com.chainlesschain.android.presentation.screens.peers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.PeerInfo
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * v1.1 issue #19 W2.5：已配对设备 Settings 页 ViewModel。
 *
 * 数据：包 [P2PClient.connectedPeers] (Map<peerId, PeerInfo>) → 给 UI 暴露
 * 排序后的 List<PeerInfo>（按 connectedAt 升序，先连的排前）。
 *
 * 操作（v1.1 范围）：
 *  - [disconnectAll] — 全部断开（包 P2PClient.disconnect()）
 *
 * v1.2+ 留尾：
 *  - per-peer disconnect (P2PClient.disconnect(peerId) 待 W2.2 lifecycle 多 peer 后落)
 *  - 重命名 / 标记设备类别
 *  - 显示对端在线状态 ping / 最近消息时间
 */
@HiltViewModel
class PairedDevicesViewModel @Inject constructor(
    private val p2pClient: P2PClient,
) : ViewModel() {

    @Suppress("DEPRECATION") // connectedPeers 才是 v1.1 推荐 API；本处直接用
    val pairedDevices: StateFlow<List<PeerInfo>> = p2pClient.connectedPeers
        .map { map -> map.values.sortedBy { it.connectedAt } }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.Eagerly,
            initialValue = emptyList(),
        )

    /** 全部断开。v1.2 W2.2 lifecycle 多 peer 落地后改为 disconnectAll() vs disconnect(peerId) 两路。 */
    fun disconnectAll() {
        viewModelScope.launch {
            p2pClient.disconnect()
        }
    }
}
