const crypto = require("crypto");
const { compileElicitationSchema } = require("../vendor/elicitation-schema");

function stable(value, depth = 0, budget = { nodes: 0, chars: 0 }) {
  budget.nodes++;
  budget.chars += typeof value === "string" ? value.length : 0;
  if (depth > 20 || budget.nodes > 8192 || budget.chars > 131072)
    throw new Error("Question structure exceeds recovery limits");
  if (Array.isArray(value)) {
    if (value.length > 8192) throw new Error("Question has too many values");
    return value.map((v) => stable(v, depth + 1, budget));
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length > 8192) throw new Error("Question has too many fields");
    return Object.fromEntries(
      keys.sort().map((key) => {
        budget.chars += key.length;
        return [key, stable(value[key], depth + 1, budget)];
      }),
    );
  }
  return value;
}

function questionIdentity(sessionId, request) {
  const source = JSON.stringify(
    stable({
      sessionId,
      id: request.id,
      binding: request.binding || null,
      question: request.question,
      options: request.options || null,
      multiSelect: !!request.multiSelect,
      mode: request.mode || request.metadata?.mode || null,
      // App Server keeps blocking/deferred mode separately from MCP form/url.
      // A changed presentation or sensitivity must replace the original review.
      elicitationMode: request.metadata?.mode,
      password: request.password === true ? true : undefined,
      blocking: request.blocking !== false,
      purpose: request.purpose || null,
      contextRevision:
        request.contextRevision ?? request.context_revision ?? null,
      elicitation:
        request.elicitation === true ||
        request.metadata?.kind === "mcp_elicitation",
      schema:
        request.requestedSchema || request.metadata?.requestedSchema || null,
      server: request.server || request.metadata?.server || null,
      url: request.url || request.metadata?.url || null,
      elicitationId:
        request.elicitationId || request.metadata?.elicitationId || null,
    }),
  );
  if (Buffer.byteLength(source) > 128 * 1024)
    throw new Error("Question is too large for draft recovery");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function questionFields(request) {
  if (request.mode === "url" || request.metadata?.mode === "url") return [];
  const schema = request.requestedSchema || request.metadata?.requestedSchema;
  if (schema) {
    const model = compileElicitationSchema(schema);
    if (model.supported)
      return model.fields.flatMap((f) => {
        const base = {
          key: JSON.stringify([f.name]),
          label: f.title || f.name,
        };
        const secret =
          schema.properties?.[f.name]?.writeOnly === true ||
          schema.properties?.[f.name]?.format === "password" ||
          f.inputType === "password";
        if (f.kind === "multi-select")
          return f.options.map((o) => ({
            key: JSON.stringify([f.name, o.value]),
            label: `${base.label}: ${o.label}`,
            kind: secret ? "password" : "checkbox",
            option: true,
          }));
        if (secret) return [{ ...base, kind: "password" }];
        if (f.kind === "boolean") return [{ ...base, kind: "checkbox" }];
        if (f.kind === "single-select")
          return [
            {
              ...base,
              kind: "select",
              choices: f.options.map((o) => String(o.value)),
            },
          ];
        return [
          { ...base, kind: f.inputType === "password" ? "password" : "text" },
        ];
      });
    // Unknown schemas can contain secrets that the host cannot classify. Keep
    // their JSON fallback editable but do not persist it as ordinary text.
    return [{ key: "answer-json", label: "Answer", kind: "password" }];
  }
  if (request.options?.length)
    return request.multiSelect
      ? request.options.map((o, i) => ({
          key: `option-${i}`,
          label: typeof o === "string" ? o : String(o.label ?? o.value ?? ""),
          kind: "checkbox",
          option: true,
        }))
      : [];
  return [{ key: "answer", label: "Answer", kind: "text" }];
}

function normalizeQuestionFields(descriptors, values) {
  if (!Array.isArray(values) || values.length > 128 || descriptors.length > 128)
    throw new Error("Question draft has too many fields");
  const allowed = new Map(
    descriptors.filter((d) => d.kind !== "password").map((d) => [d.key, d]),
  );
  const result = [];
  const seen = new Set();
  let bytes = 0;
  for (const candidate of values) {
    const field = allowed.get(candidate?.key);
    if (!field || seen.has(field.key)) continue;
    seen.add(field.key);
    const value = candidate.value;
    if (
      field.kind === "checkbox"
        ? typeof value !== "boolean"
        : typeof value !== "string"
    )
      throw new Error("Invalid question draft field");
    if (typeof value === "string" && value.length > 32768)
      throw new Error("Question draft field exceeds 32K characters");
    if (
      field.kind === "select" &&
      value !== "" &&
      !field.choices.includes(value)
    )
      throw new Error("Question draft choice is no longer available");
    bytes += Buffer.byteLength(JSON.stringify({ key: field.key, value }));
    if (bytes > 65536) throw new Error("Question draft exceeds 64 KiB");
    result.push({ key: field.key, value });
  }
  return result;
}

function questionDraftText(descriptors, fields) {
  const values = new Map(fields.map((f) => [f.key, f.value]));
  return descriptors
    .filter(
      (d) =>
        d.kind !== "password" &&
        values.has(d.key) &&
        values.get(d.key) !== "" &&
        (!d.option || values.get(d.key)),
    )
    .map((d) => `${d.label}: ${values.get(d.key)}`)
    .join("\n")
    .slice(0, 65536);
}

module.exports = {
  questionIdentity,
  questionFields,
  normalizeQuestionFields,
  questionDraftText,
};
