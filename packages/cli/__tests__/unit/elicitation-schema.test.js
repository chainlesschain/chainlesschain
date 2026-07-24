import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import elicitationSchema from "../../../elicitation-schema/index.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../elicitation-schema/__fixtures__/conformance.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function projectField(field) {
  return {
    name: field.name,
    kind: field.kind,
    ...(field.inputType ? { inputType: field.inputType } : {}),
    required: field.required,
    ...(field.options ? { options: field.options } : {}),
  };
}

describe("shared MCP elicitation schema core", () => {
  it("matches the canonical restricted-vocabulary fixture", () => {
    const testCase = fixture.cases[0];
    const model = elicitationSchema.compileElicitationSchema(testCase.schema);

    expect(model.version).toBe(fixture.version);
    expect(model.supported).toBe(true);
    expect(model.fields.map(projectField)).toEqual(testCase.expectedFields);

    const submission = elicitationSchema.prepareElicitationSubmission(
      model,
      testCase.rawValid,
    );
    expect(submission).toMatchObject({
      valid: true,
      value: testCase.expectedValue,
      errors: [],
    });
    expect(submission.value).not.toHaveProperty("ignored");
  });

  it("coerces primitives and reports every invalid field before submission", () => {
    const testCase = fixture.cases[0];
    const submission = elicitationSchema.prepareElicitationSubmission(
      testCase.schema,
      testCase.rawInvalid,
    );

    expect(submission.valid).toBe(false);
    expect(submission.errors.map((error) => error.code)).toEqual(
      testCase.expectedErrorCodes,
    );
  });

  it("keeps nested schemas and full Draft vocabulary outside its claims", () => {
    const testCase = fixture.cases[1];
    const model = elicitationSchema.compileElicitationSchema(testCase.schema);

    expect(model.supported).toBe(testCase.expectedSupported);
    expect(model.errors.map((error) => error.code)).toEqual(
      testCase.expectedSchemaErrorCodes,
    );
  });
});
