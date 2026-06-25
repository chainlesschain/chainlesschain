package com.chainlesschain.android.feature.blockchain.domain.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * gasCostNative 单测：gas 费用换算必须在 Double 域相乘，避免 Long 溢出（高 gas × 高
 * price 会翻成负数 → 显示出负的手续费）。feature-blockchain 此前零单测。
 */
class GasCostNativeTest {

    @Test
    fun `typical transfer cost`() {
        // 21000 gas × 20 Gwei = 0.00042 ETH
        assertEquals(0.00042, gasCostNative(21_000L, 20_000_000_000L), 1e-12)
    }

    @Test
    fun `high gas and price does not overflow to negative (regression)`() {
        // 1e7 gas × 1e12 wei = 1e19 > Long.MAX(9.22e18)：旧实现先用 Long 相乘会翻成
        // 负数（约 -8.45），修复后在 Double 域计算得正确的 10.0 ETH。
        val cost = gasCostNative(10_000_000L, 1_000_000_000_000L)
        assertEquals(10.0, cost, 1e-9)
        assertTrue("gas cost must be positive", cost > 0)
    }

    @Test
    fun `zero gas used yields zero cost`() {
        assertEquals(0.0, gasCostNative(0L, 20_000_000_000L), 0.0)
    }
}
