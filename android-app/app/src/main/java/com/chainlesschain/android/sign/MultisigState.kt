package com.chainlesschain.android.sign

/**
 * 多签提案在 phone 端展示用的快照（v1.2 #20 P0.3）。
 *
 * 桌面 [`@chainlesschain/core-multisig`] (commit `3c890dcac`) 在发起 m-of-n 流程时把
 * 当前状态打到 `approval.request` envelope 的 `multisig` 字段，
 * [ApprovalCommandRouter] 反序列化后透传给 [AndroidApprovalGate]，[ApprovalDialogHost]
 * 据此渲染 X/Y 进度条。
 *
 * 字段语义：
 *  - [m] / [n]：阈值（"m-of-n"，例如 2-of-3）
 *  - [collected]：**本设备签名之前**桌面已收到的有效 partial signature 数量；用来
 *    判断本设备签完后是否达阈
 *  - [signerDids]：完整 signer DID 列表（包含本设备）；UI 可展示成员
 *  - [pendingSigners]：尚未提交签名的 DID 子集，*包含本设备*（桌面侧 push 来时本设备
 *    必然属于 pending，否则不会派 approval）
 *
 * 设备视角：
 *  - `isFinalSigner` = true → 本设备同意后链路完成，无需 toast
 *  - false → 本设备同意后仍需等剩余 signer（典型场景：phone 先签，desktop U-Key 后签）
 *
 * 协议层面这是 *snapshot*，并非实时；桌面侧在收到本设备 partial 后会用最新状态
 * fan-out 给其它 signer 设备。本类只服务于 phone-side dialog，没有 mutation。
 */
data class MultisigState(
    val m: Int,
    val n: Int,
    val collected: Int,
    val signerDids: List<String>,
    val pendingSigners: List<String>,
) {
    init {
        require(n >= 1) { "n must be >= 1, got $n" }
        require(m in 1..n) { "m must be in 1..n, got m=$m n=$n" }
        require(collected in 0..n) { "collected must be in 0..n, got collected=$collected n=$n" }
        require(signerDids.size == n) {
            "signerDids size must equal n=$n, got ${signerDids.size}"
        }
        // pendingSigners 必须是 signerDids 的子集（顺序无所谓）
        val unknown = pendingSigners - signerDids.toSet()
        require(unknown.isEmpty()) {
            "pendingSigners contains DIDs not in signerDids: $unknown"
        }
    }

    /** 本设备签完后是否达到阈值（即 collected+1 >= m）。 */
    fun isFinalSigner(): Boolean = collected + 1 >= m

    /** 本设备签完后还需的签名数；最少 0。 */
    fun remainingAfterThisSign(): Int = (m - collected - 1).coerceAtLeast(0)

    /** "X / Y" 进度字符串；X = 本设备签完后的累计计数，Y = m 阈值。 */
    fun progressLabel(): String = "${(collected + 1).coerceAtMost(m)} / $m"

    /** DID 短显示（v1.2 仅截前后缀，v1.3 起改 nickname/avatar）。 */
    fun shortDid(did: String): String {
        if (did.length <= 16) return did
        return did.take(10) + "…" + did.takeLast(6)
    }
}
