package com.chainlesschain.android.presentation.childselection

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import com.chainlesschain.android.feature.familyguard.domain.repository.SelectedChildStore
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChildSelectionViewModelTest {

    private class FakeSelectedChildStore : SelectedChildStore {
        val selected = MutableStateFlow<String?>(null)
        override fun observeSelectedChildDid() = selected
        override suspend fun setSelectedChild(childDid: String) { selected.value = childDid }
        override suspend fun clear() { selected.value = null }
    }

    private fun rel(friendDid: String, roleOther: String) = FamilyRelationshipEntity(
        id = 1L, familyGroupId = "fg", friendDid = friendDid,
        roleSelf = "parent", roleOther = roleOther, boundAt = 1L,
        permissions = "{}", status = "active", createdAt = 1L, updatedAt = 1L,
    )

    private lateinit var store: FakeSelectedChildStore

    @Before fun setUp() { Dispatchers.setMain(UnconfinedTestDispatcher()); store = FakeSelectedChildStore() }
    @After fun tearDown() = Dispatchers.resetMain()

    private fun vm(relations: List<FamilyRelationshipEntity>): ChildSelectionViewModel {
        val rels = mockk<FamilyRelationshipRepository>(relaxed = true)
        every { rels.observeAllActive() } returns flowOf(relations)
        return ChildSelectionViewModel(rels, store)
    }

    @Test
    fun `lists only active child relationships`() = runTest {
        val v = vm(listOf(rel("did:a", "child"), rel("did:p", "parent"), rel("did:b", "child")))
        val children = v.uiState.value.children
        assertEquals(2, children.size)
        assertEquals(listOf("did:a", "did:b"), children.map { it.did })
        assertNull(v.uiState.value.selectedDid)
    }

    @Test
    fun `select persists and reflects in state`() = runTest {
        val v = vm(listOf(rel("did:a", "child"), rel("did:b", "child")))
        v.select("did:b")
        assertEquals("did:b", store.selected.value)
        assertEquals("did:b", v.uiState.value.selectedDid)
    }

    @Test
    fun `stale selection not among children is not highlighted`() = runTest {
        store.selected.value = "did:gone"
        val v = vm(listOf(rel("did:a", "child")))
        assertNull(v.uiState.value.selectedDid)
    }
}
