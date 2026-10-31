const assert = require("node:assert/strict");
const test = require("node:test");
const { errorDiagnostic } = require("../src/chat/agent-diagnostics");

test("compaction diagnostics explain provider failures using fixed categories", () => {
  for (const [category, guidance] of [
    ["authentication", /API credentials/],
    ["access_denied", /model permissions/],
    ["rate_limit", /wait before resuming/],
    ["server_error", /service availability/],
    ["http_error", /model endpoint/],
    ["network", /network and proxy/],
    ["invalid_response", /API compatibility/],
  ]) {
    const diagnostic = errorDiagnostic({
      type: "result",
      is_error: true,
      code: "CC_COMPACTION_USAGE_UNKNOWN",
      usage_unknown_reason: "provider_transport_outcome_unknown",
      provider_error: { category, message: "secret response body" },
      error: "secret API key",
    });
    assert.match(diagnostic.text, guidance);
    assert.match(diagnostic.text, /without retrying/);
    assert.ok(!JSON.stringify(diagnostic).includes("secret"));
  }
});

test("unknown compaction fields cannot become diagnostic prose", () => {
  const diagnostic = errorDiagnostic({
    type: "result",
    subtype: "error_compaction_usage_unknown",
    is_error: true,
    usage_unknown_reason: "secret reason",
    provider_error: {
      category: "secret category",
      httpStatus: "secret status",
    },
    error: "secret error",
  });
  assert.match(diagnostic.text, /could not be confirmed/);
  assert.ok(!diagnostic.text.includes("secret"));
});
