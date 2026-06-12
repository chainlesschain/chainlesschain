package com.chainlesschain.ide;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Headless smoke for the chat session core: drives the REAL AgentChatSession
 * (real ProcessBuilder, real pipes, real NDJSON marshal) against a fake agent
 * written in Node that speaks the CLI's stream-json protocol. No IntelliJ SDK,
 * no cc install, no LLM needed.
 *
 * Repro (from packages/jetbrains-plugin):
 *   javac --release 8 -encoding UTF-8 -d /tmp/cc-chat-smoke \
 *     src/main/java/com/chainlesschain/ide/MiniJson.java \
 *     src/main/java/com/chainlesschain/ide/AgentChatSession.java \
 *     src/main/java/com/chainlesschain/ide/ChatEvents.java \
 *     src/test/java/com/chainlesschain/ide/ChatSmokeMain.java
 *   java -cp /tmp/cc-chat-smoke com.chainlesschain.ide.ChatSmokeMain
 */
public final class ChatSmokeMain {

    private static final String FAKE_AGENT_JS =
            "const rl=require('readline').createInterface({input:process.stdin});\n"
          + "const out=(o)=>process.stdout.write(JSON.stringify(o)+'\\n');\n"
          + "out({type:'system',subtype:'init',model:'fake-model',provider:'fake-prov',session_id:'s-1'});\n"
          + "process.stderr.write('fake-agent ready\\n');\n"
          + "rl.on('line',(l)=>{\n"
          + "  let e; try{e=JSON.parse(l);}catch{return;}\n"
          + "  if(e.type==='user'){\n"
          + "    out({type:'tool_use',tool:'read_file',args:{path:'/ws/a.js'}});\n"
          + "    out({type:'tool_result',tool:'read_file',is_error:false});\n"
          + "    out({type:'stream_event',event:{delta:{type:'text_delta',text:'echo:'+e.text}}});\n"
          + "    out({type:'result',subtype:'success',result:'echo:'+e.text,usage:{output_tokens:1}});\n"
          + "  }\n"
          + "});\n"
          + "rl.on('close',()=>process.exit(0));\n";

    public static void main(String[] args) throws Exception {
        int failures = 0;
        failures += checkCommandLineShape();
        failures += checkDuplexRoundTrip();
        if (failures > 0) {
            System.err.println("CHAT SMOKE: " + failures + " FAILURE(S)");
            System.exit(1);
        }
        System.out.println("CHAT SMOKE: ALL PASS");
    }

    /** Production argv shape (no spawn). */
    private static int checkCommandLineShape() {
        AgentChatSession.Options o = new AgentChatSession.Options();
        o.extraArgs = ChatEvents.buildSessionArgs("volcengine", "m1", "sess-9");
        List<String> argv = new AgentChatSession(o).buildCommandLine();
        String joined = String.join(" ", argv);
        return expect(joined.contains(
                        "agent --input-format stream-json --output-format stream-json"
                                + " --include-partial-messages --provider volcengine"
                                + " --model m1 --resume sess-9"),
                "argv shape: " + joined);
    }

    /** Real child: init → user turn → tool/delta/result → end() → exit 0. */
    private static int checkDuplexRoundTrip() throws Exception {
        File script = File.createTempFile("cc-fake-agent", ".js");
        script.deleteOnExit();
        Writer w = new OutputStreamWriter(
                new FileOutputStream(script), StandardCharsets.UTF_8);
        w.write(FAKE_AGENT_JS);
        w.close();

        final BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        final BlockingQueue<String> stderrLines = new LinkedBlockingQueue<>();
        final CountDownLatch exited = new CountDownLatch(1);
        final int[] exitCode = { -1 };

        AgentChatSession.Options o = new AgentChatSession.Options();
        o.baseCommandOverride = new ArrayList<>(
                Arrays.asList("node", script.getAbsolutePath()));
        o.onEvent = new AgentChatSession.EventListener() {
            @Override
            public void onEvent(Map<String, Object> event) {
                events.add(event);
            }
        };
        o.onStderr = new AgentChatSession.LineListener() {
            @Override
            public void onLine(String line) {
                stderrLines.add(line);
            }
        };
        o.onExit = new AgentChatSession.ExitListener() {
            @Override
            public void onExit(int code) {
                exitCode[0] = code;
                exited.countDown();
            }
        };

        AgentChatSession session = new AgentChatSession(o);
        session.start();
        int failures = 0;

        ChatEvents.TurnState state = new ChatEvents.TurnState();

        Map<String, Object> init = take(events);
        Map<String, Object> initUi = ChatEvents.mapAgentEvent(init, state);
        failures += expect(initUi != null && "init".equals(initUi.get("kind"))
                        && "fake-model".equals(initUi.get("model")),
                "init event mapped: " + MiniJson.stringify(initUi));
        failures += expect("fake-agent ready".equals(take(stderrLines)),
                "stderr line surfaced");

        failures += expect(session.send("hi"), "send() accepted while running");
        Map<String, Object> toolUi = ChatEvents.mapAgentEvent(take(events), state);
        failures += expect(toolUi != null && "tool".equals(toolUi.get("kind"))
                        && "/ws/a.js".equals(toolUi.get("summary")),
                "tool_use mapped with arg summary: " + MiniJson.stringify(toolUi));
        Map<String, Object> toolDoneUi = ChatEvents.mapAgentEvent(take(events), state);
        failures += expect(toolDoneUi != null && "tool_done".equals(toolDoneUi.get("kind")),
                "tool_result mapped");
        Map<String, Object> deltaUi = ChatEvents.mapAgentEvent(take(events), state);
        failures += expect(deltaUi != null && "delta".equals(deltaUi.get("kind"))
                        && "echo:hi".equals(deltaUi.get("text")),
                "text delta mapped: " + MiniJson.stringify(deltaUi));
        Map<String, Object> endUi = ChatEvents.mapAgentEvent(take(events), state);
        failures += expect(endUi != null && "turn_end".equals(endUi.get("kind"))
                        && endUi.get("text") == null,
                "turn_end dedups streamed text: " + MiniJson.stringify(endUi));

        // Second turn: state reset means a delta streams again cleanly.
        failures += expect(session.send("again"), "second send()");
        take(events); // tool_use
        take(events); // tool_result
        Map<String, Object> delta2 = ChatEvents.mapAgentEvent(take(events), state);
        failures += expect(delta2 != null && "echo:again".equals(delta2.get("text")),
                "second turn streams");
        take(events); // result

        session.end(); // graceful: close stdin → fake agent exits 0
        failures += expect(exited.await(10, TimeUnit.SECONDS), "child exited after end()");
        failures += expect(exitCode[0] == 0, "exit code 0, got " + exitCode[0]);
        failures += expect(!session.isRunning(), "session no longer running");
        failures += expect(!session.send("late"), "send() refused after exit");
        return failures;
    }

    private static <T> T take(BlockingQueue<T> q) throws InterruptedException {
        T v = q.poll(10, TimeUnit.SECONDS);
        if (v == null) throw new IllegalStateException("timed out waiting for event");
        return v;
    }

    private static int expect(boolean ok, String what) {
        System.out.println((ok ? "  PASS  " : "  FAIL  ") + what);
        return ok ? 0 : 1;
    }
}
