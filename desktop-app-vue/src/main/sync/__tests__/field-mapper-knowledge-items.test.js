/**
 * FieldMapper.toLocal — knowledge_items column alignment
 *
 * Regression: toLocal emitted `user_id: backendRecord.userId` for knowledge_items,
 * but that table has no user_id column (base schema + every ALTER migration).
 * DBSyncManager.insertOrUpdateLocal builds `INSERT INTO ... (Object.keys(record))`,
 * so the user_id key made the INSERT throw "no such column: user_id" and silently
 * aborted the knowledge_items download. Ownership is tracked via created_by.
 */
import { describe, it, expect } from "vitest";

const FieldMapper = require("../field-mapper.js");

describe("FieldMapper.toLocal knowledge_items", () => {
  it("does not emit user_id (not a knowledge_items column)", () => {
    const fm = new FieldMapper();
    const mapped = fm.toLocal(
      {
        id: "k1",
        title: "T",
        type: "note",
        content: "c",
        createdAt: 1000,
        updatedAt: 2000,
        userId: "u1",
        deviceId: "d1",
      },
      "knowledge_items",
    );

    expect(mapped).not.toHaveProperty("user_id");
    // valid columns are still mapped
    expect(mapped.id).toBe("k1");
    expect(mapped.title).toBe("T");
    expect(mapped.device_id).toBe("d1");
  });
});
