package com.chainlesschain.ide;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** One submission's cancellation boundary. No lock or pipe I/O on the EDT. */
public final class InputDispatch {
    private static final int PREPARING = 0, CANCELLED = 1, DISPATCHED = 2;
    private final AtomicInteger state = new AtomicInteger(PREPARING);
    private final CompletableFuture<Void> cancelled = new CompletableFuture<>();

    public boolean cancel() {
        if (!state.compareAndSet(PREPARING, CANCELLED)) return false;
        cancelled.completeExceptionally(new IOException("Input stopped before delivery; draft kept for editing"));
        return true;
    }

    public void check() throws IOException {
        if (state.get() == CANCELLED)
            throw new IOException("Input stopped before delivery; draft kept for editing");
    }

    /** Only AgentChatSession calls this, inside its serialized stdin boundary. */
    boolean reserve() { return state.compareAndSet(PREPARING, DISPATCHED); }

    /** True even after a partial pipe write: acceptance must remain unknown. */
    public boolean dispatched() { return state.get() == DISPATCHED; }

    /** Cancel a capability wait without cancelling the session's shared init. */
    public <T> T awaitReady(CompletableFuture<T> ready, long timeout, TimeUnit unit) throws Exception {
        check();
        CompletableFuture.anyOf(ready, cancelled).get(timeout, unit);
        check();
        return ready.get();
    }
}
