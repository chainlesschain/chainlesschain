package com.chainlesschain.ide;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/** Confirms termination of the root and every observed descendant; retains failed handles for retry. */
final class ProcessTreeTermination {
    interface Target {
        long id();
        boolean alive();
        List<Target> descendants();
        void terminate(boolean force);
    }
    private record Handle(ProcessHandle process) implements Target {
        public long id() { return process.pid(); }
        public boolean alive() { return process.isAlive(); }
        public List<Target> descendants() {
            try (Stream<ProcessHandle> children = process.descendants()) {
                return children.limit(1025).map(p -> (Target) new Handle(p)).toList();
            }
        }
        public void terminate(boolean force) {
            if (force) process.destroyForcibly(); else process.destroy();
        }
    }
    private final Target root;
    private final Map<Long, Target> known = new LinkedHashMap<>();
    private boolean observationUncertain;

    ProcessTreeTermination(Process process) { this(new Handle(process.toHandle())); }
    ProcessTreeTermination(Target root) { this.root = root; known.put(root.id(), root); }

    /** Blocking worker operation. Never call on the EDT or under the stdin writer monitor. */
    synchronized void await(long graceMs, long timeoutMs) throws IOException, InterruptedException {
        if (observationUncertain) throw new IOException("The previous process tree could not be observed completely");
        long began = System.nanoTime();
        long deadline = began + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        while (true) {
            try {
                for (Target parent : new ArrayList<>(known.values())) {
                    if (!parent.alive()) continue;
                    for (Target child : parent.descendants()) {
                        if (known.size() >= 1024 && !known.containsKey(child.id()))
                            throw new IllegalStateException("Process tree exceeds the observation limit");
                        known.putIfAbsent(child.id(), child);
                    }
                }
                if (known.values().stream().noneMatch(Target::alive)) return;
                boolean force = System.nanoTime() - began >= TimeUnit.MILLISECONDS.toNanos(graceMs);
                // Signal descendants before the wrapper, preserving their handles after reparenting.
                for (Target target : new ArrayList<>(known.values()))
                    if (target.id() != root.id() && target.alive()) target.terminate(force);
                if (root.alive()) root.terminate(force);
            } catch (RuntimeException error) {
                observationUncertain = true;
                for (Target target : known.values()) {
                    try { target.terminate(true); } catch (RuntimeException ignored) { /* report uncertainty */ }
                }
                throw new IOException("Could not confirm the agent process tree exit", error);
            }
            if (known.values().stream().noneMatch(Target::alive)) return;
            if (System.nanoTime() >= deadline)
                throw new IOException("The previous agent process tree has not exited");
            Thread.sleep(25);
        }
    }
}
