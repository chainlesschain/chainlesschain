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
        plan.put("items", List.of(Map.of("title", "one")));
        Map<String, Object> review = PlanReview.reviewRecord(
                "approve",
                longText,
                "conv-1",
                "Chat",
                "sess-1",
                plan,
                Instant.parse("2026-07-10T00:00:00Z"));

        assertEquals("approve", review.get("action"));
        assertEquals(1, review.get("itemCount"));
        assertTrue(String.valueOf(review.get("snapshot")).contains("review snapshot truncated"));

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
}
