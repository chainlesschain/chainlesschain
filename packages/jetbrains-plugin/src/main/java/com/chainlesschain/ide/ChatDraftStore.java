package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Bounded local recovery data. Neither draft metadata nor a pipe write grants authority. */
public class ChatDraftStore {
    public static final int MAX_TEXT = 100_000;
    private static final int MAX_RECORD = 2 * 1024 * 1024;
    private static final long MAX_STORAGE = 100L * 1024 * 1024;
    private static final String KEY = "[a-f0-9-]{36}";
    private static final String SESSION = "[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}";
    private static final String IMAGE = "[a-f0-9]{64}\\.(png|jpg|jpeg|gif|webp)";
    private static final Map<Path, Object> LOCKS = new java.util.concurrent.ConcurrentHashMap<>();
    private final Path root;
    private final Object lock;

    public record Attachment(String file, long bytes, String hash) {}
    public record Content(String text, List<Attachment> images) {}
    public record Submission(String id, String sessionId, Content content, String status,
            String inputDigest, String worklogSessionId, String eventHash) {}
    public record Draft(String key, String sessionId, Content composer, List<Submission> submissions) {}
    public record Prepared(Submission submission, List<String> paths) {}

    public ChatDraftStore(Path root) {
        this.root = root.toAbsolutePath().normalize();
        this.lock = LOCKS.computeIfAbsent(this.root, ignored -> new Object());
    }
    public static String newKey() { return UUID.randomUUID().toString(); }
    public static boolean validKey(String key) { return key != null && key.matches(KEY); }
    public static String hash(byte[] data) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
    private static Content empty() { return new Content("", List.of()); }
    private Path directory(String key) throws IOException {
        if (!validKey(key)) throw new IOException("Invalid draft identity");
        return root.resolve(key);
    }
    private void plainDirectory(Path path) throws IOException {
        if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(path))
            throw new IOException("Draft storage must be a regular directory");
    }
    private void createDirectory(Path path) throws IOException {
        Files.createDirectories(path);
        plainDirectory(path);
    }
    private byte[] readBounded(Path path, int limit) throws IOException {
        BasicFileAttributes before = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!before.isRegularFile() || before.size() <= 0 || before.size() > limit)
            throw new IOException("Saved draft or attachment is invalid or too large");
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            if (channel.size() != before.size()) throw new IOException("Saved file changed while opening");
            ByteBuffer buffer = ByteBuffer.allocate((int) before.size() + 1);
            while (buffer.hasRemaining() && channel.read(buffer) != -1) { /* bounded */ }
            BasicFileAttributes after = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            if (buffer.position() != before.size() || !Objects.equals(before.fileKey(), after.fileKey())
                    || !before.lastModifiedTime().equals(after.lastModifiedTime()))
                throw new IOException("Saved file changed while reading");
            return Arrays.copyOf(buffer.array(), buffer.position());
        }
    }
    private static String string(Object value) throws IOException {
        if (!(value instanceof String text)) throw new IOException("Invalid saved draft text");
        return text;
    }
    private static String session(Object value) throws IOException {
        if (value == null) return null;
        String result = string(value);
        if (!result.matches(SESSION)) throw new IOException("Invalid draft session");
        return result;
    }
    private static Map<?, ?> object(Object value) throws IOException {
        if (!(value instanceof Map<?, ?> map)) throw new IOException("Invalid saved draft record");
        return map;
    }
    private static Content content(Object value) throws IOException {
        Map<?, ?> map = object(value);
        String text = string(map.get("text"));
        if (text.length() > MAX_TEXT) throw new IOException("Draft exceeds 100,000 characters");
        if (!(map.get("images") instanceof List<?> items) || items.size() > ImageAttachments.MAX)
            throw new IOException("Invalid draft attachments");
        List<Attachment> images = new ArrayList<>();
        long total = 0;
        for (Object item : items) {
            Map<?, ?> image = object(item);
            String name = string(image.get("file")), digest = string(image.get("hash"));
            if (!name.matches(IMAGE) || !digest.matches("[a-f0-9]{64}") || !name.startsWith(digest + ".")
                    || !(image.get("bytes") instanceof Number bytes) || bytes.doubleValue() != bytes.longValue()
                    || bytes.longValue() <= 0 || bytes.longValue() > ImageAttachments.MAX_IMAGE_BYTES)
                throw new IOException("Invalid saved image");
            total += bytes.longValue();
            images.add(new Attachment(name, bytes.longValue(), digest));
        }
        if (total > ImageAttachments.MAX_TURN_BYTES) throw new IOException("Saved images exceed 20 MiB");
        return new Content(text, List.copyOf(images));
    }
    public Draft load(String key) throws IOException {
        synchronized (lock) {
            Path dir = directory(key), file = dir.resolve("draft.json");
            if (!Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return new Draft(key, null, empty(), List.of());
            plainDirectory(root);
            if (!Files.exists(dir, LinkOption.NOFOLLOW_LINKS)) return new Draft(key, null, empty(), List.of());
            plainDirectory(dir);
            if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) return new Draft(key, null, empty(), List.of());
            try {
                Map<String, Object> map = MiniJson.parseObject(new String(readBounded(file, MAX_RECORD), StandardCharsets.UTF_8));
                if (!(map.get("version") instanceof Number n) || n.doubleValue() != 1 || !key.equals(map.get("key")))
                    throw new IOException("Unsupported saved draft");
                if (!(map.get("submissions") instanceof List<?> pending) || pending.size() > 8)
                    throw new IOException("Invalid saved inputs");
                List<Submission> submissions = new ArrayList<>();
                Set<String> ids = new HashSet<>();
                for (Object entry : pending) {
                    Map<?, ?> item = object(entry);
                    String id = string(item.get("id")), status = string(item.get("status"));
                    String digest = string(item.get("inputDigest"));
                    String sid = session(item.get("sessionId"));
                    if (!validKey(id) || !ids.add(id) || sid == null
                            || !Set.of("prepared", "unknown", "accepted").contains(status) || !digest.matches("[a-f0-9]{64}"))
                        throw new IOException("Invalid saved input identity");
                    String eventHash = item.get("eventHash") == null ? null : string(item.get("eventHash"));
                    if (eventHash != null && !eventHash.matches("[a-f0-9]{64}")) throw new IOException("Invalid saved receipt");
                    if ("accepted".equals(status) && eventHash == null) throw new IOException("Saved acceptance lacks its event hash");
                    submissions.add(new Submission(id, sid, content(item.get("content")), status, digest,
                            session(item.get("worklogSessionId")), eventHash));
                }
                return new Draft(key, session(map.get("sessionId")), content(map.get("composer")), List.copyOf(submissions));
            } catch (IllegalArgumentException error) { throw new IOException("Saved draft is unreadable; it was not overwritten", error); }
        }
    }
    private static Map<String, Object> encode(Content content) {
        return Map.of("text", content.text(), "images", content.images().stream()
                .map(a -> Map.of("file", a.file(), "bytes", a.bytes(), "hash", a.hash())).toList());
    }
    private long usage() throws IOException {
        long bytes = 0;
        int drafts = 0;
        if (!Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return 0;
        plainDirectory(root);
        try (DirectoryStream<Path> directories = Files.newDirectoryStream(root)) {
            for (Path dir : directories) {
                if (!validKey(dir.getFileName().toString())) continue;
                if (++drafts > 128) throw new IOException("Draft storage exceeds 128 conversations");
                plainDirectory(dir);
                int files = 0;
                try (DirectoryStream<Path> entries = Files.newDirectoryStream(dir)) {
                    for (Path file : entries) {
                        if (++files > 128) throw new IOException("Draft storage has too many files");
                        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Invalid draft storage entry");
                        bytes += Files.size(file);
                    }
                }
            }
        }
        return bytes;
    }
    protected void replace(Path temporary, Path target) throws IOException {
        Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }
    private void atomicWrite(Path target, byte[] bytes) throws IOException {
        Path temporary = target.resolveSibling(UUID.randomUUID() + ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                ByteBuffer data = ByteBuffer.wrap(bytes);
                while (data.hasRemaining()) channel.write(data);
                channel.force(true);
            }
            replace(temporary, target);
        } finally { Files.deleteIfExists(temporary); }
    }
    private void write(Draft draft) throws IOException {
        Path dir = directory(draft.key());
        createDirectory(root); createDirectory(dir);
        List<Map<String, Object>> submissions = new ArrayList<>();
        for (Submission input : draft.submissions()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", input.id()); item.put("sessionId", input.sessionId()); item.put("content", encode(input.content()));
            item.put("status", input.status()); item.put("inputDigest", input.inputDigest());
            item.put("worklogSessionId", input.worklogSessionId()); item.put("eventHash", input.eventHash());
            submissions.add(item);
        }
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("version", 1); record.put("key", draft.key()); record.put("sessionId", draft.sessionId());
        record.put("composer", encode(draft.composer())); record.put("submissions", submissions);
        byte[] bytes = MiniJson.stringify(record).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_RECORD || usage() + bytes.length > MAX_STORAGE)
            throw new IOException("Draft storage exceeds its 100 MiB or record limit");
        atomicWrite(dir.resolve("draft.json"), bytes);
        // Metadata is committed. Cleanup failure must not roll back referenced images.
        try {
            cleanup(draft);
            if (draft.composer().text().isEmpty() && draft.composer().images().isEmpty() && draft.submissions().isEmpty()) {
                Files.deleteIfExists(dir.resolve("draft.json"));
                Files.deleteIfExists(dir);
            }
        } catch (IOException ignored) { /* keep committed metadata and retry cleanup on a later write */ }
    }
    private void cleanup(Draft draft) throws IOException {
        Set<String> referenced = new HashSet<>();
        draft.composer().images().forEach(a -> referenced.add(a.file()));
        draft.submissions().forEach(s -> s.content().images().forEach(a -> referenced.add(a.file())));
        try (DirectoryStream<Path> files = Files.newDirectoryStream(directory(draft.key()))) {
            for (Path file : files) if (file.getFileName().toString().matches(IMAGE)
                    && !referenced.contains(file.getFileName().toString())) Files.deleteIfExists(file);
        }
        Path dir = directory(draft.key());
        if (!Files.exists(dir.resolve("draft.json"), LinkOption.NOFOLLOW_LINKS)) {
            try (DirectoryStream<Path> files = Files.newDirectoryStream(dir)) {
                if (!files.iterator().hasNext()) Files.deleteIfExists(dir);
            }
        }
    }
    private Content snapshot(String key, String text, List<String> paths) throws IOException {
        if (text == null || text.length() > MAX_TEXT) throw new IOException("Draft exceeds 100,000 characters");
        if (paths.size() > ImageAttachments.MAX) throw new IOException("Attach at most 4 images");
        Path dir = directory(key); createDirectory(root); createDirectory(dir);
        List<Attachment> images = new ArrayList<>();
        long total = 0;
        for (String source : paths) {
            Path path = Path.of(source);
            byte[] bytes = readBounded(path, (int) ImageAttachments.MAX_IMAGE_BYTES);
            total += bytes.length;
            if (total > ImageAttachments.MAX_TURN_BYTES) throw new IOException("Images exceed 20 MiB per message");
            String digest = hash(bytes), name = path.getFileName().toString().toLowerCase(Locale.ROOT);
            String targetName = digest + name.substring(name.lastIndexOf('.'));
            if (!targetName.matches(IMAGE)) throw new IOException("Invalid image format");
            Path target = dir.resolve(targetName);
            if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
                if (usage() + bytes.length + MAX_RECORD > MAX_STORAGE) throw new IOException("Draft storage exceeds 100 MiB");
                atomicWrite(target, bytes);
            }
            ImageAttachments.validateFile(target);
            if (!hash(readBounded(target, (int) ImageAttachments.MAX_IMAGE_BYTES)).equals(digest))
                throw new IOException("Saved image is changed; attach it again");
            images.add(new Attachment(targetName, bytes.length, digest));
        }
        return new Content(text, List.copyOf(images));
    }
    public List<String> paths(String key, Content content) throws IOException {
        synchronized (lock) {
            List<String> result = new ArrayList<>();
            for (Attachment image : content.images()) {
                if (!image.file().matches(IMAGE)) throw new IOException("Invalid saved image name");
                Path file = directory(key).resolve(image.file());
                plainDirectory(root); plainDirectory(directory(key));
                byte[] bytes = readBounded(file, (int) ImageAttachments.MAX_IMAGE_BYTES);
                if (bytes.length != image.bytes() || !hash(bytes).equals(image.hash())) throw new IOException("Saved image is missing or changed");
                ImageAttachments.validateFile(file);
                result.add(file.toString());
            }
            return List.copyOf(result);
        }
    }
    public Draft save(String key, String sessionId, String text, List<String> images) throws IOException {
        synchronized (lock) {
            Draft before = load(key);
            try {
                Draft after = new Draft(key, session(sessionId), snapshot(key, text, images), before.submissions());
                write(after); return after;
            } catch (IOException error) { try { cleanup(before); } catch (IOException ignored) { } throw error; }
        }
    }
    /** Preserve missing-image metadata while the user edits recoverable text. */
    public Draft saveText(String key, String sessionId, String text) throws IOException {
        synchronized (lock) {
            if (text == null || text.length() > MAX_TEXT) throw new IOException("Draft exceeds 100,000 characters");
            Draft before = load(key);
            Draft after = new Draft(key, session(sessionId), new Content(text, before.composer().images()), before.submissions());
            write(after); return after;
        }
    }
    public Prepared prepare(String key, String sessionId, String text, List<String> images, String worklog) throws IOException {
        synchronized (lock) {
            Draft before = load(key);
            if (session(sessionId) == null) throw new IOException("A canonical session is required");
            if (before.submissions().size() >= 8) throw new IOException("Review and discard saved inputs before sending more (limit 8)");
            try {
                Content content = snapshot(key, text, images);
                List<String> paths = paths(key, content);
                Map<String, Object> submitted = new LinkedHashMap<>();
                String sentText = text.isBlank() ? "Please look at the attached image(s)." : text;
                submitted.put("text", sentText); submitted.put("images", paths); submitted.put("llm", null);
                submitted.put("worklogSessionId", session(worklog));
                Submission input = new Submission(newKey(), sessionId, content, "prepared",
                        hash(MiniJson.stringify(submitted).getBytes(StandardCharsets.UTF_8)), worklog, null);
                List<Submission> next = new ArrayList<>(before.submissions()); next.add(input);
                write(new Draft(key, sessionId, empty(), List.copyOf(next)));
                return new Prepared(input, paths);
            } catch (IOException error) { try { cleanup(before); } catch (IOException ignored) { } throw error; }
        }
    }
    public void settle(String key, String id, Map<String, Object> receipt) throws IOException {
        synchronized (lock) {
            Draft before = load(key);
            List<Submission> next = new ArrayList<>(); boolean found = false;
            for (Submission input : before.submissions()) {
                if (!input.id().equals(id)) { next.add(input); continue; }
                found = true;
                if ("accepted".equals(input.status())) { next.add(input); continue; }
                String eventHash = null;
                if (receipt != null) {
                    // CLI parsing may discover typed image paths before computing this digest.
                    // Correlate the receipt by original session and random client ID, not a
                    // locally guessed digest of the unparsed wire payload.
                    if (!input.sessionId().equals(receipt.get("sessionId")) || !id.equals(receipt.get("clientMessageId"))
                            || !(receipt.get("inputDigest") instanceof String digest) || !digest.matches("[a-f0-9]{64}")
                            || !(receipt.get("eventHash") instanceof String hash) || !hash.matches("[a-f0-9]{64}"))
                        throw new IOException("Input receipt does not match the saved submission");
                    eventHash = (String) receipt.get("eventHash");
                }
                next.add(new Submission(id, input.sessionId(), input.content(), receipt == null ? "unknown" : "accepted",
                        receipt == null ? input.inputDigest() : (String) receipt.get("inputDigest"), input.worklogSessionId(), eventHash));
            }
            if (!found) throw new IOException("Saved submission is missing");
            write(new Draft(key, before.sessionId(), before.composer(), List.copyOf(next)));
        }
    }
    /** Caller must ensure no in-flight turn still consumes these attachments. */
    public void discardAcceptedWhenIdle(String key) throws IOException {
        synchronized (lock) {
            Draft before = load(key);
            if (before.submissions().stream().noneMatch(s -> "accepted".equals(s.status()))) return;
            write(new Draft(key, before.sessionId(), before.composer(), before.submissions().stream()
                    .filter(s -> !"accepted".equals(s.status())).toList()));
        }
    }
    /** Caller must ensure no in-flight turn still consumes these attachments. */
    public void discardSubmission(String key, String id) throws IOException {
        synchronized (lock) {
            Draft before = load(key);
            write(new Draft(key, before.sessionId(), before.composer(), before.submissions().stream().filter(s -> !s.id().equals(id)).toList()));
        }
    }
    public List<Draft> list() throws IOException {
        synchronized (lock) {
            if (!Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return List.of();
            usage();
            List<Draft> result = new ArrayList<>();
            try (DirectoryStream<Path> entries = Files.newDirectoryStream(root)) {
                for (Path path : entries) if (validKey(path.getFileName().toString())) {
                    Draft draft = load(path.getFileName().toString());
                    if (!draft.composer().text().isEmpty() || !draft.composer().images().isEmpty() || !draft.submissions().isEmpty()) result.add(draft);
                }
            }
            return List.copyOf(result);
        }
    }
}
