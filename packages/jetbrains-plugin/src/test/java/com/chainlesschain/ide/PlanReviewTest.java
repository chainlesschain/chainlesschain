package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PlanReviewTest {
    @Test
    void markdownRendersEditableReviewDocument() {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", "p1");
        item.put("title", "Update ConversationView");
        item.put("tool", "edit_file");
        item.put("impact", "medium");
        item.put("status", "pending");
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("state", "awaiting_approval");
        plan.put("items", List.of(item));

        String md = PlanReview.markdown(
                plan, "Chat 1", "sess-1", Instant.parse("2026-07-10T00:00:00Z"));

        assertTrue(md.contains("# ChainlessChain Plan Review"));
        assertTrue(md.contains("Conversation: Chat 1"));
        assertTrue(md.contains("Session: sess-1"));
        assertTrue(md.contains("edit_file: Update ConversationView"));
        assertTrue(md.contains("## Reviewer Notes"));
    }

    @Test
    void reviewRecordTrimsSnapshotAndPlanEventCarriesIt() {
        String longText = "x".repeat(25000);
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("plan_id", "plan-1");
        plan.put("items", List.of(Map.of(
                "id", "p1", "title", "one", "tool", "edit_file")));
        Map<String, Object> review = PlanReview.reviewRecord(
                "approve",
                longText,
                "conv-1",
                "Chat",
                "sess-1",
                plan,
                2,
                "acceptEdits",
                Instant.parse("2026-07-10T00:00:00Z"));

        assertEquals("approve", review.get("action"));
        assertEquals(1, review.get("itemCount"));
        assertTrue(String.valueOf(review.get("snapshot")).contains("review snapshot truncated"));
        @SuppressWarnings("unchecked")
        Map<String, Object> lock = (Map<String, Object>) review.get("executionLock");
        assertEquals("plan-1", lock.get("planId"));
        assertEquals("acceptEdits", lock.get("permissionMode"));
        assertTrue(((List<?>) lock.get("allowedTools")).contains("edit_file"));
        assertTrue(!((List<?>) lock.get("allowedTools")).contains("run_shell"));

        Map<String, Object> ev = PlanReview.planEvent("approve", review);
        assertEquals("plan", ev.get("type"));
        assertEquals("approve", ev.get("action"));
        assertEquals(review, ev.get("review"));
        assertTrue(MiniJson.stringify(ev).contains("\"review\""));
    }

    @Test
    void feedbackPromptAsksForPlanRevision() {
        String prompt = PlanReview.feedbackPrompt("requestChanges", "# Notes");
        assertTrue(prompt.contains("Revise the plan"));
        assertTrue(prompt.contains("# Notes"));
    }

    @Test
    void structuralRevisionDiffPreservesReviewerTextAndIgnoresProgress() {
        Map<String, Object> previous = Map.of(
                "plan_id", "plan-1",
                "plan_version", 1,
                "items", List.of(
                        Map.of("id", "p1", "title", "Edit config",
                                "tool", "edit_file", "impact", "low", "status", "pending"),
                        Map.of("id", "p2", "title", "Run tests",
                                "tool", "run_shell", "impact", "medium")));
        Map<String, Object> next = Map.of(
                "plan_id", "plan-2",
                "plan_version", 2,
                "items", List.of(
                        Map.of("id", "p1", "title", "Edit safe config",
                                "tool", "edit_file", "impact", "medium", "status", "completed"),
                        Map.of("id", "p3", "title", "Run unit tests",
                                "tool", "run_shell", "impact", "low")));
        Map<String, Object> diff = PlanReview.planRevisionDiff(previous, next);
        assertEquals(true, diff.get("hasChanges"));
        assertEquals(1, ((List<?>) diff.get("added")).size());
        assertEquals(1, ((List<?>) diff.get("removed")).size());
        assertEquals(1, ((List<?>) diff.get("changed")).size());

        String review = "# Review\n\n## Reviewer Notes\n\n- Keep this note";
        String merged = PlanReview.mergeRevisionDiff(review, previous, next);
        assertTrue(merged.contains(PlanReview.PLAN_DIFF_START));
        assertTrue(merged.contains("1 added, 1 removed, 1 changed"));
        assertTrue(merged.contains("Keep this note"));
        assertEquals(merged.indexOf(PlanReview.PLAN_DIFF_START),
                merged.lastIndexOf(PlanReview.PLAN_DIFF_START));

        Map<String, Object> progressOnly = Map.of("items", List.of(
                Map.of("id", "p1", "title", "Edit", "tool", "edit_file",
                        "status", "completed")));
        Map<String, Object> pending = Map.of("items", List.of(
                Map.of("id", "p1", "title", "Edit", "tool", "edit_file",
                        "status", "pending")));
        assertEquals(false, PlanReview.planRevisionDiff(pending, progressOnly).get("hasChanges"));
    }

    @Test
    void persistedDraftsAreVersionedBoundedReplacedAndRestoredBySession() {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("active", true);
        plan.put("state", "awaiting_approval");
        plan.put("items", java.util.stream.IntStream.range(0, 140)
                .mapToObj(i -> Map.of("id", "p-" + i, "title", "t".repeat(600)))
                .toList());
        Map<String, Object> first = PlanReview.persistedState(
                "x".repeat(25000), "conv-1", "Chat", "sess-1", plan,
                "draft", "", null, Instant.parse("2026-07-22T00:00:00Z"));
        Map<String, Object> second = PlanReview.persistedState(
                "# Review\nupdated comment", "conv-after-restart", "Chat", "sess-1", plan,
                "changes_requested", "requestChanges", first,
                Instant.parse("2026-07-22T00:01:00Z"));

        assertEquals(1, first.get("revision"));
        assertEquals(2, second.get("revision"));
        assertTrue(String.valueOf(first.get("snapshot")).contains("truncated"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>)
                ((Map<String, Object>) first.get("plan")).get("items");
        assertEquals(128, items.size());
        assertEquals(512, String.valueOf(items.get(0).get("title")).length());

        List<Map<String, Object>> stored = PlanReview.upsertPersistedState(List.of(first), second);
        assertEquals(1, stored.size());
        assertEquals(second, PlanReview.findPersistedState(stored, "sess-1", "different-conv"));
        assertEquals(null, PlanReview.normalizePersistedState(Map.of("schema", "unknown")));
    }

    @Test
    void persistedDraftListIsCappedAtTwenty() {
        Object stored = new java.util.ArrayList<Map<String, Object>>();
        for (int i = 0; i < 25; i++) {
            Map<String, Object> state = PlanReview.persistedState(
                    "draft", "c-" + i, "Chat", "s-" + i,
                    Map.of("active", true), "draft", "", null, Instant.now());
            stored = PlanReview.upsertPersistedState(stored, state);
        }
        assertEquals(20, ((List<?>) stored).size());
        assertEquals(null, PlanReview.findPersistedState(stored, "s-0", ""));
        assertTrue(PlanReview.findPersistedState(stored, "s-24", "") != null);
    }

    @Test
    void commentsCarryItemFileLineColumnAndTurnAttribution() {
        String document = String.join("\n",
                "# ChainlessChain Plan Review",
                "",
                "## Plan Items",
                "",
                "1. edit_file: Edit config",
                "   - id: p1",
                "   - impact: medium",
                "   - status: pending",
                "   - comment: Keep src/config.ts:42:7 backwards compatible",
                "",
                "## Reviewer Notes",
                "",
                "- Add a migration test");

        List<Map<String, Object>> comments = PlanReview.extractComments(document, 3);
        assertEquals(2, comments.size());
        assertEquals("p1", comments.get(0).get("itemId"));
        assertEquals("src/config.ts", comments.get(0).get("file"));
        assertEquals(42, comments.get(0).get("line"));
        assertEquals(7, comments.get(0).get("column"));
        assertEquals(3, comments.get(0).get("turn"));
        assertEquals("Add a migration test", comments.get(1).get("text"));
    }

    @Test
    void progressMergePreservesReviewerText() {
        String document = String.join("\n",
                "1. edit_file: Edit config",
                "   - id: p1",
                "   - impact: medium",
                "   - status: approved",
                "   - comment: Keep this note");
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", "p1");
        item.put("title", "Edit config");
        item.put("tool", "edit_file");
        item.put("status", "completed");
        item.put("turn", 2);
        item.put("tool_use_id", "tu-4");
        item.put("started_at", "2026-07-23T00:00:00Z");
        item.put("completed_at", "2026-07-23T00:00:01Z");

        String merged = PlanReview.mergeProgress(document, Map.of("items", List.of(item)));
        assertTrue(merged.contains("- status: completed"));
        assertTrue(merged.contains("turn 2; tool use tu-4"));
        assertTrue(merged.contains("- comment: Keep this note"));
    }
}
