import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DataClassifier, DATA_CATEGORIES } from "../data-classifier.js";

// classify()'s rule path needs no DB/LLM; pass { save: false } so it never tries
// to persist (which would need a database).
const classifier = new DataClassifier(null, null);
const classify = (content) => classifier.classify(content, { save: false });

describe("DataClassifier.classify (rule-based PII/PHI/PCI detection)", () => {
  it("returns GENERAL with no detections for empty/clean content", async () => {
    expect((await classify("")).category).toBe(DATA_CATEGORIES.GENERAL);
    const clean = await classify("just some ordinary words here");
    expect(clean.category).toBe(DATA_CATEGORIES.GENERAL);
    expect(clean.detections).toEqual([]);
  });

  it("detects an email as PII", async () => {
    const r = await classify("contact me at alice@example.com please");
    expect(r.category).toBe(DATA_CATEGORIES.PII);
    expect(r.detections.some((d) => d.type === "EMAIL")).toBe(true);
  });

  it("detects an SSN as PII", async () => {
    const r = await classify("ssn 123-45-6789");
    expect(r.detections.some((d) => d.type === "SSN")).toBe(true);
  });

  it("detects a credit card and classifies the result as PCI", async () => {
    const r = await classify("card 4111 1111 1111 1111");
    expect(r.detections.some((d) => d.type === "CREDIT_CARD")).toBe(true);
    expect(r.category).toBe(DATA_CATEGORIES.PCI); // PCI outranks PII
  });

  it("counts every occurrence of a pattern (the /g match)", async () => {
    const r = await classify("a@b.com and c@d.com and e@f.com");
    const email = r.detections.find((d) => d.type === "EMAIL");
    expect(email.count).toBe(3);
  });

  it("is stable across repeated calls (shared pre-compiled regex, no lastIndex leak)", async () => {
    const text = "x@y.com and z@w.com";
    const first = await classify(text);
    const second = await classify(text);
    const c1 = first.detections.find((d) => d.type === "EMAIL").count;
    const c2 = second.detections.find((d) => d.type === "EMAIL").count;
    expect(c1).toBe(2);
    expect(c2).toBe(2); // a leaked lastIndex would drop matches on the 2nd call
  });

  it("classifies PHI when >=2 medical keywords appear", async () => {
    const r = await classify("the patient diagnosis is documented");
    expect(r.category).toBe(DATA_CATEGORIES.PHI);
    expect(r.detections.some((d) => d.type === "PHI_KEYWORDS")).toBe(true);
  });
});
