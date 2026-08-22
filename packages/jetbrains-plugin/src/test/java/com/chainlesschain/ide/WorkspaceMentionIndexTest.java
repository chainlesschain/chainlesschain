package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class WorkspaceMentionIndexTest {
    @Test
    void incrementallyUpdatesMetadataAndRejectsDeniedOrOutsidePaths() {
        WorkspaceMentionIndex index =
                new WorkspaceMentionIndex(List.of("/workspace"), true);
        assertTrue(index.upsertPath("/workspace/src/app.java"));
        long revision = index.snapshot().workspaceRevision;
        assertTrue(index.upsertPath("/workspace/src/next.java"));
        assertEquals(revision + 1, index.snapshot().workspaceRevision);
        assertFalse(index.upsertPath("/outside/private.txt"));
        assertFalse(index.upsertPath("/workspace/.git/config"));
        assertEquals("workspace/src/app.java",
                WorkspaceMentionIndex.relativeToRoots(
                        "/workspace/src/app.java", List.of("/")));
        assertTrue(index.removePath("/workspace/src/next.java"));
        assertEquals(1, index.snapshot().pathCount);
        assertEquals(0, index.snapshot().contentReadCount);
    }

    @Test
    void cancelsOldGenerationAndRejectsChangedWorkspaceRevision() {
        WorkspaceMentionIndex index =
                new WorkspaceMentionIndex(List.of("/workspace"), true);
        index.upsertPath("/workspace/src/a.java");
        WorkspaceMentionIndex.QueryTicket first = index.beginQuery();
        WorkspaceMentionIndex.QueryTicket second = index.beginQuery();
        assertTrue(index.query(first, "a").cancelled);

        WorkspaceMentionIndex.QueryResult beforeChange = index.query(second, "a");
        index.touchWorkspace();
        assertFalse(index.commit(second, beforeChange));
        assertEquals(0, index.snapshot().staleCommitCount);
    }

    @Test
    void capsCandidatesAndHidesUntrustedWorkspaceMetadata() {
        List<String> paths = new ArrayList<>();
        for (int item = 0; item < 500; item++) {
            paths.add("/workspace/src/file" + item + ".java");
        }
        WorkspaceMentionIndex trusted =
                new WorkspaceMentionIndex(List.of("/workspace"), true);
        trusted.replacePaths(paths);
        WorkspaceMentionIndex.QueryTicket ticket = trusted.beginQuery();
        WorkspaceMentionIndex.QueryResult result = trusted.query(ticket, "file");
        assertTrue(trusted.commit(ticket, result));
        assertEquals(WorkspaceMentionIndex.MAX_CANDIDATES, result.items.size());

        WorkspaceMentionIndex untrusted =
                new WorkspaceMentionIndex(List.of("/workspace"), false);
        assertEquals(0, untrusted.replacePaths(paths));
        WorkspaceMentionIndex.QueryTicket untrustedTicket = untrusted.beginQuery();
        assertTrue(untrusted.query(untrustedTicket, "file").items.isEmpty());
    }
}
