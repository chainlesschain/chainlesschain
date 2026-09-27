package com.chainlesschain.ide;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.Writer;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import javax.swing.SwingUtilities;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class InputDispatchTest {
    @Test void cancellationInsideTheSessionMonitorStillWinsBeforeReservation() throws Exception {
        BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        CountDownLatch guarded = new CountDownLatch(1), release = new CountDownLatch(1);
        AgentChatSession.Options options = new AgentChatSession.Options();
        options.baseCommandOverride = List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"), AgentChatSessionTest.QueuedAgent.class.getName());
        options.onEvent = events::add;
        AgentChatSession agent = new AgentChatSession(options);
        InputDispatch dispatch = new InputDispatch();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            agent.start();
            options.canDispatch = () -> {
                guarded.countDown();
                try { return release.await(10, TimeUnit.SECONDS); }
                catch (InterruptedException error) { return false; }
            };
            Future<Boolean> send = pool.submit(() -> agent.sendEvent(AgentChatSession.userEvent("cancel in guard", null), dispatch));
            assertTrue(guarded.await(5, TimeUnit.SECONDS));
            CompletableFuture<Boolean> cancellation = new CompletableFuture<>();
            SwingUtilities.invokeLater(() -> cancellation.complete(dispatch.cancel()));
            assertTrue(cancellation.get(2, TimeUnit.SECONDS));
            release.countDown();
            assertFalse(send.get(5, TimeUnit.SECONDS));
            assertFalse(dispatch.dispatched());
            assertFalse(agent.hasPendingTurns());
            assertTrue(agent.interrupt());
            assertEquals("interrupted", events.poll(5, TimeUnit.SECONDS).get("subtype"));
        } finally {
            release.countDown();
            agent.stopAndWait().get(10, TimeUnit.SECONDS);
            pool.shutdownNow();
        }
    }
    private AgentChatSession session(BlockingQueue<Map<String, Object>> events) {
        AgentChatSession.Options options = new AgentChatSession.Options();
        options.baseCommandOverride = List.of(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"), AgentChatSessionTest.QueuedAgent.class.getName());
        options.onEvent = events::add;
        return new AgentChatSession(options);
    }

    @Test void cancellationReleasesInitWaitWithoutPoisoningTheSessionCapability() throws Exception {
        InputDispatch dispatch = new InputDispatch();
        CompletableFuture<Boolean> init = new CompletableFuture<>();
        try (ExecutorService pool = Executors.newSingleThreadExecutor()) {
            Future<Boolean> waiting = pool.submit(() -> dispatch.awaitReady(init, 10, TimeUnit.SECONDS));
            SwingUtilities.invokeAndWait(() -> assertTrue(dispatch.cancel()));
            assertThrows(ExecutionException.class, () -> waiting.get(2, TimeUnit.SECONDS));
            assertFalse(init.isDone(), "Stop affects the submission, not the shared session init");
            init.complete(true);
            assertTrue(new InputDispatch().awaitReady(init, 1, TimeUnit.SECONDS));
            assertThrows(IOException.class, () -> dispatch.awaitReady(init, 1, TimeUnit.SECONDS));
        }
    }

    @Test void stopBeforeSessionExistsDoesNotCreateAPendingTurn() {
        InputDispatch dispatch = new InputDispatch();
        assertTrue(dispatch.cancel());
        assertFalse(dispatch.cancel());
        AgentChatSession agent = session(new LinkedBlockingQueue<>());
        assertFalse(agent.sendEvent(AgentChatSession.userEvent("not sent", null), dispatch));
        assertFalse(dispatch.dispatched());
        assertFalse(agent.hasPendingTurns());
    }

    @Test void stopWhileWaitingForThePipeMonitorPreventsALaterUserWrite() throws Exception {
        BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        AgentChatSession agent = session(events);
        InputDispatch dispatch = new InputDispatch();
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            agent.start();
            Future<Boolean> send;
            Future<Boolean> stop;
            synchronized (agent) {
                CountDownLatch queued = new CountDownLatch(1);
                send = pool.submit(() -> {
                    queued.countDown();
                    return agent.sendEvent(AgentChatSession.userEvent("cancelled before pipe", null), dispatch);
                });
                assertTrue(queued.await(2, TimeUnit.SECONDS));
                SwingUtilities.invokeAndWait(() -> assertTrue(dispatch.cancel()));
                stop = pool.submit(agent::interrupt);
            }
            assertFalse(send.get(5, TimeUnit.SECONDS));
            assertTrue(stop.get(5, TimeUnit.SECONDS));
            assertEquals("interrupted", events.poll(5, TimeUnit.SECONDS).get("subtype"));
            assertFalse(dispatch.dispatched());
            assertFalse(agent.hasPendingTurns());
            // A subsequent valid send is a FIFO barrier: no cancelled user event
            // can be concealed behind the earlier interruption notification.
            assertTrue(agent.send("next explicit input"));
            assertEquals("queued", events.poll(5, TimeUnit.SECONDS).get("subtype"));
            assertNull(events.poll(100, TimeUnit.MILLISECONDS));
        } finally { agent.stopAndWait().get(10, TimeUnit.SECONDS); }
    }

    @Test void stopAfterReservationStaysResponsiveAndFollowsTheBlockedUserWrite() throws Exception {
        BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        AgentChatSession agent = session(events);
        InputDispatch dispatch = new InputDispatch();
        CountDownLatch writing = new CountDownLatch(1), release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            agent.start();
            var field = AgentChatSession.class.getDeclaredField("stdin");
            field.setAccessible(true);
            BufferedWriter original = (BufferedWriter) field.get(agent);
            field.set(agent, new BufferedWriter(new Writer() {
                @Override public void write(char[] chars, int offset, int length) throws IOException {
                    writing.countDown();
                    try {
                        if (!release.await(10, TimeUnit.SECONDS)) throw new IOException("test write timed out");
                    } catch (InterruptedException error) { throw new IOException(error); }
                    original.write(chars, offset, length);
                }
                @Override public void flush() throws IOException { original.flush(); }
                @Override public void close() throws IOException { original.close(); }
            }));
            Future<Boolean> send = pool.submit(() -> agent.sendEvent(AgentChatSession.userEvent("reserved", null), dispatch));
            assertTrue(writing.await(5, TimeUnit.SECONDS));
            CompletableFuture<Boolean> cancellation = new CompletableFuture<>();
            SwingUtilities.invokeLater(() -> cancellation.complete(dispatch.cancel()));
            assertFalse(cancellation.get(2, TimeUnit.SECONDS), "EDT must not wait for a pipe write");
            assertTrue(dispatch.dispatched());
            Future<Boolean> stop = pool.submit(agent::interrupt);
            assertFalse(stop.isDone());
            release.countDown();
            assertTrue(send.get(5, TimeUnit.SECONDS));
            assertTrue(stop.get(5, TimeUnit.SECONDS));
            assertEquals("queued", events.poll(5, TimeUnit.SECONDS).get("subtype"));
            assertEquals("interrupted", events.poll(5, TimeUnit.SECONDS).get("subtype"));
            assertFalse(agent.hasPendingTurns());
        } finally {
            release.countDown();
            agent.stopAndWait().get(10, TimeUnit.SECONDS);
            pool.shutdownNow();
        }
    }

    @Test void aReservedSubmissionCannotBeSentTwice() throws Exception {
        BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        AgentChatSession agent = session(events);
        InputDispatch dispatch = new InputDispatch();
        try {
            agent.start();
            Map<String, Object> user = AgentChatSession.userEvent("one attempt", null);
            assertTrue(agent.sendEvent(user, dispatch));
            assertFalse(agent.sendEvent(user, dispatch));
            assertEquals("queued", events.poll(5, TimeUnit.SECONDS).get("subtype"));
            assertTrue(agent.interrupt());
            assertEquals("interrupted", events.poll(5, TimeUnit.SECONDS).get("subtype"));
            assertFalse(agent.hasPendingTurns());
        } finally { agent.stopAndWait().get(10, TimeUnit.SECONDS); }
    }

    @Test void aFailedPipeWriteRemainsDispatchedAndCannotBeRelabelledCancelled() throws Exception {
        AgentChatSession agent = session(new LinkedBlockingQueue<>());
        InputDispatch dispatch = new InputDispatch();
        try {
            agent.start();
            var field = AgentChatSession.class.getDeclaredField("stdin");
            field.setAccessible(true);
            BufferedWriter original = (BufferedWriter) field.get(agent);
            field.set(agent, new BufferedWriter(new Writer() {
                @Override public void write(char[] chars, int offset, int length) throws IOException {
                    throw new IOException("simulated partial pipe write");
                }
                @Override public void flush() {}
                @Override public void close() throws IOException { original.close(); }
            }));
            assertFalse(agent.sendEvent(AgentChatSession.userEvent("unknown delivery", null), dispatch));
            assertTrue(dispatch.dispatched());
            assertFalse(dispatch.cancel());
            assertTrue(agent.hasPendingTurns(), "partial writes keep conservative accounting");
        } finally { agent.stopAndWait().get(10, TimeUnit.SECONDS); }
    }
}
