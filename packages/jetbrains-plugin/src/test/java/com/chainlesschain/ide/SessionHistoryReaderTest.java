package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class SessionHistoryReaderTest {
    public static class Peer {
        public static void main(String[] args) throws Exception {
            if (args.length > 1) Files.writeString(Path.of(args[1]), Long.toString(ProcessHandle.current().pid()));
            switch (args[0]) {
                case "ok" -> { System.err.write(new byte[3 * 1024 * 1024]); System.out.write("{\"text\":\"中文😀\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
                case "huge" -> { System.out.write(new byte[3 * 1024 * 1024]); System.out.flush(); Thread.sleep(30_000); }
                case "bad" -> { System.err.print("history generation changed"); System.exit(7); }
                case "utf8" -> System.out.write(new byte[]{(byte) 0xc3});
                default -> Thread.sleep(30_000);
            }
        }
    }
    private static List<String> command(String mode, Path pid) {
        List<String> args = new ArrayList<>(List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-Dfile.encoding=UTF-8", "-cp", System.getProperty("java.class.path"), Peer.class.getName(), mode));
        if (pid != null) args.add(pid.toString()); return args;
    }
    @Test void drainsChattyStderrAndPreservesCompleteUnicodeStdout() throws Exception {
        assertEquals("{\"text\":\"中文😀\"}", SessionHistoryReader.capture(command("ok", null), null, 10_000, () -> false));
    }
    @Test void rejectsNonzeroExitAndMalformedUtf8() {
        IOException error = assertThrows(IOException.class, () -> SessionHistoryReader.capture(command("bad", null), null, 10_000, () -> false));
        assertTrue(error.getMessage().contains("history generation changed"));
        assertThrows(IOException.class, () -> SessionHistoryReader.capture(command("utf8", null), null, 10_000, () -> false));
    }
    @Test void killsOversizedAndTimedOutQueriesInsteadOfReturningPartialHistory() throws Exception {
        for (String mode : List.of("huge", "hang")) {
            Path pid = Files.createTempFile("cc-history-child", ".pid");
            try {
                IOException error = assertThrows(IOException.class, () -> SessionHistoryReader.capture(command(mode, pid), null,
                        "hang".equals(mode) ? 1500 : 10_000, () -> false));
                assertTrue(error.getMessage().contains("2 MiB") || error.getMessage().contains("timed out"));
                long id = Long.parseLong(Files.readString(pid));
                assertTrue(ProcessHandle.of(id).isEmpty() || !ProcessHandle.of(id).orElseThrow().isAlive());
            } finally { Files.deleteIfExists(pid); }
        }
    }
    @Test void cancelsAfterSpawnAndRefusesAnAlreadyCancelledSpawn() throws Exception {
        Path pid = Files.createTempFile("cc-history-cancel", ".pid");
        AtomicBoolean cancel = new AtomicBoolean();
        Thread observer = new Thread(() -> {
            try {
                for (int i = 0; i < 500 && Files.size(pid) == 0; i++) Thread.sleep(10);
                cancel.set(true);
            } catch (Exception ignored) { cancel.set(true); }
        });
        observer.start();
        try {
            assertThrows(IOException.class, () -> SessionHistoryReader.capture(command("hang", pid), null, 10_000, cancel::get));
            long id = Long.parseLong(Files.readString(pid));
            assertTrue(ProcessHandle.of(id).isEmpty() || !ProcessHandle.of(id).orElseThrow().isAlive());
            assertThrows(IOException.class, () -> SessionHistoryReader.capture(List.of("nonexistent-command"), null, 10_000, () -> true));
        } finally { observer.join(6000); Files.deleteIfExists(pid); }
    }
}
