package com.chainlesschain.ide;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Bounded zero-exit capture for creation file export and online pending-draft RPC. Never reads credentials or output files. */
public final class GoalTaskCreateExport {
    private GoalTaskCreateExport() { }
    public static String capture(List<String> args, File cwd) {
        return capture(AgentChatSession.resolveBinary(), args, cwd, 30000);
    }
    public static String capture(String binary, List<String> args, File cwd, long timeoutMs) {
        if (timeoutMs < 1 || timeoutMs > 30000) return "";
        List<String> command = AgentChatSession.buildCaptureCommand(binary, args, File.separatorChar == '\\');
        if (command.isEmpty()) return "";
        var deadline = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r,"cc-creation-export-deadline"); t.setDaemon(true); return t; });
        Process child = null; Thread errors = null;
        var failed = new AtomicBoolean();
        var output = new ByteArrayOutputStream();
        try {
            ProcessBuilder builder = new ProcessBuilder(command); if (cwd != null) builder.directory(cwd); CliLauncher.augmentPath(builder);
            child = builder.start(); child.getOutputStream().close();
            Process owned = child;
            Runnable stop = () -> { failed.set(true); AgentChatSession.destroyTreeForcibly(owned); };
            deadline.schedule(stop,timeoutMs,TimeUnit.MILLISECONDS);
            errors = new Thread(() -> {
                try (InputStream stream = owned.getErrorStream()) { read(stream,new ByteArrayOutputStream(),65536,stop); }
                catch (Exception error) { stop.run(); }
            },"cc-creation-export-stderr");
            errors.setDaemon(true); errors.start();
            try (InputStream stream = child.getInputStream()) { read(stream,output,16384,stop); }
            if (!child.waitFor(2,TimeUnit.SECONDS)) stop.run();
            errors.join(1000); if (errors.isAlive()) stop.run();
            if (failed.get() || child.isAlive() || child.exitValue() != 0) return "";
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString();
        } catch (Exception error) {
            if (error instanceof InterruptedException) Thread.currentThread().interrupt();
            return "";
        } finally {
            deadline.shutdownNow();
            if (child != null) {
                if (child.isAlive()) AgentChatSession.destroyTreeForcibly(child);
                try { child.waitFor(2,TimeUnit.SECONDS); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
        }
    }
    private static void read(InputStream stream,ByteArrayOutputStream output,int limit,Runnable stop) throws Exception {
        byte[] buffer=new byte[4096]; int count;
        while ((count=stream.read(buffer))!=-1) {
            if (output.size()+count>limit) { stop.run(); return; }
            output.write(buffer,0,count);
        }
    }
}
