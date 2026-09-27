package com.chainlesschain.ide;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.CompletableFuture;

/** Live question ownership, field recovery, and at-most-once response dispatch per request instance.
 * Disk drafts are editable data only. Only a fresh request from the owning child can grant response authority.
 */
public final class QuestionDraftRegistry {
    public enum State { DRAFT, SAVING, AWAITING, UNKNOWN, RESOLVED, ARCHIVED }
    public static final class Entry {
        private final Object owner, generation;
        private final String sessionId, digest, requestId;
        private final Map<String, Object> request;
        private final List<QuestionDraftContract.Field> fields;
        private String recordId = ChatDraftStore.newKey();
        private Map<String, Object> values = Map.of();
        private State state = State.DRAFT;
        private long revision;
        private long savedRevision = -1;
        private boolean loaded, loading, claimed, ready;
        private String message = "Loading saved fields…";
        private Entry(Object owner, Object generation, String sessionId, Map<String, Object> request) throws IOException {
            this.owner = owner; this.generation = generation; this.sessionId = sessionId;
            this.request = QuestionDraftContract.snapshot(request);
            if (!(request.get("id") instanceof String id) || id.isBlank() || id.length() > 1024)
                throw new IOException("Invalid question request identity");
            this.requestId = id;
            this.digest = QuestionDraftContract.identity(sessionId, this.request);
            this.fields = QuestionDraftContract.fields(this.request);
        }
        public Object owner() { return owner; }
        public Object generation() { return generation; }
        public String sessionId() { return sessionId; }
        public Map<String, Object> request() { return request; }
        public List<QuestionDraftContract.Field> fields() { return fields; }
    }
    public record View(State state, Map<String, Object> values, boolean loaded, boolean saved, String message) {}
    private final ChatDraftStore store;
    private final String key;
    private final List<Entry> entries = new ArrayList<>();
    private Object owner, generation;
    private String sessionId;
    private Runnable changed = () -> {};

    public QuestionDraftRegistry(ChatDraftStore store, String key) { this.store = store; this.key = key; }
    /** Listener must schedule UI work, never perform blocking I/O. */
    public synchronized void onChange(Runnable listener) { changed = listener; }
    public synchronized View view(Entry entry) { return new View(entry.state, entry.values, entry.loaded, entry.savedRevision == entry.revision, entry.message); }
    public synchronized boolean owns(Entry entry) {
        return entries.contains(entry) && entry.owner == owner && entry.generation == generation
                && Objects.equals(entry.sessionId, sessionId) && owner != null;
    }
    public synchronized boolean editable(Entry entry) { return owns(entry) && entry.state == State.DRAFT; }
    public synchronized void bind(Object owner, Object generation, String sessionId) {
        if (this.owner == owner && this.generation == generation && Objects.equals(this.sessionId, sessionId)) return;
        detach("Agent changed; saved answers remain available for editing");
        entries.clear(); // Old-generation forms keep their data but can never own a response again.
        this.owner = owner; this.generation = generation; this.sessionId = sessionId;
    }
    public synchronized void detach(String reason) {
        owner = null; generation = null; sessionId = null;
        for (Entry entry : entries) archive(entry, reason);
    }
    public synchronized Entry open(Map<String, Object> request) throws IOException {
        if (owner == null || sessionId == null) throw new IOException("The requesting agent is no longer active");
        if (request.get("sessionId") != null && !sessionId.equals(request.get("sessionId")))
            throw new IOException("Question belongs to a different session");
        if (request.get("binding") instanceof Map<?, ?> binding && binding.get("sessionId") != null && !sessionId.equals(binding.get("sessionId")))
            throw new IOException("Question binding belongs to a different session");
        Entry candidate = new Entry(owner, generation, sessionId, request);
        for (Entry entry : entries) if (owns(entry) && entry.digest.equals(candidate.digest)) return entry;
        for (Entry entry : entries) if (owns(entry) && entry.requestId.equals(candidate.requestId))
            archive(entry, "Question replaced; saved fields require review");
        // Retain terminal identities for this child so a replay cannot revive an old response authority.
        if (entries.size() >= 256) throw new IOException("Question history limit reached; restart the agent before accepting more requests");
        entries.add(candidate);
        load(candidate);
        return candidate;
    }
    /** Explicit retry is safe before dispatch; a failed load must not be treated as an empty draft. */
    public synchronized void retry(Entry entry) {
        if (!editable(entry)) return;
        if (entry.loaded) save(entry); else if (!entry.loading) load(entry);
    }
    private void load(Entry candidate) {
        candidate.loading = true;
        ChatDraftTasks.submit(() -> store.load(key)).whenComplete((draft, error) -> {
            synchronized (QuestionDraftRegistry.this) {
                candidate.loading = false;
                if (error != null) {
                    // Never overwrite an unreadable record, nor send a response whose backup failed.
                    candidate.message = "Cannot load saved questions: " + detail(error);
                } else {
                    ChatDraftStore.Question match = null;
                    boolean archivedMatch = false;
                    for (ChatDraftStore.Question saved : draft.questions()) {
                        if (saved.digest().equals(candidate.digest) && saved.sessionId().equals(candidate.sessionId)
                                && saved.requestId().equals(candidate.requestId)) {
                            if (saved.status().equals("archived")) archivedMatch = true;
                            else if (QuestionDraftContract.hasRecoveryBinding(candidate.sessionId, candidate.request)) match = saved;
                        }
                    }
                    try {
                        if (match != null) {
                            Map<String, Object> restored = QuestionDraftContract.normalize(candidate.fields, match.fields());
                            candidate.recordId = match.id();
                            if (candidate.revision == 0) { candidate.values = restored; candidate.savedRevision = 0; }
                        }
                        candidate.loaded = true;
                        if (candidate.state == State.DRAFT) candidate.message = match == null
                                ? archivedMatch ? "Earlier saved fields require review in Saved inputs; no answer restored" : "Answer when ready; fields are saved locally"
                                : "Saved fields restored for review; no answer sent";
                        // Edits made while loading must survive, and detach during loading must archive the adopted record.
                        if (candidate.revision != 0 || candidate.state != State.DRAFT) save(candidate);
                    } catch (IOException failure) { candidate.message = "Cannot restore saved fields: " + failure.getMessage(); }
                }
                changed.run();
            }
        });
    }
    public synchronized void edit(Entry entry, Map<String, Object> values) throws IOException {
        if (!editable(entry)) throw new IOException("This question is no longer editable");
        entry.values = QuestionDraftContract.normalize(entry.fields, values); entry.revision++;
    }
    public synchronized CompletableFuture<Void> save(Entry entry) {
        if (!entry.loaded) return CompletableFuture.failedFuture(new IOException("Saved questions have not loaded"));
        return ChatDraftTasks.submit(() -> {
            ChatDraftStore.Question record;
            long revision;
            synchronized (QuestionDraftRegistry.this) { record = record(entry); revision = entry.revision; }
            store.saveQuestion(key, record);
            synchronized (QuestionDraftRegistry.this) { entry.savedRevision = Math.max(entry.savedRevision, revision); }
            return (Void) null;
        }).whenComplete((ignored, error) -> {
            synchronized (QuestionDraftRegistry.this) {
                if (error != null) entry.message = "Question draft was not saved: " + detail(error);
                else if (entry.state == State.DRAFT) entry.message = "Fields saved locally; no answer sent";
                changed.run();
            }
        });
    }
    /** Reserve before async persistence so double clicks cannot enqueue two responses. */
    public synchronized CompletableFuture<Boolean> reserve(Entry entry) {
        if (!editable(entry) || !entry.loaded) return CompletableFuture.completedFuture(false);
        entry.state = State.SAVING; entry.message = "Saving fields before sending…"; changed.run();
        return save(entry).handle((ignored, error) -> {
            synchronized (QuestionDraftRegistry.this) {
                if (entry.state != State.SAVING || !owns(entry)) return false;
                if (error != null) {
                    entry.state = State.DRAFT; changed.run(); return false; // No pipe write has occurred.
                }
                entry.ready = true;
                return true;
            }
        });
    }
    /** Last check on the send worker. Always send to Entry.owner(), never a replacement child. */
    public synchronized boolean claim(Entry entry) {
        if (!owns(entry) || entry.state != State.SAVING || !entry.ready || entry.claimed) return false;
        entry.claimed = true; entry.state = State.AWAITING;
        entry.message = "Answer delivery pending; waiting for the CLI to resolve this question";
        changed.run(); return true;
    }
    public synchronized void deliveryFailed(Entry entry) {
        if (entry.state == State.RESOLVED || entry.state == State.ARCHIVED) return;
        entry.state = State.UNKNOWN;
        entry.message = "Answer delivery is unknown; review Saved inputs. It will not be retried automatically";
        changed.run();
    }
    public synchronized void event(Object owner, Object generation, String sessionId, String id, boolean resolved, String reason) {
        if (owner != this.owner || generation != this.generation || !Objects.equals(sessionId, this.sessionId)) return;
        boolean ambiguous = entries.stream().filter(e -> owns(e) && e.requestId.equals(id)).count() > 1;
        for (Entry entry : entries) if (owns(entry) && entry.requestId.equals(id)
                && entry.state != State.ARCHIVED && entry.state != State.RESOLVED) {
            entry.state = resolved && !ambiguous ? State.RESOLVED : State.UNKNOWN;
            entry.message = ambiguous ? "Question ID was reused; resolution cannot be confirmed. Review saved fields"
                    : resolved ? "Question resolved by the CLI" : "CLI rejected the answer: " + reason;
            if (entry.loaded) save(entry);
        }
        changed.run();
    }
    public synchronized void turnEnded() {
        for (Entry entry : entries) if (owns(entry) && !Boolean.FALSE.equals(entry.request.get("blocking"))
                && !"deferred".equals(entry.request.get("mode"))) archive(entry, "Turn ended; saved answer requires review");
    }
    public synchronized void cancelAll(String reason) { for (Entry entry : entries) archive(entry, reason); }
    private void archive(Entry entry, String reason) {
        if (entry.state == State.ARCHIVED || entry.state == State.RESOLVED) return;
        entry.state = State.ARCHIVED; entry.message = reason;
        if (entry.loaded) save(entry);
        changed.run();
    }
    private ChatDraftStore.Question record(Entry entry) {
        String title = Objects.toString(entry.request.get("question"), "Question");
        if (title.length() > 1024) title = title.substring(0, 1024);
        return new ChatDraftStore.Question(entry.recordId, entry.digest, entry.sessionId, entry.requestId, title,
                entry.values, QuestionDraftContract.text(entry.fields, entry.values), entry.state == State.DRAFT ? "draft" : "archived");
    }
    private static String detail(Throwable error) {
        while (error.getCause() != null) error = error.getCause();
        return Objects.toString(error.getMessage(), error.getClass().getSimpleName());
    }
}
