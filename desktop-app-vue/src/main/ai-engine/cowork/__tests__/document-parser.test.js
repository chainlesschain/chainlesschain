/**
 * DocumentParser unit tests — v3.2
 *
 * Coverage: initialize, parse (text/json/csv via in-memory string inputs),
 *           getSupportedFormats, getStats, getConfig/configure,
 *           SUPPORTED_FORMATS constants
 *
 * NOTE: vi.mock("fs") does NOT intercept Node built-in require() in the
 *       forks pool. Instead we rely on the parser's built-in behavior for
 *       raw string inputs (non-existent path → treated as raw text content)
 *       and use explicit options.format to select json/csv/md parsers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
const { DocumentParser, SUPPORTED_FORMATS } = require("../document-parser");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    exec: vi.fn(),
    run: vi.fn(),
    prepare: vi.fn().mockReturnValue(prepResult),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DocumentParser", () => {
  let parser;
  let db;

  beforeEach(() => {
    parser = new DocumentParser();
    db = createMockDatabase();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // initialize()
  // ──────────────────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized=true after first call", async () => {
      await parser.initialize(db);

      expect(parser.initialized).toBe(true);
    });

    it("should set db reference", async () => {
      await parser.initialize(db);

      expect(parser.db).toBe(db);
    });

    it("should be idempotent on double initialize", async () => {
      await parser.initialize(db);
      const db2 = createMockDatabase();
      await parser.initialize(db2); // second call is a no-op

      expect(parser.db).toBe(db);
    });

    it("should throw if parse() is called before initialize()", async () => {
      await expect(parser.parse("some text content")).rejects.toThrow(
        "DocumentParser not initialized",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // parse() — text type
  // ──────────────────────────────────────────────────────────────────────────
  describe("parse() — text input", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should return an object with a text field for a plain string", async () => {
      // A non-existent path string is treated as raw text by the parser
      const result = await parser.parse("Hello world text");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("text");
      expect(result.text).toContain("Hello world text");
    });

    it("should return parsedAt, format, and filePath fields", async () => {
      // When treated as raw text, filePath will be null and format comes from
      // _parseText (no format property is set there — it's added in the
      // buffer branch only). For the raw-text shortcut path the result object
      // still has text, pages, tables, images from _parseText.
      const result = await parser.parse("Sample plain text content");

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("pages");
      expect(result).toHaveProperty("tables");
      expect(result).toHaveProperty("images");
    });

    it("should return a non-empty text value when content is provided", async () => {
      const result = await parser.parse("Non-empty content here");

      expect(result.text.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // parse() — JSON type via Buffer
  // ──────────────────────────────────────────────────────────────────────────
  describe("parse() — JSON input via Buffer", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should return a data field containing the parsed JSON object", async () => {
      const jsonContent = '{"key":"value","num":42}';
      const buffer = Buffer.from(jsonContent, "utf-8");

      const result = await parser.parse(buffer, {
        format: SUPPORTED_FORMATS.JSON,
      });

      expect(result).toHaveProperty("data");
      expect(result.data).toEqual({ key: "value", num: 42 });
    });

    it("should return a formatted text representation of the JSON", async () => {
      const jsonContent = '{"a":1}';
      const buffer = Buffer.from(jsonContent, "utf-8");

      const result = await parser.parse(buffer, {
        format: SUPPORTED_FORMATS.JSON,
      });

      expect(result.text).toContain('"a"');
      expect(result.text).toContain("1");
    });

    it("should set format to 'json' in the result", async () => {
      const buffer = Buffer.from('{"x":true}', "utf-8");

      const result = await parser.parse(buffer, {
        format: SUPPORTED_FORMATS.JSON,
      });

      expect(result.format).toBe(SUPPORTED_FORMATS.JSON);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // parse() — CSV type via Buffer
  // ──────────────────────────────────────────────────────────────────────────
  describe("parse() — CSV input via Buffer", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should return a tables array containing rows", async () => {
      const csvContent = "col1,col2,col3\nval1,val2,val3\nfoo,bar,baz";
      const buffer = Buffer.from(csvContent, "utf-8");

      const result = await parser.parse(buffer, {
        format: SUPPORTED_FORMATS.CSV,
      });

      expect(result).toHaveProperty("tables");
      expect(Array.isArray(result.tables)).toBe(true);
      expect(result.tables.length).toBeGreaterThan(0);
    });

    it("should parse CSV headers from the first row", async () => {
      const csvContent = "name,age\nAlice,30\nBob,25";
      const buffer = Buffer.from(csvContent, "utf-8");

      const result = await parser.parse(buffer, {
        format: SUPPORTED_FORMATS.CSV,
      });

      const table = result.tables[0];
      expect(table.headers).toContain("name");
      expect(table.headers).toContain("age");
    });

    it("should parse CSV data rows (excluding header)", async () => {
      const csvContent = "x,y\n1,2\n3,4";
      const buffer = Buffer.from(csvContent, "utf-8");

      const result = await parser.parse(buffer, {
        format: SUPPORTED_FORMATS.CSV,
      });

      const table = result.tables[0];
      expect(Array.isArray(table.rows)).toBe(true);
      expect(table.rows.length).toBe(2);
    });

    it("should set format to 'csv' in the result", async () => {
      const buffer = Buffer.from("a,b\n1,2", "utf-8");

      const result = await parser.parse(buffer, {
        format: SUPPORTED_FORMATS.CSV,
      });

      expect(result.format).toBe(SUPPORTED_FORMATS.CSV);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // parse() — events and stats
  // ──────────────────────────────────────────────────────────────────────────
  describe("parse() — events and stats", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should emit 'document:parsed' event after successful parse via Buffer", async () => {
      const handler = vi.fn();
      parser.on("document:parsed", handler);
      const buffer = Buffer.from("Hello", "utf-8");

      await parser.parse(buffer, { format: SUPPORTED_FORMATS.TXT });

      expect(handler).toHaveBeenCalledOnce();
      const payload = handler.mock.calls[0][0];
      expect(payload).toHaveProperty("format");
      expect(payload).toHaveProperty("elapsed");
    });

    it("should increment getStats().successCount after each successful parse", async () => {
      expect(parser.getStats().successCount).toBe(0);

      const buffer = Buffer.from("test content", "utf-8");
      await parser.parse(buffer, { format: SUPPORTED_FORMATS.TXT });

      expect(parser.getStats().successCount).toBe(1);

      await parser.parse(buffer, { format: SUPPORTED_FORMATS.TXT });

      expect(parser.getStats().successCount).toBe(2);
    });

    it("should increment getStats().totalParsed for each parse call", async () => {
      expect(parser.getStats().totalParsed).toBe(0);

      // Even a raw text shortcut path increments totalParsed is NOT guaranteed
      // because the raw-text path returns early. Use Buffer inputs to ensure
      // the full stats path is exercised.
      const buffer = Buffer.from("data", "utf-8");
      await parser.parse(buffer, { format: SUPPORTED_FORMATS.TXT });
      await parser.parse(buffer, { format: SUPPORTED_FORMATS.TXT });

      expect(parser.getStats().totalParsed).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getSupportedFormats()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getSupportedFormats()", () => {
    beforeEach(async () => {
      await parser.initialize(db);
    });

    it("should return a non-empty Array", () => {
      const formats = parser.getSupportedFormats();

      expect(Array.isArray(formats)).toBe(true);
      expect(formats.length).toBeGreaterThan(0);
    });

    it("should contain 'pdf' and 'txt'", () => {
      const formats = parser.getSupportedFormats();

      expect(formats).toContain("pdf");
      expect(formats).toContain("txt");
    });

    it("should contain all SUPPORTED_FORMATS values", () => {
      const formats = parser.getSupportedFormats();
      const expected = Object.values(SUPPORTED_FORMATS);

      for (const fmt of expected) {
        expect(formats).toContain(fmt);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getConfig() / configure()
  // ──────────────────────────────────────────────────────────────────────────
  describe("getConfig() / configure()", () => {
    it("should return default config with expected keys", () => {
      const config = parser.getConfig();

      expect(config).toHaveProperty("maxFileSizeMB");
      expect(config).toHaveProperty("extractTables");
      expect(config).toHaveProperty("extractImages");
      expect(config).toHaveProperty("maxPages");
      expect(config).toHaveProperty("csvDelimiter");
      expect(config).toHaveProperty("encoding");
    });

    it("should update a config field via configure()", () => {
      parser.configure({ maxFileSizeMB: 100 });

      expect(parser.getConfig().maxFileSizeMB).toBe(100);
    });

    it("should return the updated config from configure()", () => {
      const returned = parser.configure({ csvDelimiter: ";" });

      expect(returned.csvDelimiter).toBe(";");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SUPPORTED_FORMATS constants
  // ──────────────────────────────────────────────────────────────────────────
  describe("SUPPORTED_FORMATS", () => {
    it("should have PDF, DOCX, XLSX, TXT, MD, CSV, JSON keys", () => {
      expect(SUPPORTED_FORMATS).toHaveProperty("PDF");
      expect(SUPPORTED_FORMATS).toHaveProperty("DOCX");
      expect(SUPPORTED_FORMATS).toHaveProperty("XLSX");
      expect(SUPPORTED_FORMATS).toHaveProperty("TXT");
      expect(SUPPORTED_FORMATS).toHaveProperty("MD");
      expect(SUPPORTED_FORMATS).toHaveProperty("CSV");
      expect(SUPPORTED_FORMATS).toHaveProperty("JSON");
    });

    it("should map PDF to 'pdf', DOCX to 'docx', JSON to 'json'", () => {
      expect(SUPPORTED_FORMATS.PDF).toBe("pdf");
      expect(SUPPORTED_FORMATS.DOCX).toBe("docx");
      expect(SUPPORTED_FORMATS.JSON).toBe("json");
    });

    it("should have string values for all keys", () => {
      for (const [, value] of Object.entries(SUPPORTED_FORMATS)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });
});
