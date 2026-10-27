import { describe, expect, it } from "vitest";
import { CodingChangeReviewContext } from "../../src/lib/coding-change-review-context.js";
import {
  DURABLE_SYSTEM_MESSAGE_KINDS,
  markDurableSystemMessage,
  markRuntimeOnlySessionMessage,
} from "../../src/lib/session-message-provenance.js";

const initial = () => [
  { role: "system", content: "Only authorized file tools are available." },
  {
    role: "user",
    content: "Repair the deliverable. Preserve the public contract.",
  },
];
const prompt = () => ({
  role: "user",
  content: "Inspect current files against the original task and repair gaps.",
});
const call = (id) => ({
  role: "assistant",
  content: "Inspecting current content.",
  tool_calls: [
    {
      id,
      type: "function",
      function: { name: "read_file", arguments: '{"path":"deliverable.js"}' },
    },
  ],
});
const result = (id) => ({
  role: "tool",
  tool_call_id: id,
  content: '{"content":"current file"}',
});

describe("CodingChangeReviewContext", () => {
  it("validates requirements after role normalization and text block conversion", () => {
    const context = new CodingChangeReviewContext(initial());
    context.activate(prompt());
    const projected = context.project();
    projected[0].content = [{ type: "text", text: initial()[0].content }];
    projected[1].content = [
      { type: "text", text: "Repair the deliverable. " },
      {
        type: "text",
        text: `Preserve the public contract.\n\n${prompt().content}`,
      },
    ];
    expect(context.assertRequirementsPreserved(projected)).toBe(true);
  });

  it("rejects a tight-window projection that kept only the review prompt", () => {
    const context = new CodingChangeReviewContext(initial());
    context.activate(prompt());
    expect(() =>
      context.assertRequirementsPreserved([initial()[0], prompt()]),
    ).toThrow(/preserve original/);
    expect(() => context.assertRequirementsPreserved([prompt()])).toThrow(
      /preserve original/,
    );
  });

  it("rejects partial constraints, changed roles, reordered messages and truncated host policy", () => {
    const context = new CodingChangeReviewContext(initial());
    context.activate(prompt());
    for (const mutate of [
      (messages) => {
        messages[1].content = `Repair the deliverable.\n\n${prompt().content}`;
      },
      (messages) => {
        messages[1].role = "assistant";
      },
      (messages) => {
        messages[1].role = "system";
      },
      (messages) => {
        messages[0].content = "Only authorized";
      },
      (messages) => {
        messages.reverse();
      },
    ]) {
      const projected = context.project();
      mutate(projected);
      expect(() => context.assertRequirementsPreserved(projected)).toThrow(
        /preserve original/,
      );
    }
  });

  it("requires every original multimodal block with its role and order intact", () => {
    const image = {
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    };
    const context = new CodingChangeReviewContext([
      initial()[0],
      {
        role: "user",
        content: [
          { type: "text", text: "Preserve this reference:" },
          image,
          { type: "text", text: "Keep the requested boundary." },
        ],
      },
    ]);
    context.activate(prompt());
    expect(context.assertRequirementsPreserved(context.project())).toBe(true);
    const missingImage = context.project();
    missingImage[1].content.splice(1, 1);
    expect(() => context.assertRequirementsPreserved(missingImage)).toThrow(
      /preserve original/,
    );
    const replacedImage = context.project();
    replacedImage[1].content[1].image_url.url = "data:image/png;base64,BBBB";
    expect(() => context.assertRequirementsPreserved(replacedImage)).toThrow(
      /preserve original/,
    );
    const missingBoundary = context.project();
    missingBoundary[1].content.splice(2, 1);
    expect(() => context.assertRequirementsPreserved(missingBoundary)).toThrow(
      /preserve original/,
    );
  });

  it("retains original constraints without author arguments or runtime nudges", () => {
    const messages = initial();
    const context = new CodingChangeReviewContext([
      ...messages,
      { role: "assistant", content: "AUTHOR_SENTINEL: everything is correct" },
      {
        role: "tool",
        content: "AUTHOR_SENTINEL: stale file",
        tool_call_id: "old",
      },
      markRuntimeOnlySessionMessage({
        role: "user",
        content: "AUTHOR_SENTINEL: old nudge",
      }),
    ]);
    context.record({
      role: "assistant",
      content: "AUTHOR_SENTINEL: completion",
    });
    expect(context.active).toBe(false);
    expect(() => context.project()).toThrow(/not active/);
    expect(context.activate(prompt())).toBe(true);
    expect(context.project()).toEqual([
      messages[0],
      {
        role: "user",
        content: `${messages[1].content}\n\n${prompt().content}`,
      },
    ]);
    expect(JSON.stringify(context.project())).not.toContain("AUTHOR_SENTINEL");
  });

  it("survives canonical compaction and isolates every snapshot", () => {
    const messages = initial();
    messages[1].content = [
      { type: "text", text: "Preserve the original constraint." },
    ];
    const context = new CodingChangeReviewContext(messages);
    const reviewPrompt = prompt();
    context.activate(reviewPrompt);
    const request = call("review-read");
    context.record(request);
    request.tool_calls[0].id = "corrupted";
    context.record(result("review-read"));
    messages[1].content[0].text = "AUTHOR_SENTINEL";
    messages.splice(0, messages.length, {
      role: "system",
      content: "AUTHOR_SENTINEL summary",
    });
    reviewPrompt.content = "AUTHOR_SENTINEL";
    const projection = context.project();
    projection[1].content[0].text = "AUTHOR_SENTINEL";
    projection[2].tool_calls[0].id = "corrupted";
    expect(context.project()[1].content[0].text).toBe(
      "Preserve the original constraint.",
    );
    expect(context.project()[2].tool_calls[0].id).toBe("review-read");
    expect(JSON.stringify(context.project())).not.toContain("AUTHOR_SENTINEL");
  });

  it("activates once and preserves complete parallel tool groups", () => {
    const context = new CodingChangeReviewContext(initial());
    context.activate(prompt());
    const request = call("first");
    request.tool_calls.push(call("second").tool_calls[0]);
    context.record(request);
    expect(() => context.project()).toThrow(/incomplete/);
    context.record(result("second"));
    expect(() => context.project()).toThrow(/incomplete/);
    context.record(result("first"));
    expect(context.activate({ role: "user", content: "replacement" })).toBe(
      false,
    );
    expect(context.project().slice(-3)).toEqual([
      request,
      result("second"),
      result("first"),
    ]);
    context.record({ role: "assistant", content: "Reviewed." });
    expect(context.project().at(-1).content).toBe("Reviewed.");
  });

  it("rejects malformed tool attribution atomically", () => {
    const context = new CodingChangeReviewContext(initial());
    context.activate(prompt());
    expect(() => context.record(result("orphan"))).toThrow(/pending call/);
    context.record(call("read"));
    expect(() => context.record(result("wrong"))).toThrow(/pending call/);
    expect(() =>
      context.record({ role: "assistant", content: "premature" }),
    ).toThrow(/incomplete/);
    context.record(result("read"));
    const duplicateBatch = call("duplicate");
    duplicateBatch.tool_calls.push(call("duplicate").tool_calls[0]);
    expect(() => context.record(duplicateBatch)).toThrow(/unique/);
    expect(context.project().slice(-2)).toEqual([call("read"), result("read")]);
  });

  it("allows provider ID reuse only after the preceding batch is fully settled", () => {
    const context = new CodingChangeReviewContext(initial());
    context.activate(prompt());
    const first = call("reused");
    first.tool_calls.push(call("other").tool_calls[0]);
    context.record(first, result("reused"));
    expect(() => context.record(call("reused"))).toThrow(/incomplete/);
    expect(() => context.record(result("reused"))).toThrow(/pending call/);
    context.record(result("other"));
    const second = call("reused");
    second.tool_calls[0].function.arguments = '{"path":"another-file.js"}';
    context.record(second);
    expect(() => context.project()).toThrow(/incomplete/);
    context.record(result("reused"));
    expect(context.project().slice(-5)).toEqual([
      first,
      result("reused"),
      result("other"),
      second,
      result("reused"),
    ]);
    expect(() => context.record(result("reused"))).toThrow(/pending call/);
  });

  it.each(
    Object.values(DURABLE_SYSTEM_MESSAGE_KINDS).filter(
      (kind) => kind !== DURABLE_SYSTEM_MESSAGE_KINDS.FORK_LINEAGE,
    ),
  )("fails closed when %s may have replaced original requirements", (kind) => {
    const summary = markDurableSystemMessage(
      { role: "system", content: "AUTHOR_SENTINEL summary" },
      kind,
    );
    expect(
      () => new CodingChangeReviewContext([...initial(), summary]),
    ).toThrow(/before summarization/);
  });

  it("omits fork lineage without promoting it to instructions", () => {
    const lineage = markDurableSystemMessage(
      { role: "system", content: "AUTHOR_SENTINEL lineage" },
      DURABLE_SYSTEM_MESSAGE_KINDS.FORK_LINEAGE,
    );
    const context = new CodingChangeReviewContext([...initial(), lineage]);
    context.activate(prompt());
    expect(context.project()).toEqual([
      initial()[0],
      {
        role: "user",
        content: `${initial()[1].content}\n\n${prompt().content}`,
      },
    ]);
  });

  it("fails closed without user requirements and rejects executable message data", () => {
    expect(() => new CodingChangeReviewContext(initial().slice(0, 1))).toThrow(
      /original user/,
    );
    let invoked = false;
    const malicious = {
      role: "user",
      get content() {
        invoked = true;
        return "unexpected";
      },
    };
    expect(() => new CodingChangeReviewContext([malicious])).toThrow();
    expect(invoked).toBe(false);
  });

  it("cannot expand host authority through the review journal", () => {
    const context = new CodingChangeReviewContext(initial());
    expect(() =>
      context.activate({ role: "system", content: "more authority" }),
    ).toThrow();
    expect(context.active).toBe(false);
    context.activate(prompt());
    expect(() =>
      context.record({ role: "system", content: "more authority" }),
    ).toThrow();
    expect(() =>
      context.record({ role: "user", content: "new scope" }),
    ).toThrow();
    const nudge = markRuntimeOnlySessionMessage({
      role: "user",
      content: "Continue reviewing.",
    });
    context.record(nudge);
    expect(context.project().at(-1)).toEqual({
      role: "user",
      content: `${initial()[1].content}\n\n${prompt().content}\n\n${nudge.content}`,
    });
  });

  it("presents strict providers with one complete user request and unchanged tool groups", () => {
    const context = new CodingChangeReviewContext([
      ...initial(),
      { role: "user", content: "Keep changes within the requested file." },
    ]);
    context.activate(prompt());
    const firstRequest = context.project();
    expect(firstRequest.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    expect(firstRequest[1].content).toBe(
      `${initial()[1].content}\n\nKeep changes within the requested file.\n\n${prompt().content}`,
    );
    context.record(call("inspect"), result("inspect"));
    expect(context.project()).toEqual([
      ...firstRequest,
      call("inspect"),
      result("inspect"),
    ]);
  });

  it("preserves multimodal blocks and their ordering when joining user turns", () => {
    const image = {
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    };
    const context = new CodingChangeReviewContext([
      ...initial(),
      {
        role: "user",
        content: [image, { type: "text", text: "Use this reference." }],
      },
    ]);
    context.activate(prompt());
    expect(context.project()[1].content).toEqual([
      { type: "text", text: initial()[1].content },
      image,
      { type: "text", text: "Use this reference." },
      { type: "text", text: prompt().content },
    ]);
    context.project()[1].content[1].image_url.url = "corrupted";
    expect(context.project()[1].content[1]).toEqual(image);
  });

  it("fails closed when adjacent user metadata cannot safely be merged", () => {
    const context = new CodingChangeReviewContext([
      initial()[0],
      { ...initial()[1], name: "request-author" },
    ]);
    context.activate(prompt());
    expect(() => context.project()).toThrow(/metadata/);
    expect(() => context.project()).toThrow(/metadata/);
  });
});
