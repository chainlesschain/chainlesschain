package com.chainlesschain.android.feature.collaboration.data.manager

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * mergeConflictContent 单测：等值短路；冲突时产出规范 git 冲突标记（local 在 LOCAL 段、
 * remote 在 REMOTE 段、带 ======= 分隔符）。feature-collaboration 此前零单测。
 */
class MergeConflictContentTest {

    @Test
    fun `identical content returns it unchanged`() {
        assertEquals("same", mergeConflictContent("same", "same"))
    }

    @Test
    fun `conflicting content produces standard git markers`() {
        assertEquals(
            "<<<<<<< LOCAL\nmine\n=======\ntheirs\n>>>>>>> REMOTE",
            mergeConflictContent("mine", "theirs"),
        )
    }

    @Test
    fun `local sits under LOCAL and remote under REMOTE with a separator`() {
        val lines = mergeConflictContent("L", "R").lines()
        assertEquals("<<<<<<< LOCAL", lines[0])
        assertEquals("L", lines[1]) // local inside the markers, not before them
        assertEquals("=======", lines[2]) // separator present
        assertEquals("R", lines[3])
        assertEquals(">>>>>>> REMOTE", lines[4])
    }
}
