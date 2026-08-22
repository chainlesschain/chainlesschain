package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Bounded metadata-only file/symbol index for the JetBrains chat composer.
 * The class deliberately has no file-content API: callers supply VFS/PSI
 * metadata and every emitted path is checked against the trusted workspace.
 */
public final class WorkspaceMentionIndex {
    public static final int MAX_PATHS = 100_000;
    public static final int MAX_CANDIDATES = 200;
    private static final String[] IDE_MENTIONS = {
            "selection", "diagnostics", "terminal", "context"};
    private static final Set<String> DENIED_SEGMENTS = Set.of(
            ".git", ".hg", ".svn", "node_modules", "dist", "build", "out", "coverage");

    private final List<String> roots;
    private final boolean trusted;
    private final int maxPaths;
    private final LinkedHashMap<String, Entry> files = new LinkedHashMap<>();
    private final LinkedHashMap<String, Integer> folderRefs = new LinkedHashMap<>();
    private final LinkedHashMap<String, Entry> symbols = new LinkedHashMap<>();
    private long workspaceRevision;
    private long queryGeneration;
    private QueryTicket activeTicket;
    private long cancellationCount;
    private long discardedQueryCount;
    private long staleCommitCount;
    private long leakCount;
    private long deniedPathCount;

    public WorkspaceMentionIndex(Collection<String> roots, boolean trusted) {
        this(roots, trusted, MAX_PATHS);
    }

    public WorkspaceMentionIndex(Collection<String> roots, boolean trusted, int maxPaths) {
        this.roots = new ArrayList<>();
        if (roots != null) {
            for (String root : roots) {
                String normalized = canonicalPath(root);
                if (!normalized.isEmpty()) this.roots.add(normalized);
            }
        }
        this.trusted = trusted;
        this.maxPaths = Math.min(MAX_PATHS, Math.max(1, maxPaths));
    }

    public static final class QueryTicket {
        public final long generation;
        private long workspaceRevision;
        private boolean cancelled;
        private boolean completed;

        private QueryTicket(long generation, long workspaceRevision) {
            this.generation = generation;
            this.workspaceRevision = workspaceRevision;
        }

        public synchronized boolean isCancelled() {
            return cancelled;
        }
    }

    public static final class QueryResult {
        public final long generation;
        public final long workspaceRevision;
        public final boolean cancelled;
        public final List<Mentions.MentionItem> items;

        private QueryResult(long generation, long workspaceRevision,
                            boolean cancelled, List<Mentions.MentionItem> items) {
            this.generation = generation;
            this.workspaceRevision = workspaceRevision;
            this.cancelled = cancelled;
            this.items = items;
        }
    }

    public static final class Snapshot {
        public final int pathCount;
        public final int symbolCount;
        public final long workspaceRevision;
        public final long queryGeneration;
        public final long cancellationCount;
        public final long discardedQueryCount;
        public final long staleCommitCount;
        public final long leakCount;
        public final long deniedPathCount;
        public final long contentReadCount;

        private Snapshot(int pathCount, int symbolCount, long workspaceRevision,
                         long queryGeneration, long cancellationCount,
                         long discardedQueryCount, long staleCommitCount,
                         long leakCount, long deniedPathCount) {
            this.pathCount = pathCount;
            this.symbolCount = symbolCount;
            this.workspaceRevision = workspaceRevision;
            this.queryGeneration = queryGeneration;
            this.cancellationCount = cancellationCount;
            this.discardedQueryCount = discardedQueryCount;
            this.staleCommitCount = staleCommitCount;
            this.leakCount = leakCount;
            this.deniedPathCount = deniedPathCount;
            this.contentReadCount = 0L;
        }
    }

    private static final class Entry {
        final Mentions.MentionItem item;
        final String search;

        Entry(Mentions.MentionItem item, String search) {
            this.item = item;
            this.search = search;
        }
    }

    public static String canonicalPath(String value) {
        String path = value == null ? "" : value.replace('\\', '/');
        while (path.contains("//")) path = path.replace("//", "/");
        if (path.endsWith("/") && path.length() > 1) {
            path = path.substring(0, path.length() - 1);
        }
        return path;
    }

    private static String comparablePath(String value) {
        String path = canonicalPath(value);
        return path.matches("^[A-Za-z]:/.*") ? path.toLowerCase(Locale.ROOT) : path;
    }

    public static boolean isDeniedRelativePath(String value) {
        String path = canonicalPath(value);
        if (path.isEmpty() || path.startsWith("/") || path.matches("^[A-Za-z]:/.*")) {
            return true;
        }
        for (String segment : path.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")
                    || segment.indexOf('\0') >= 0
                    || DENIED_SEGMENTS.contains(segment.toLowerCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }

    public static String relativeToRoots(String absolutePath, Collection<String> roots) {
        String path = canonicalPath(absolutePath);
        String comparable = comparablePath(path);
        if (roots == null) return null;
        for (String rawRoot : roots) {
            String root = canonicalPath(rawRoot);
            String rootComparable = comparablePath(root);
            String prefix = rootComparable.equals("/") ? "/" : rootComparable + "/";
            if (comparable.startsWith(prefix)) {
                String relative = path.substring(root.equals("/") ? 1 : root.length() + 1);
                return isDeniedRelativePath(relative) ? null : relative;
            }
        }
        return null;
    }

    private String relative(String absolutePath) {
        if (!trusted) {
            deniedPathCount++;
            return null;
        }
        String relative = relativeToRoots(absolutePath, roots);
        if (relative == null) deniedPathCount++;
        return relative;
    }

    private void addFolders(String path) {
        int slash = path.lastIndexOf('/');
        while (slash > 0) {
            String folder = path.substring(0, slash + 1);
            folderRefs.put(folder, folderRefs.getOrDefault(folder, 0) + 1);
            slash = path.lastIndexOf('/', slash - 1);
        }
    }

    private void removeFolders(String path) {
        int slash = path.lastIndexOf('/');
        while (slash > 0) {
            String folder = path.substring(0, slash + 1);
            int count = folderRefs.getOrDefault(folder, 1) - 1;
            if (count <= 0) folderRefs.remove(folder);
            else folderRefs.put(folder, count);
            slash = path.lastIndexOf('/', slash - 1);
        }
    }

    public synchronized boolean upsertPath(String absolutePath) {
        String relative = relative(absolutePath);
        if (relative == null || files.containsKey(relative) || files.size() >= maxPaths) {
            return false;
        }
        files.put(relative, new Entry(Mentions.MentionItem.path(relative),
                relative.toLowerCase(Locale.ROOT)));
        addFolders(relative);
        workspaceRevision++;
        return true;
    }

    public synchronized boolean removePath(String absolutePath) {
        String relative = relativeToRoots(absolutePath, roots);
        if (relative == null || files.remove(relative) == null) return false;
        removeFolders(relative);
        workspaceRevision++;
        return true;
    }

    public synchronized long touchWorkspace() {
        return ++workspaceRevision;
    }

    public synchronized int replacePaths(Collection<String> absolutePaths) {
        files.clear();
        folderRefs.clear();
        if (trusted && absolutePaths != null) {
            for (String absolutePath : absolutePaths) {
                String relative = relativeToRoots(absolutePath, roots);
                if (relative == null) {
                    deniedPathCount++;
                    continue;
                }
                if (!files.containsKey(relative) && files.size() < maxPaths) {
                    files.put(relative, new Entry(Mentions.MentionItem.path(relative),
                            relative.toLowerCase(Locale.ROOT)));
                    addFolders(relative);
                }
            }
        }
        workspaceRevision++;
        return files.size();
    }

    public synchronized QueryTicket beginQuery() {
        if (activeTicket != null && !activeTicket.cancelled && !activeTicket.completed) {
            activeTicket.cancelled = true;
            cancellationCount++;
        }
        QueryTicket ticket = new QueryTicket(++queryGeneration, workspaceRevision);
        activeTicket = ticket;
        return ticket;
    }

    public synchronized boolean isCurrent(QueryTicket ticket) {
        return ticket != null && !ticket.cancelled && activeTicket == ticket
                && ticket.generation == queryGeneration;
    }

    public synchronized boolean refreshTicket(QueryTicket ticket) {
        if (!isCurrent(ticket)) return false;
        ticket.workspaceRevision = workspaceRevision;
        return true;
    }

    public synchronized int replaceSymbols(Collection<Mentions.Symbol> values) {
        replaceSymbolsInternal(values);
        workspaceRevision++;
        return symbols.size();
    }

    public synchronized boolean replaceSymbols(QueryTicket ticket,
                                                Collection<Mentions.Symbol> values) {
        if (!isCurrent(ticket) || ticket.workspaceRevision != workspaceRevision) {
            discardedQueryCount++;
            return false;
        }
        replaceSymbolsInternal(values);
        workspaceRevision++;
        ticket.workspaceRevision = workspaceRevision;
        return true;
    }

    private void replaceSymbolsInternal(Collection<Mentions.Symbol> values) {
        symbols.clear();
        if (trusted && values != null) {
            for (Mentions.Symbol symbol : values) {
                if (symbol == null || symbol.name == null || symbol.name.isBlank()) continue;
                String relative = relativeToRoots(symbol.fsPath, roots);
                if (relative == null) {
                    deniedPathCount++;
                    continue;
                }
                String key = symbol.name.toLowerCase(Locale.ROOT) + '\0' + relative;
                if (!symbols.containsKey(key) && symbols.size() < maxPaths) {
                    Mentions.MentionItem item = Mentions.MentionItem.symbol(
                            Mentions.symbolKindLabel(symbol.kind) + " " + symbol.name
                                    + " · " + relative,
                            relative);
                    symbols.put(key, new Entry(item,
                            (symbol.name + " " + relative).toLowerCase(Locale.ROOT)));
                }
            }
        }
    }

    public synchronized QueryResult query(QueryTicket ticket, String prefix) {
        if (!isCurrent(ticket)) {
            discardedQueryCount++;
            return new QueryResult(ticket == null ? 0 : ticket.generation,
                    workspaceRevision, true, List.of());
        }
        String query = (prefix == null ? "" : prefix)
                .toLowerCase(Locale.ROOT).replace('\\', '/');
        List<Entry> pseudoMentions = new ArrayList<>();
        for (String mention : IDE_MENTIONS) {
            pseudoMentions.add(new Entry(Mentions.MentionItem.path(mention), mention));
        }
        List<Iterable<Entry>> groups = new ArrayList<>();
        groups.add(pseudoMentions);
        if (trusted) {
            List<Entry> folders = new ArrayList<>();
            for (String folder : folderRefs.keySet()) {
                folders.add(new Entry(Mentions.MentionItem.path(folder),
                        folder.toLowerCase(Locale.ROOT)));
            }
            groups.add(folders);
            groups.add(files.values());
            groups.add(symbols.values());
        }
        List<Entry> ranked = rank(groups, query, MAX_CANDIDATES);
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<Mentions.MentionItem> items = new ArrayList<>();
        for (Entry entry : ranked) {
            String value = Mentions.mentionValue(entry.item);
            if (!isIdeMention(value) && isDeniedRelativePath(value)) {
                leakCount++;
                continue;
            }
            if (seen.add(value)) items.add(entry.item);
            if (items.size() >= MAX_CANDIDATES) break;
        }
        return new QueryResult(ticket.generation, ticket.workspaceRevision, false, items);
    }

    private static boolean isIdeMention(String value) {
        for (String mention : IDE_MENTIONS) if (mention.equals(value)) return true;
        return false;
    }

    private static List<Entry> rank(List<Iterable<Entry>> groups, String query, int limit) {
        if (query.isEmpty()) {
            List<Entry> head = new ArrayList<>();
            for (Iterable<Entry> group : groups) {
                for (Entry entry : group) {
                    head.add(entry);
                    if (head.size() >= limit) return head;
                }
            }
            return head;
        }
        List<Entry> base = new ArrayList<>();
        List<Entry> path = new ArrayList<>();
        List<Entry> sub = new ArrayList<>();
        outer:
        for (Iterable<Entry> group : groups) {
            for (Entry entry : group) {
                String lower = entry.search;
                String stripped = lower.endsWith("/")
                        ? lower.substring(0, lower.length() - 1) : lower;
                String basename = stripped.substring(stripped.lastIndexOf('/') + 1);
                if (basename.startsWith(query)) {
                    if (base.size() < limit) base.add(entry);
                } else if (lower.startsWith(query)) {
                    if (path.size() < limit) path.add(entry);
                } else if (lower.contains(query) && sub.size() < limit) {
                    sub.add(entry);
                }
                if (base.size() >= limit) break outer;
            }
        }
        List<Entry> out = new ArrayList<>();
        out.addAll(base);
        out.addAll(path);
        out.addAll(sub);
        return new ArrayList<>(out.subList(0, Math.min(limit, out.size())));
    }

    public synchronized boolean commit(QueryTicket ticket, QueryResult result) {
        if (!isCurrent(ticket) || ticket.workspaceRevision != workspaceRevision
                || result == null || result.generation != ticket.generation) {
            discardedQueryCount++;
            return false;
        }
        ticket.completed = true;
        return true;
    }

    public synchronized Snapshot snapshot() {
        return new Snapshot(files.size(), symbols.size(), workspaceRevision,
                queryGeneration, cancellationCount, discardedQueryCount,
                staleCommitCount, leakCount, deniedPathCount);
    }
}
