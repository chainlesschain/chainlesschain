import { describe, expect, it } from "vitest";
import {
  COWORK_WORKFLOW_RECORD_SCHEMA,
  WORKFLOW_DEFINITION_SCHEMA,
  createCoworkWorkflowRecord,
  createWorkflowDefinitionAuthority,
  verifyCoworkWorkflowRecord,
} from "../../src/lib/workflow-definition-contract.js";

const WORKFLOW = {
  id: "release-review",
  name: "Release review",
  steps: [{ id: "review", message: "Review release" }],
};

describe("workflow definition contract", () => {
  it("canonicalizes equivalent JSON objects to the same digest", () => {
    const reordered = {
      steps: WORKFLOW.steps,
      name: WORKFLOW.name,
      id: WORKFLOW.id,
    };

    expect(createWorkflowDefinitionAuthority(WORKFLOW)).toMatchObject({
      schema: WORKFLOW_DEFINITION_SCHEMA,
      definitionDigest:
        createWorkflowDefinitionAuthority(reordered).definitionDigest,
    });
  });

  it("round-trips a versioned immutable record", () => {
    const record = createCoworkWorkflowRecord(WORKFLOW);
    const verified = verifyCoworkWorkflowRecord(record);

    expect(record.schema).toBe(COWORK_WORKFLOW_RECORD_SCHEMA);
    expect(verified.status).toBe("versioned");
    expect(verified.definition).toEqual(WORKFLOW);
    expect(Object.isFrozen(verified.definition.steps)).toBe(true);
  });

  it("fails closed when a definition and its declared digest drift", () => {
    const record = createCoworkWorkflowRecord(WORKFLOW);
    const tampered = {
      ...record,
      definition: { ...record.definition, name: "Tampered" },
    };

    expect(() => verifyCoworkWorkflowRecord(tampered)).toThrow(
      /digest mismatch/,
    );
  });

  it("labels raw compatibility definitions as legacy instead of versioned", () => {
    const verified = verifyCoworkWorkflowRecord(WORKFLOW, {
      allowLegacy: true,
    });

    expect(verified.status).toBe("legacy-unversioned");
    expect(verified.recordSchema).toBeNull();
  });
});
