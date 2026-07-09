package com.chainlesschain.ide;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Paths;
import java.util.Map;
import java.util.Set;
import java.util.Timer;
import java.util.TimerTask;

/**
 * One-shot client for the background-session NDJSON transport
 * (packages/cli/src/lib/background-session-transport.js): connect to the
 * per-session local pipe, authenticate with the state-file token, deliver a
 * single control message (prompt / stop), wait for the worker's reply, and
 * detach. The dialog-form JetBrains panel uses short-lived connections per
 * action instead of a resident attachment (VS Code holds one open; same
 * protocol either way).
 *
 * I/O is strictly SEQUENTIAL write→read: on Windows a named pipe opened via
 * RandomAccessFile is a single synchronous handle — a concurrent read from a
 * second thread while the main thread writes fails with "pipe is being
 * closed" (live-verified). The protocol is request/response, so alternation
 * is sufficient; worker broadcasts (turn-started/…) that interleave are
 * skipped until the expected reply type arrives. A watchdog closes the
 * handle after {@code timeoutMs} to break a blocked read. POSIX uses a
 * UNIX-domain SocketChannel (JDK 16+). Pure Java (no IntelliJ SDK).
 */
public final class BackgroundSessionPipeClient {

    private BackgroundSessionPipeClient() {}

    /** Reply types that settle each request kind (broadcasts are skipped). */
    private static final Set<String> HELLO_REPLIES = Set.of("hello");
    private static final Set<String> ACTION_REPLIES =
            Set.of("accepted", "stopping", "status", "error");

    /**
     * Send one control message and return the worker's settling reply
     * (accepted / stopping / status / error). Throws on connect, auth
     * failure, or timeout.
     *
     * @param message e.g. {@code {"type":"prompt","text":"…"}} built with
     *                MiniJson.obj(); "hello"/"detach" are added here
     */
    public static Map<String, Object> sendOneShot(
            String pipePath, String token, Map<String, Object> message, long timeoutMs)
            throws IOException {
        Transport t = open(pipePath);
        Timer watchdog = new Timer("cc-bg-pipe-watchdog", true);
        watchdog.schedule(new TimerTask() {
            @Override public void run() {
                try {
                    t.close(); // breaks a blocked read → IOException below
                } catch (IOException ignored) {
                    /* already closed */
                }
            }
        }, Math.max(1, timeoutMs));
        try {
            LineReader reader = new LineReader(t);

            Map<String, Object> hello = MiniJson.obj();
            hello.put("type", "hello");
            hello.put("token", token);
            t.writeLine(MiniJson.stringify(hello));
            Map<String, Object> ack = readUntil(reader, HELLO_REPLIES);
            if (ack == null) throw new IOException("transport handshake failed (closed)");

            t.writeLine(MiniJson.stringify(message));
            Map<String, Object> reply = readUntil(reader, ACTION_REPLIES);
            if (reply == null) throw new IOException("no reply from worker (closed)");

            Map<String, Object> detach = MiniJson.obj();
            detach.put("type", "detach");
            t.writeLine(MiniJson.stringify(detach));
            return reply;
        } finally {
            watchdog.cancel();
            try {
                t.close();
            } catch (IOException ignored) {
                /* watchdog may have closed it already */
            }
        }
    }

    /** Read messages, skipping broadcasts, until a type in {@code want}. */
    private static Map<String, Object> readUntil(LineReader reader, Set<String> want)
            throws IOException {
        for (int i = 0; i < 64; i++) { // hard cap — a chatty worker never spins us forever
            String line = reader.readLine();
            if (line == null) return null;
            if (line.isEmpty()) continue;
            Object parsed;
            try {
                parsed = MiniJson.parse(line);
            } catch (Exception e) {
                continue; // tolerate a torn line
            }
            if (parsed instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> m = (Map<String, Object>) parsed;
                Object type = m.get("type");
                if (type instanceof String && want.contains(type)) return m;
            }
        }
        throw new IOException("no settling reply within 64 messages");
    }

    /** Blocking NDJSON line reader with a carry buffer over Transport.read. */
    private static final class LineReader {
        private final Transport t;
        private final StringBuilder carry = new StringBuilder();
        private final byte[] buf = new byte[4096];

        LineReader(Transport t) {
            this.t = t;
        }

        /** Next line (without \n), or null on EOF/closed handle. */
        String readLine() throws IOException {
            while (true) {
                int idx = carry.indexOf("\n");
                if (idx >= 0) {
                    String line = carry.substring(0, idx).replace("\r", "").trim();
                    carry.delete(0, idx + 1);
                    return line;
                }
                int n;
                try {
                    n = t.read(buf);
                } catch (IOException e) {
                    return null; // watchdog close or peer gone
                }
                if (n < 0) return null;
                carry.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
        }
    }

    // ── transport: named pipe (Windows) / unix socket (POSIX) ──────────────

    private interface Transport {
        void writeLine(String json) throws IOException;
        int read(byte[] buf) throws IOException;
        void close() throws IOException;
    }

    private static Transport open(String pipePath) throws IOException {
        boolean windowsPipe = pipePath != null && pipePath.startsWith("\\\\.\\pipe\\");
        if (windowsPipe) {
            RandomAccessFile raf = new RandomAccessFile(pipePath, "rw");
            return new Transport() {
                @Override public void writeLine(String json) throws IOException {
                    raf.write((json + "\n").getBytes(StandardCharsets.UTF_8));
                }
                @Override public int read(byte[] buf) throws IOException {
                    return raf.read(buf);
                }
                @Override public void close() throws IOException {
                    raf.close();
                }
            };
        }
        SocketChannel ch = SocketChannel.open(StandardProtocolFamily.UNIX);
        ch.connect(UnixDomainSocketAddress.of(Paths.get(pipePath)));
        return new Transport() {
            @Override public void writeLine(String json) throws IOException {
                ByteBuffer out = ByteBuffer.wrap((json + "\n").getBytes(StandardCharsets.UTF_8));
                while (out.hasRemaining()) ch.write(out);
            }
            @Override public int read(byte[] buf) throws IOException {
                ByteBuffer in = ByteBuffer.wrap(buf);
                return ch.read(in);
            }
            @Override public void close() throws IOException {
                ch.close();
            }
        };
    }
}
