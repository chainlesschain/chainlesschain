package com.chainlesschain.android.feature.p2p.call

import org.webrtc.*
import timber.log.Timber

/**
 * PeerConnection事件观察者
 *
 * 监听WebRTC PeerConnection的各种事件：
 * - ICE候选收集
 * - 连接状态变化
 * - 媒体流添加/移除
 * - 数据通道事件
 *
 * @param onIceCandidateReceived ICE候选收集回调
 * @param onStreamAdded 远程流添加回调
 * @param onStreamRemoved 远程流移除回调
 * @param onConnectionChange 连接状态变化回调
 *
 * @since v0.32.0
 */
class CallPeerConnectionObserver(
    private val onIceCandidateReceived: (IceCandidate) -> Unit = {},
    private val onStreamAdded: (MediaStream) -> Unit = {},
    private val onStreamRemoved: (MediaStream) -> Unit = {},
    private val onConnectionChange: (PeerConnection.PeerConnectionState) -> Unit = {}
) : PeerConnection.Observer {

    /**
     * 信令状态变化
     */
    override fun onSignalingChange(newState: PeerConnection.SignalingState?) {
        Timber.d("Signaling state changed: $newState")
    }

    /**
     * ICE连接状态变化
     */
    override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
        Timber.d("ICE connection state changed: $newState")

        when (newState) {
            PeerConnection.IceConnectionState.CONNECTED -> {
                Timber.i("ICE connection established")
            }
            PeerConnection.IceConnectionState.DISCONNECTED -> {
                Timber.w("ICE connection disconnected")
            }
            PeerConnection.IceConnectionState.FAILED -> {
                Timber.e("ICE connection failed")
            }
            PeerConnection.IceConnectionState.CLOSED -> {
                Timber.i("ICE connection closed")
            }
            else -> {
                // CHECKING, COMPLETED, NEW
            }
        }
    }

    /**
     * ICE连接收集状态变化
     */
    override fun onIceConnectionReceivingChange(receiving: Boolean) {
        Timber.d("ICE connection receiving: $receiving")
    }

    /**
     * ICE收集状态变化
     */
    override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {
        Timber.d("ICE gathering state changed: $newState")

        when (newState) {
            PeerConnection.IceGatheringState.GATHERING -> {
                Timber.d("ICE gathering started")
            }
            PeerConnection.IceGatheringState.COMPLETE -> {
                Timber.d("ICE gathering completed")
            }
            else -> {}
        }
    }

    /**
     * ICE候选收集
     */
    override fun onIceCandidate(candidate: IceCandidate?) {
        candidate?.let {
            Timber.d("New ICE candidate: ${it.sdp}")
            onIceCandidateReceived(it)
        }
    }

    /**
     * ICE候选移除
     */
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {
        Timber.d("ICE candidates removed: ${candidates?.size}")
    }

    /**
     * 添加远程流
     */
    override fun onAddStream(stream: MediaStream?) {
        stream?.let {
            Timber.i("Remote stream added: ${it.id}")
            Timber.d("  - Audio tracks: ${it.audioTracks.size}")
            Timber.d("  - Video tracks: ${it.videoTracks.size}")
            onStreamAdded(it)
        }
    }

    /**
     * 移除远程流
     */
    override fun onRemoveStream(stream: MediaStream?) {
        stream?.let {
            Timber.i("Remote stream removed: ${it.id}")
            onStreamRemoved(it)
        }
    }

    /**
     * 数据通道打开
     */
    override fun onDataChannel(dataChannel: DataChannel?) {
        dataChannel?.let {
            Timber.d("Data channel opened: ${it.label()}")
        }
    }

    /**
     * 需要重新协商
     */
    override fun onRenegotiationNeeded() {
        Timber.d("Renegotiation needed")
    }

    /**
     * 添加轨道
     */
    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
        Timber.d("Track added, streams: ${streams?.size}")
    }

    /**
     * 标准PeerConnection状态变化（推荐使用）
     */
    override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
        newState?.let {
            Timber.d("PeerConnection state changed: $it")
            onConnectionChange(it)

            when (it) {
                PeerConnection.PeerConnectionState.CONNECTED -> {
                    Timber.i("✅ PeerConnection connected")
                }
                PeerConnection.PeerConnectionState.DISCONNECTED -> {
                    Timber.w("⚠️ PeerConnection disconnected")
                }
                PeerConnection.PeerConnectionState.FAILED -> {
                    Timber.e("❌ PeerConnection failed")
                }
                PeerConnection.PeerConnectionState.CLOSED -> {
                    Timber.i("PeerConnection closed")
                }
                else -> {
                    // NEW, CONNECTING
                }
            }
        }
    }

    /**
     * 选择的ICE候选对变化
     */
    override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) {
        event?.let {
            Timber.d("Selected candidate pair changed:")
            Timber.d("  - Local: ${it.local}")
            Timber.d("  - Remote: ${it.remote}")
        }
    }
}
