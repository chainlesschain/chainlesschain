package com.chainlesschain.android.presentation.familypairing

import com.chainlesschain.android.feature.familyguard.data.codec.InviteTokenCodec
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.GuardianTier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.AcceptanceCode
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.PairingResult
import com.chainlesschain.android.feature.familyguard.domain.model.pairing.SignedInvite
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.FamilyPermissions
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.service.InvitePairingService
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupSyncRecord
import com.chainlesschain.android.feature.familyguard.domain.sync.toEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FamilyPairingViewModelTest {

    private class FakeGroupRepo : FamilyGroupRepository {
        val groups = MutableStateFlow<List<FamilyGroupEntity>>(emptyList())
        var createCount = 0
        override suspend fun create(name: String, primaryDid: String, metadataJson: String?): FamilyGroupEntity {
            createCount++
            val e = FamilyGroupEntity(id = "g-$createCount", name = name, primaryDid = primaryDid, createdAt = 0L)
            groups.value = groups.value + e
            return e
        }
        override suspend fun findById(id: String): FamilyGroupEntity? = groups.value.firstOrNull { it.id == id }
        override suspend fun upsertReplica(record: FamilyGroupSyncRecord) {
            groups.value = groups.value.filterNot { it.id == record.id } + record.toEntity()
        }
        override fun observeAll(): Flow<List<FamilyGroupEntity>> = groups
        override suspend fun rename(id: String, newName: String): Boolean = false
        override suspend fun updateMetadata(id: String, newMetadataJson: String?): Boolean = false
        override suspend fun delete(id: String): Boolean = false
    }

    private class FakePairingService : InvitePairingService {
        var createResult = InvitePairingService.CreateInviteResult(
            signedInvite = SignedInvite(payloadJson = "{\"a\":1}", signatureB64 = "sig"),
            acceptanceCode = AcceptanceCode("123456"),
        )
        var acceptResult: PairingResult = PairingResult.WrongAcceptanceCode
        var acceptCalls = 0
        var lastForceKyc: Boolean? = null

        override suspend fun createInvite(
            familyGroupId: String,
            inviterDid: String,
            inviterRole: MemberRole,
            inviterTier: GuardianTier,
            inviteeRole: MemberRole,
            inviteeTier: GuardianTier?,
            proposedPermissions: FamilyPermissions,
            expectedChildAge: Int?,
        ): InvitePairingService.CreateInviteResult = createResult

        override suspend fun acceptInvite(
            qrPayload: String,
            acceptanceCode: AcceptanceCode,
            accepteeDid: String,
            accepteeDeviceId: String,
            reportedChildAge: Int,
            childPermissions: FamilyPermissions,
            forceKycAck: Boolean,
        ): PairingResult {
            acceptCalls++
            lastForceKyc = forceKycAck
            return acceptResult
        }
    }

    private fun successResult(relId: Long = 42L) = PairingResult.Success(
        relationship = FamilyRelationshipEntity(
            id = relId,
            familyGroupId = "g-1",
            friendDid = "did:chain:local-parent",
            roleSelf = "child",
            roleOther = "parent",
            boundAt = 0L,
            permissions = "{}",
            createdAt = 0L,
            updatedAt = 0L,
        ),
        revivalCode = RevivalCode("654321"),
    )

    private class FakeLocalDidProvider(var did: String? = "did:key:zParent") : LocalDidProvider {
        override fun currentDid(): String? = did
    }

    private lateinit var repo: FakeGroupRepo
    private lateinit var service: FakePairingService
    private lateinit var didProvider: FakeLocalDidProvider

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        repo = FakeGroupRepo()
        service = FakePairingService()
        didProvider = FakeLocalDidProvider()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun vm() = FamilyPairingViewModel(service, repo, didProvider)

    @Test
    fun `role selection transitions and reset returns to choose`() {
        val vm = vm()
        assertEquals(PairingMode.CHOOSE, vm.uiState.value.mode)
        vm.chooseParent()
        assertEquals(PairingMode.PARENT, vm.uiState.value.mode)
        vm.chooseChild()
        assertEquals(PairingMode.CHILD, vm.uiState.value.mode)
        vm.reset()
        assertEquals(PairingMode.CHOOSE, vm.uiState.value.mode)
    }

    @Test
    fun `createInvite creates a group and exposes token plus acceptance code`() = runTest {
        val vm = vm()
        vm.createInvite()
        val s = vm.uiState.value
        assertEquals(1, repo.createCount)
        assertEquals("123456", s.acceptanceCode)
        // token 必须是 InviteTokenCodec 编码后的 SignedInvite
        assertEquals(InviteTokenCodec.encode(service.createResult.signedInvite), s.inviteToken)
        assertFalse(s.busy)
    }

    @Test
    fun `createInvite reuses an existing family group`() = runTest {
        repo.groups.value = listOf(FamilyGroupEntity("g-existing", "我的家庭", "did:chain:local-parent", 0L))
        val vm = vm()
        vm.createInvite()
        assertEquals(0, repo.createCount)
        assertNotNull(vm.uiState.value.inviteToken)
    }

    @Test
    fun `createInvite without a local identity shows guidance and does nothing`() = runTest {
        didProvider.did = null
        val vm = vm()
        vm.createInvite()
        assertEquals(0, repo.createCount)
        assertNull(vm.uiState.value.inviteToken)
        assertNotNull(vm.uiState.value.message)
    }

    @Test
    fun `acceptInvite without a local identity shows guidance and does not call service`() = runTest {
        didProvider.did = null
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "15")
        assertEquals(0, service.acceptCalls)
        assertNotNull(vm.uiState.value.message)
    }

    @Test
    fun `acceptInvite rejects empty token without calling service`() = runTest {
        val vm = vm()
        vm.acceptInvite(token = "   ", code = "123456", ageText = "12")
        assertEquals(0, service.acceptCalls)
        assertNotNull(vm.uiState.value.message)
    }

    @Test
    fun `acceptInvite rejects non-6-digit code client-side`() = runTest {
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "12", ageText = "12")
        assertEquals(0, service.acceptCalls)
        assertTrue(vm.uiState.value.message!!.contains("接受码"))
    }

    @Test
    fun `acceptInvite rejects invalid age client-side`() = runTest {
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "0")
        assertEquals(0, service.acceptCalls)
        assertNotNull(vm.uiState.value.message)
    }

    @Test
    fun `acceptInvite wrong code maps to message`() = runTest {
        service.acceptResult = PairingResult.WrongAcceptanceCode
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "12")
        assertEquals(1, service.acceptCalls)
        assertTrue(vm.uiState.value.message!!.contains("接受码不对"))
    }

    @Test
    fun `acceptInvite kyc required raises kycPending`() = runTest {
        service.acceptResult = PairingResult.KycRequired(expectedChildAge = 13, reportedChildAge = 12)
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "12")
        assertTrue(vm.uiState.value.kycPending)
        assertFalse(vm.uiState.value.busy)
    }

    @Test
    fun `confirm kyc retries accept with forceKycAck and surfaces revival code`() = runTest {
        service.acceptResult = PairingResult.KycRequired(expectedChildAge = null, reportedChildAge = 12)
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "12")
        assertTrue(vm.uiState.value.kycPending)

        service.acceptResult = successResult()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "12", forceKycAck = true)
        assertEquals(true, service.lastForceKyc)
        val s = vm.uiState.value
        assertEquals("654321", s.revivalCode)
        assertEquals(42L, s.pairedRelationshipId)
        assertFalse(s.kycPending)
    }

    @Test
    fun `acceptInvite success surfaces revival code one-time`() = runTest {
        service.acceptResult = successResult(relId = 7L)
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "15")
        val s = vm.uiState.value
        assertEquals("654321", s.revivalCode)
        assertEquals(7L, s.pairedRelationshipId)
    }

    @Test
    fun `unknown family group maps to sync follow-up hint`() = runTest {
        service.acceptResult = PairingResult.UnknownFamilyGroup
        val vm = vm()
        vm.acceptInvite(token = "tok", code = "123456", ageText = "15")
        assertTrue(vm.uiState.value.message!!.contains("家庭组"))
        assertNull(vm.uiState.value.revivalCode)
    }
}
