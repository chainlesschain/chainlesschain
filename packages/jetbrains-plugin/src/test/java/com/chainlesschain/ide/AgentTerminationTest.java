package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class AgentTerminationTest {
    public static final class SleepingPeer {
        public static void main(String[] args) throws Exception {
            long child = 0;
            if (args.length == 0) {
                Process descendant = new ProcessBuilder(command("leaf")).start();
                child = descendant.pid();
            }
            System.out.println("{\"type\":\"system\",\"pid\":" + ProcessHandle.current().pid() + ",\"child_pid\":" + child + "}");
            System.out.flush();
            Thread.sleep(60000); // deliberately never read stdin
        }
    }
    private static List<String> command(String... args) {
        java.util.ArrayList<String> command = new java.util.ArrayList<>(List.of(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"), SleepingPeer.class.getName()));
        command.addAll(List.of(args));
        return command;
    }

    @Test void aBlockedStdinWriterCannotPreventConfirmedRootAndDescendantTermination() throws Exception {
        BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        AgentChatSession.Options options = new AgentChatSession.Options();
        options.baseCommandOverride = command();
        options.onEvent = events::add;
        options.stopGraceMs = 100;
        AgentChatSession session = new AgentChatSession(options);
        ExecutorService sender = Executors.newSingleThreadExecutor();
        ProcessHandle root = null, child = null;
        try {
            session.start();
            Map<String, Object> ready = events.poll(10, TimeUnit.SECONDS);
            assertNotNull(ready);
            root = ProcessHandle.of(((Number) ready.get("pid")).longValue()).orElseThrow();
            child = ProcessHandle.of(((Number) ready.get("child_pid")).longValue()).orElseThrow();
            assertTrue(root.isAlive()); assertTrue(child.isAlive());
            Future<Boolean> blocked = sender.submit(() -> session.send("x".repeat(8 * 1024 * 1024)));
            assertThrows(TimeoutException.class, () -> blocked.get(300, TimeUnit.MILLISECONDS));
            CompletableFuture<Void> stopped = session.stopAndWait();
            assertSame(stopped, session.stopAndWait(), "Concurrent stop callers share one barrier");
            stopped.get(10, TimeUnit.SECONDS);
            assertFalse(root.isAlive()); assertFalse(child.isAlive());
            assertFalse(blocked.get(5, TimeUnit.SECONDS));
            assertFalse(session.send("late"));
            assertThrows(java.io.IOException.class, session::start);
        } finally {
            session.stopAndWait().get(10, TimeUnit.SECONDS);
            sender.shutdownNow();
            if (child != null && child.isAlive()) child.destroyForcibly();
            if (root != null && root.isAlive()) root.destroyForcibly();
        }
    }

    @Test void aChangedHostGenerationRejectsDispatchAndStoppingBeforeStartPreventsSpawn() throws Exception {
        AgentChatSession.Options options = new AgentChatSession.Options();
        options.baseCommandOverride = command("leaf");
        AtomicBoolean current = new AtomicBoolean(true);
        options.canDispatch = current::get;
        AgentChatSession session = new AgentChatSession(options);
        try {
            session.start();
            current.set(false);
            assertFalse(session.send("obsolete approval mode"));
            assertFalse(session.sendEvent(Map.of("type", "approval", "approved", true)));
        } finally { session.stopAndWait().get(10, TimeUnit.SECONDS); }
        AgentChatSession canceled = new AgentChatSession(options);
        canceled.stopAndWait().get(5, TimeUnit.SECONDS);
        current.set(true);
        assertThrows(java.io.IOException.class, canceled::start);
        assertFalse(canceled.isRunning());
    }

    @Test void stoppingDuringLaunchPreparationPreventsTheDelayedSpawn() throws Exception {
        verifyCanceledPreparation(true);
    }

    @Test void aModeChangeDuringLaunchPreparationPreventsTheDelayedSpawn() throws Exception {
        verifyCanceledPreparation(false);
    }

    private void verifyCanceledPreparation(boolean stop) throws Exception {
        CountDownLatch preparing = new CountDownLatch(1);
        CountDownLatch resume = new CountDownLatch(1);
        AtomicBoolean current = new AtomicBoolean(true);
        AgentChatSession.Options options = new AgentChatSession.Options();
        options.baseCommandOverride = command("leaf");
        options.canDispatch = current::get;
        // Hold real launch preparation between entry validation and ProcessBuilder.start().
        options.extraEnv = new java.util.AbstractMap<>() {
            @Override public java.util.Set<Map.Entry<String, String>> entrySet() {
                preparing.countDown();
                try {
                    if (!resume.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Preparation timed out");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(error);
                }
                return java.util.Set.of();
            }
        };
        AgentChatSession session = new AgentChatSession(options);
        ExecutorService launcher = Executors.newSingleThreadExecutor();
        try {
            Future<?> started = launcher.submit(() -> {
                assertThrows(java.io.IOException.class, session::start);
            });
            assertTrue(preparing.await(5, TimeUnit.SECONDS));
            if (stop) session.stopAndWait(); else current.set(false);
            resume.countDown();
            started.get(5, TimeUnit.SECONDS);
            assertFalse(session.isRunning());
        } finally {
            resume.countDown();
            session.stopAndWait().get(10, TimeUnit.SECONDS);
            launcher.shutdownNow();
        }
    }
}
