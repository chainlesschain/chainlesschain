package com.chainlesschain.ide;

/** One in-flight Workbench operation; closing invalidates all delayed UI callbacks. */
public final class EvolutionWorkbenchSession implements AutoCloseable {
    private long revision;
    private boolean busy;
    private boolean closed;

    public synchronized long begin() {
        if (busy || closed) return 0;
        busy = true;
        return ++revision;
    }

    public synchronized boolean isCurrent(long operation) {
        return !closed && busy && operation != 0 && operation == revision;
    }

    public synchronized boolean finish(long operation) {
        if (!isCurrent(operation)) return false;
        busy = false;
        return true;
    }

    public synchronized boolean canBegin() {
        return !closed && !busy;
    }

    @Override
    public synchronized void close() {
        closed = true;
        busy = false;
    }
}
