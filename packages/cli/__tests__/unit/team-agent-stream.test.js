import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseTeamAgentStream,
  TeamAgentStreamError,
  TeamAgentStreamParser,
} from "../../src/lib/agent-team/team-agent-stream.js";

function line(event, eol = "\n") {
  return `${JSON.stringify(event)}${eol}`;
}

describe("TeamAgentStreamParser", () => {
  it("projects the shared causal interleavings to one terminal summary", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../agent-sdk/__fixtures__/protocol/causal-conformance.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );

    for (const fixtureCase of fixture.cases) {
      const stream = fixtureCase.events
        .map((event) => JSON.stringify(event))
        .join("\n");
      expect(parseTeamAgentStream(stream), fixtureCase.name).toEqual(
        fixture.expected.cliSummary,
      );
    }
  });

  it("incrementally parses split NDJSON and sums usage including cache tokens", () => {
    const promptSecret = "prompt-secret-甲";
    const resultSecret = "result-secret-乙";
    const stream = Buffer.from(
      [
        line(
          {
            type: "system",
            subtype: "init",
            provider: "anthropic",
            model: "claude-sonnet",
          },
          "\r\n",
        ),
        line({ type: "user", prompt: promptSecret }),
        line({
          type: "token_usage",
          usage: {
            input_tokens: 10,
            output_tokens: 3,
            cache_read_input_tokens: 7,
            cache_creation_input_tokens: 2,
          },
        }),
        line({
          type: "token_usage",
          usage: {
            input_tokens: 20,
            output_tokens: 5,
            cache_read_input_tokens: 11,
            cache_creation_input_tokens: 4,
          },
        }),
        line({
          type: "result",
          result: resultSecret,
          usage: {
            input_tokens: 999,
            output_tokens: 999,
            cache_read_input_tokens: 999,
            cache_creation_input_tokens: 999,
          },
        }),
      ].join(""),
      "utf8",
    );

    const parser = new TeamAgentStreamParser();
    // One-byte chunks exercise split lines and split multi-byte UTF-8.
    for (const byte of stream) parser.push(Buffer.from([byte]));
    const summary = parser.finish();

    expect(summary).toEqual({
      provider: "anthropic",
      model: "claude-sonnet",
      usage: {
        input_tokens: 30,
        output_tokens: 8,
        cache_read_input_tokens: 18,
        cache_creation_input_tokens: 6,
      },
      usageRecords: [
        {
          provider: "anthropic",
          model: "claude-sonnet",
          usage: {
            input_tokens: 30,
            output_tokens: 8,
            cache_read_input_tokens: 18,
            cache_creation_input_tokens: 6,
          },
        },
      ],
      terminalResult: true,
    });
    expect(JSON.stringify(summary)).not.toContain(promptSecret);
    expect(JSON.stringify(summary)).not.toContain(resultSecret);
    // All implementation state is private; completed bodies are not retained.
    expect(Object.getOwnPropertyNames(parser)).toEqual([]);
    expect(JSON.stringify(parser)).not.toContain(promptSecret);
    expect(JSON.stringify(parser)).not.toContain(resultSecret);
    expect(parser.terminalEvidence()).toEqual({
      outputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("falls back to the last result usage when no token_usage event exists", () => {
    const summary = parseTeamAgentStream([
      line({
        type: "system",
        subtype: "init",
        provider: "openai",
        model: "gpt-test",
      }),
      line({
        type: "result",
        result: "discard this first body",
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
      // No final LF: finish() must still consume this line.
      JSON.stringify({
        type: "result",
        result: "discard this final body",
        usage: {
          input_tokens: 40,
          output_tokens: 9,
          cache_read_input_tokens: 8,
          cache_creation_input_tokens: 3,
        },
      }),
    ]);

    expect(summary).toEqual({
      provider: "openai",
      model: "gpt-test",
      usage: {
        input_tokens: 40,
        output_tokens: 9,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: 3,
      },
      usageRecords: [
        {
          provider: "openai",
          model: "gpt-test",
          usage: {
            input_tokens: 40,
            output_tokens: 9,
            cache_read_input_tokens: 8,
            cache_creation_input_tokens: 3,
          },
        },
      ],
      terminalResult: true,
    });
  });

  it("returns null usage when neither usage source is present", () => {
    const parser = new TeamAgentStreamParser();
    parser.push(line({ type: "result", result: "body is ignored" }));
    expect(parser.finish()).toEqual({
      provider: null,
      model: null,
      usage: null,
      usageRecords: [],
      terminalResult: true,
    });
    expect(parser.finish()).toEqual({
      provider: null,
      model: null,
      usage: null,
      usageRecords: [],
      terminalResult: true,
    });
  });

  it("exposes only live billing metadata without finishing the parser", () => {
    const parser = new TeamAgentStreamParser();
    parser.push(
      line({
        type: "system",
        subtype: "init",
        provider: "openai",
        model: "gpt-test",
      }),
    );
    parser.push(
      line({
        type: "token_usage",
        usage: { input_tokens: 5, output_tokens: 3 },
        result: "must-not-be-retained",
      }),
    );

    expect(parser.status()).toEqual({
      provider: "openai",
      model: "gpt-test",
      usage: {
        input_tokens: 5,
        output_tokens: 3,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      usageRecords: [
        {
          provider: "openai",
          model: "gpt-test",
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      ],
      terminalResult: false,
    });
    expect(JSON.stringify(parser.status())).not.toContain(
      "must-not-be-retained",
    );
    parser.push(line({ type: "result", usage: { input_tokens: 99 } }));
    expect(parser.finish().usage.input_tokens).toBe(5);
  });

  it("fails explicitly when one NDJSON line exceeds its byte limit", () => {
    const secret = "must-not-leak-from-the-line";
    const parser = new TeamAgentStreamParser({
      maxLineBytes: 24,
      maxTotalBytes: 1024,
    });

    let error;
    try {
      parser.push(line({ type: "result", result: secret }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TeamAgentStreamError);
    expect(error).toMatchObject({
      code: "TEAM_AGENT_STREAM_LINE_LIMIT",
      line: 1,
      limit: 24,
    });
    expect(error.message).not.toContain(secret);
    expect(() => parser.finish()).toThrow(error);
  });

  it("fails explicitly when cumulative input exceeds its total byte limit", () => {
    const parser = new TeamAgentStreamParser({
      maxLineBytes: 32,
      maxTotalBytes: 10,
    });
    parser.push("\n\n\n\n\n");

    expect(() => parser.push("\n\n\n\n\n\n")).toThrowError(
      expect.objectContaining({
        code: "TEAM_AGENT_STREAM_TOTAL_LIMIT",
        limit: 10,
        actual: 11,
      }),
    );
  });

  it("sanitizes invalid JSON errors so prompt/result text cannot leak", () => {
    const secret = "invalid-json-secret";
    const parser = new TeamAgentStreamParser();

    expect.assertions(3);
    try {
      parser.push(`{"type":"result","result":"${secret}",broken}\n`);
    } catch (error) {
      expect(error).toBeInstanceOf(TeamAgentStreamError);
      expect(error.code).toBe("TEAM_AGENT_STREAM_INVALID_JSON");
      expect(error.message).not.toContain(secret);
    }
  });

  it("retains only partial billing metadata after a later protocol failure", () => {
    const parser = new TeamAgentStreamParser();
    parser.push(
      line({
        type: "token_usage",
        provider: "openai",
        model: "gpt-a",
        usage: { input_tokens: 7, output_tokens: 2 },
      }),
    );
    expect(() => parser.push("{broken}\n")).toThrow();

    expect(parser.partialStatus()).toMatchObject({
      usage: {
        input_tokens: 7,
        output_tokens: 2,
      },
      usageRecords: [
        {
          provider: "openai",
          model: "gpt-a",
          usage: {
            input_tokens: 7,
            output_tokens: 2,
          },
        },
      ],
      terminalResult: false,
    });
  });

  it("keeps per-provider/model billing records across fallback events", () => {
    const parser = new TeamAgentStreamParser();
    parser.push(
      line({
        type: "token_usage",
        provider: "openai",
        model: "gpt-a",
        usage: { input_tokens: 3 },
      }),
    );
    parser.push(
      line({
        type: "token_usage",
        provider: "anthropic",
        model: "claude-b",
        usage: { output_tokens: 4 },
      }),
    );
    parser.push(line({ type: "result" }));

    expect(parser.finish().usageRecords).toEqual([
      {
        provider: "openai",
        model: "gpt-a",
        usage: {
          input_tokens: 3,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      {
        provider: "anthropic",
        model: "claude-b",
        usage: {
          input_tokens: 0,
          output_tokens: 4,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    ]);
  });

  it("rejects unsafe usage instead of silently undercounting a budget", () => {
    const parser = new TeamAgentStreamParser();
    expect(() =>
      parser.push(
        line({
          type: "token_usage",
          usage: { input_tokens: -1, output_tokens: 2 },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "TEAM_AGENT_STREAM_INVALID_USAGE",
        field: "input_tokens",
      }),
    );
  });

  it("rejects writes after finish without changing its summary", () => {
    const parser = new TeamAgentStreamParser();
    const summary = parser.finish();
    expect(() => parser.push("\n")).toThrowError(
      expect.objectContaining({ code: "TEAM_AGENT_STREAM_FINISHED" }),
    );
    expect(parser.finish()).toEqual(summary);
  });
});
