"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  terminalOutcome,
  observeTerminalOutcome,
  readProtocol,
} = require("./extension-host/driver/verify01.cjs");
const output = (event) => ({ direction: "output", event });

test("budget failure persists actual terminal and rejects before invoking an unresolved UI wait", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "verify01-terminal-"),
  );
  const event = {
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    result: "Iteration budget: 20/20",
    session_id: "session",
    turn: 1,
  };
  const records = [
    output({ type: "iteration_budget_exhausted", budget: 20 }),
    output(event),
    output({ type: "system", subtype: "end" }),
  ];
  const bytes = Buffer.from(
    records.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  const file = path.join(directory, "raw.ndjson");
  fs.writeFileSync(file, bytes);
  let persisted,
    renderCalls = 0;
  try {
    await assert.rejects(
      observeTerminalOutcome(readProtocol(file), {
        persistTerminal: async (terminal) => {
          persisted = terminal;
        },
        render: () => {
          renderCalls++;
          return new Promise(() => {});
        },
      }),
      { code: "VERIFY01_MODEL_TERMINAL_FAILURE", message: /error_max_turns/ },
    );
    assert.deepEqual(persisted, event);
    assert.equal(renderCalls, 0);
    assert.deepEqual(fs.readFileSync(file), bytes);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("budget marker alone remains pending; system end makes missing result fail closed", async () => {
  const marker = output({ type: "iteration_budget_exhausted", budget: 20 });
  let touched = false;
  assert.equal(
    await observeTerminalOutcome([marker], {
      persistTerminal: () => {
        touched = true;
      },
      render: () => {
        touched = true;
      },
    }),
    null,
  );
  assert.equal(touched, false);
  await assert.rejects(
    observeTerminalOutcome(
      [marker, output({ type: "system", subtype: "end" })],
      {
        persistTerminal: () => {
          touched = true;
        },
        render: () => {
          touched = true;
        },
      },
    ),
    { code: "VERIFY01_MODEL_TERMINAL_FAILURE", message: /without a result/ },
  );
  assert.equal(touched, false);
});

test("success still awaits real UI rendering before entering the existing recovery path", async () => {
  const terminal = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
  };
  const records = [output(terminal)];
  const order = [];
  let resolveRender;
  const renderPending = new Promise((resolve) => {
    resolveRender = resolve;
  });
  let finished = false;
  const observed = observeTerminalOutcome(records, {
    persistTerminal: (event) => {
      assert.equal(event, terminal);
      order.push("persist");
    },
    render: (event) => {
      assert.equal(event, terminal);
      order.push("render");
      return renderPending;
    },
  }).then((value) => {
    finished = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["persist", "render"]);
  assert.equal(finished, false);
  assert.equal(terminalOutcome(records).status, "success");
  resolveRender({ savedRows: [{ text: "done" }] });
  assert.deepEqual(await observed, { savedRows: [{ text: "done" }] });
});

test("missing terminal remains pending, malformed and duplicate terminal results reject", () => {
  assert.equal(
    terminalOutcome([output({ type: "system", subtype: "init" })]).status,
    "pending",
  );
  assert.throws(
    () =>
      terminalOutcome([
        output({ type: "result", subtype: "success", is_error: true }),
        output({ type: "result", subtype: "success", is_error: false }),
      ]),
    /multiple terminal/,
  );
  assert.throws(
    () => terminalOutcome([output({ type: "result", subtype: "success" })]),
    /invalid success/,
  );
  assert.throws(
    () => terminalOutcome([{ direction: "exit" }]),
    /without a terminal/,
  );
});
