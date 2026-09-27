import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const script = fileURLToPath(
  new URL(
    "../../../../tests/fixtures/ide-roadmap/fake-stream-json-agent.mjs",
    import.meta.url,
  ),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("ordinary host peer persists receipts and deduplicates across process restart", () => {
  const root = mkdtempSync(join(tmpdir(), "cc-host-receipts-"));
  roots.push(root);
  const env = {
    ...process.env,
    CC_UI_FIXTURE_STATE: join(root, "state.json"),
    CC_UI_FIXTURE_TRACE: "",
    CC_UI_CANONICAL_ROOT: "",
    CC_UI_INIT_GATE_DIR: "",
  };
  const run = (args, input = "") =>
    spawnSync(process.execPath, [script, ...args], {
      env,
      input,
      encoding: "utf8",
      timeout: 10000,
    });
  const parse = (result) => {
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  };
  const inputs = Array.from({ length: 10 }, (_, index) => ({
    type: "user",
    text: `journey:model:${index}`,
    client_message_id: `input-${index}`,
  }));
  const first = parse(
    run(
      ["agent", "--resume", "receipt-session"],
      inputs.map(JSON.stringify).join("\n") + "\n",
    ),
  );
  expect(first[0].input_receipts).toEqual({ version: 1 });
  const receipts = first.filter((event) => event.subtype === "input_accepted");
  expect(receipts).toHaveLength(10);
  for (const event of receipts) {
    expect(event.receipt.sessionId).toBe("receipt-session");
    expect(event.receipt.clientMessageId).toBe(event.client_message_id);
    expect(event.receipt.eventHash).toMatch(/^[a-f0-9]{64}$/u);
  }
  const restarted = parse(
    run(
      ["agent", "--resume", "receipt-session"],
      JSON.stringify(inputs[0]) + "\n",
    ),
  );
  expect(
    restarted.find((event) => event.subtype === "input_accepted").receipt,
  ).toEqual({ ...receipts[0].receipt, duplicate: true });
  expect(restarted.filter((event) => event.type === "result")).toEqual([
    expect.objectContaining({ subtype: "input_already_accepted" }),
  ]);
  expect(restarted.some((event) => event.type === "stream_event")).toBe(false);
  const query = (session) =>
    parse(
      run([
        "session",
        "show",
        "--json",
        "--input-receipt",
        "input-0",
        "--",
        session,
      ]),
    )[0];
  expect(query("receipt-session")).toMatchObject({
    accepted: true,
    receipt: { clientMessageId: "input-0" },
  });
  expect(query("another-session")).toMatchObject({
    accepted: false,
    receipt: null,
  });
  expect(
    parse(
      run([
        "session",
        "show",
        "receipt-session",
        "--json",
        "--input-receipt",
        "input-0",
      ]),
    )[0],
  ).toEqual(query("receipt-session"));
  const conflict = run(
    ["agent", "--resume", "receipt-session"],
    JSON.stringify({ ...inputs[0], text: "changed" }) + "\n",
  );
  expect(conflict.status).not.toBe(0);
  expect(conflict.stderr).toContain("reused with different content");
});
