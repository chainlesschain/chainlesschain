package com.chainlesschain.ide;

import java.util.concurrent.*;

/** Draft I/O must remain independent of a blocked agent stdin or IDE event thread. */
public final class ChatDraftTasks {
    private ChatDraftTasks() {}
    private static final ThreadPoolExecutor WORKER = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(64), task -> {
                Thread thread = new Thread(task, "cc-chat-drafts"); thread.setDaemon(true); return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    public static <T> CompletableFuture<T> submit(Callable<T> action) {
        CompletableFuture<T> result = new CompletableFuture<>();
        try {
            WORKER.execute(() -> {
                try { result.complete(action.call()); }
                catch (Exception error) { result.completeExceptionally(error); }
            });
        } catch (RejectedExecutionException error) { result.completeExceptionally(error); }
        return result;
    }
}
