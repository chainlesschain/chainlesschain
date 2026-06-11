package com.chainlesschain.android.presentation.familyrewards

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.domain.enforce.RewardTempException
import com.chainlesschain.android.presentation.aistudy.Deliverable
import com.chainlesschain.android.presentation.aistudy.DeliverableKind
import com.chainlesschain.android.presentation.aistudy.InMemoryPointsLedger
import com.chainlesschain.android.presentation.aistudy.PointsEvent
import com.chainlesschain.android.presentation.aistudy.PointsEventType
import com.chainlesschain.android.presentation.aistudy.RewardCatalogItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.util.UUID

/**
 * M9 兑换 → M4 临时白名单端到端 (VM + 真 in-memory enforce_rules)。
 * earn 路径已被 PointsEngineTest / TaskCompletionEarnTest 覆盖, 这里聚焦 spend 联动。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class FamilyRewardsViewModelTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var ledger: InMemoryPointsLedger

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        ledger = InMemoryPointsLedger()
    }

    @After
    fun tearDown() {
        db.close()
        Dispatchers.resetMain()
    }

    private fun vm() = FamilyRewardsViewModel(ledger, db.enforceRuleDao(), db.rewardCatalogDao())

    private suspend fun fund(amount: Int) = ledger.append(
        PointsEvent(
            id = UUID.randomUUID().toString(),
            childDid = "did:chain:local-child",
            type = PointsEventType.GRANT,
            amount = amount,
            reason = "seed",
            granterDid = "did:chain:local-parent",
            timestamp = System.currentTimeMillis(),
        ),
    )

    private fun item(kind: DeliverableKind, value: Int, apps: List<String> = emptyList(), cost: Int = 30) =
        RewardCatalogItem(
            id = "r-test",
            familyGroupId = "local-family",
            name = "测试奖励",
            cost = cost,
            deliverable = Deliverable(kind, value, apps),
            maxPerDay = 0,
            createdBy = "did:chain:local-parent",
            createdAt = 1_000L,
        )

    @Test
    fun `approved app unlock redemption lands temp exception rows`() = runTest {
        fund(100)
        vm().redeem(item(DeliverableKind.APP_UNLOCK, 60, listOf("tv.danmaku.bili"))).join()

        val rules = db.enforceRuleDao().observeActiveNonExpired(System.currentTimeMillis()).first()
        assertEquals(1, rules.size)
        assertEquals(RewardTempException.RULE_TYPE, rules[0].ruleType)
        assertEquals("tv.danmaku.bili", rules[0].target)
        assertTrue(rules[0].expiresAt!! > System.currentTimeMillis())
        // 账本也真扣分
        assertEquals(70, ledger.balanceOf("did:chain:local-child", System.currentTimeMillis()).balance)
    }

    @Test
    fun `parent-executed reward spends points but delivers no device rule`() = runTest {
        fund(300)
        vm().redeem(item(DeliverableKind.FAMILY_ACTIVITY, 0, cost = 200)).join()

        assertEquals(100, ledger.balanceOf("did:chain:local-child", System.currentTimeMillis()).balance)
        assertTrue(db.enforceRuleDao().observeActiveNonExpired(System.currentTimeMillis()).first().isEmpty())
    }

    @Test
    fun `rejected redemption (insufficient balance) delivers nothing`() = runTest {
        fund(10)
        vm().redeem(item(DeliverableKind.APP_UNLOCK, 60, listOf("tv.danmaku.bili"))).join()

        assertEquals(10, ledger.balanceOf("did:chain:local-child", System.currentTimeMillis()).balance)
        assertTrue(db.enforceRuleDao().observeActiveNonExpired(System.currentTimeMillis()).first().isEmpty())
    }

    // ---- catalog 持久化 + 家长 CRUD (v9 reward_catalog) ----

    @Test
    fun `first run seeds the default catalog once`() = runTest {
        vm().seedDefaultCatalogIfEmpty()
        assertEquals(5, db.rewardCatalogDao().countForGroup("local-family"))
        vm().seedDefaultCatalogIfEmpty() // 二次构造/重复种: 固定 id 幂等
        assertEquals(5, db.rewardCatalogDao().countForGroup("local-family"))
    }

    @Test
    fun `parent can add and deactivate a catalog item`() = runTest {
        val viewModel = vm()
        viewModel.seedDefaultCatalogIfEmpty()
        viewModel.addCatalogItem(
            "额外阅读时间", cost = 40, kind = DeliverableKind.SCREEN_TIME_MIN, valueMinutes = 20,
        ).join()

        val active = db.rewardCatalogDao().observeActiveForGroup("local-family").first()
        assertEquals(6, active.size)
        val added = active.first { it.name == "额外阅读时间" }
        assertEquals(40, added.cost)
        assertEquals("SCREEN_TIME_MIN", added.deliverableKind)
        assertEquals(20, added.deliverableValue)

        // 下架默认项: 从 active 视图消失, 行保留 (软删)
        viewModel.deactivateCatalogItem(
            item(DeliverableKind.SCREEN_TIME_MIN, 30).copy(id = "r-game-30", name = "额外 30 分钟游戏"),
        ).join()
        val afterDeactivate = db.rewardCatalogDao().observeActiveForGroup("local-family").first()
        assertEquals(5, afterDeactivate.size)
        assertEquals(6, db.rewardCatalogDao().countForGroup("local-family"))
    }

    @Test
    fun `blank name or zero cost is rejected`() = runTest {
        val viewModel = vm()
        viewModel.seedDefaultCatalogIfEmpty()
        viewModel.addCatalogItem("   ", cost = 40, kind = DeliverableKind.CASH, valueMinutes = 0).join()
        viewModel.addCatalogItem("零价", cost = 0, kind = DeliverableKind.CASH, valueMinutes = 0).join()
        assertEquals(5, db.rewardCatalogDao().countForGroup("local-family"))
    }
}
