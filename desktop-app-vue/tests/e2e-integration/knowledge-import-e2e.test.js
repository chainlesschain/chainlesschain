/**
 * Knowledge Import/Export E2E Integration Tests
 *
 * Tests the full integration flow for Notion import, Evernote import,
 * and static site export with mock DB and mock external dependencies.
 *
 * @module knowledge/knowledge-import-e2e.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let NotionImporter, EvernoteImporter, StaticSiteExporter;

describe("Knowledge Import/Export E2E Integration", () => {
  let mockDb, savedNotes, mockPrepareRun, mockFs;

  beforeEach(async () => {
    vi.resetModules();
    savedNotes = [];

    // Mock dependencies before importing
    vi.doMock("electron", () => ({
      app: { getPath: vi.fn(() => "/mock/userData") },
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    }));
    vi.doMock("../../src/main/utils/logger.js", () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }));
    vi.doMock("uuid", () => ({
      v4: vi.fn(
        () => `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ),
    }));
    mockFs = {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    };
    vi.doMock("fs", () => ({
      ...mockFs,
      default: mockFs,
    }));
    vi.doMock("node:fs", () => ({
      ...mockFs,
      default: mockFs,
    }));
    vi.doMock("adm-zip", () => {
      return {
        default: class MockAdmZip {
          constructor(buffer) {
            this._buffer = buffer;
            this.entries = [];
          }
          getEntries() {
            return this.entries;
          }
        },
      };
    });

    // Setup mock DB
    mockPrepareRun = vi.fn();
    mockDb = {
      exec: vi.fn(),
      run: vi.fn((sql, params) => {
        if (sql.includes("INSERT") && params) {
          const id = params[0];
          savedNotes.push({ id, sql, params });
        }
      }),
      prepare: vi.fn((sql) => ({
        get: vi.fn(() => null),
        all: vi.fn((..._args) => {
          // Return mock notes for static site exporter
          if (sql.includes("SELECT * FROM notes")) {
            return [
              {
                id: "note_001",
                title: "Test Note One",
                content: "# Hello\n\nThis is **bold** and *italic* text.",
                folder: "Test",
                tags: JSON.stringify(["tag1", "tag2"]),
                source: "manual",
                created_at: 1700000000000,
                updated_at: 1700000000000,
              },
              {
                id: "note_002",
                title: "Test Note Two",
                content:
                  "## Subtitle\n\n- Item 1\n- Item 2\n\nSome `code` here.",
                folder: "Test",
                tags: JSON.stringify(["coding"]),
                source: "notion",
                created_at: 1700100000000,
                updated_at: 1700100000000,
              },
            ];
          }
          return [];
        }),
        run: vi.fn((...args) => {
          mockPrepareRun(...args);
          if (sql.includes("INSERT")) {
            savedNotes.push({ id: args[0], params: args });
          }
        }),
        free: vi.fn(),
      })),
      saveToFile: vi.fn(),
    };

    // Import modules
    const notionMod =
      await import("../../src/main/knowledge/notion-importer.js");
    NotionImporter = notionMod.NotionImporter;

    const evernoteMod =
      await import("../../src/main/knowledge/evernote-importer.js");
    EvernoteImporter = evernoteMod.EvernoteImporter;

    const exporterMod =
      await import("../../src/main/knowledge/static-site-exporter.js");
    StaticSiteExporter = exporterMod.StaticSiteExporter;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Flow 1: Notion import — parse ZIP with markdown files ───────────

  it("Flow 1: Notion import — parse ZIP with markdown → convert to notes → save to DB", async () => {
    const importer = new NotionImporter({ db: mockDb });

    // Manually set up mock entries on the AdmZip instance
    // Since we mock adm-zip, we need to test the internal methods directly
    // and verify the full flow with _extractTitle, _parseNotionMarkdown, _saveNote

    // Test _extractTitle with H1
    const titleFromH1 = importer._extractTitle(
      "My Page abc123.md",
      "# My Actual Title\n\nContent here",
    );
    expect(titleFromH1).toBe("My Actual Title");

    // Test _extractTitle with filename fallback (strips Notion hash)
    // Notion appends a 32-character hex hash after a space
    const titleFromFile = importer._extractTitle(
      "My Page abcdef0123456789abcdef0123456789.md",
      "No heading here, just content.",
    );
    // The hash is 32 hex chars [a-f0-9]{32}: the regex removes it
    expect(titleFromFile).toBe("My Page");

    // Verify filename without hash is returned as-is
    const titleNoHash = importer._extractTitle("Simple Title.md", "No heading");
    expect(titleNoHash).toBe("Simple Title");

    // Test _parseNotionMarkdown with properties block
    const parsed = importer._parseNotionMarkdown(
      "Tags: react, javascript\nStatus: Published\n\n# Real Content\n\nBody text here",
    );
    expect(parsed.tags).toContain("react");
    expect(parsed.tags).toContain("javascript");
    expect(parsed.content).toContain("Real Content");
    expect(parsed.content).not.toContain("Tags:");

    // Test _saveNote persists to DB
    const noteId = importer._saveNote({
      title: "Test Note",
      content: "Test content",
      folder: "Notion Import",
      tags: ["test"],
      source: "notion",
      sourceFile: "test.md",
    });

    expect(noteId).toBeDefined();
    expect(mockDb.prepare).toHaveBeenCalled();
    expect(mockPrepareRun).toHaveBeenCalledWith(
      noteId,
      "Test Note",
      "Test content",
      "Notion Import",
      JSON.stringify(["test"]),
      "notion",
      "test.md",
      expect.any(Number),
      expect.any(Number),
    );
  });

  // ─── Flow 2: Evernote import — parse ENEX XML ───────────────────────

  it("Flow 2: Evernote import — parse ENEX XML → convert ENML to markdown → save notes", async () => {
    const importer = new EvernoteImporter({ db: mockDb });

    const enexContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export>
  <note>
    <title>Meeting Notes</title>
    <content><![CDATA[<en-note><h1>Meeting</h1><p>Discussed <b>project timeline</b>.</p><br/><a href="https://example.com">Link</a></en-note>]]></content>
    <created>20230615T100000Z</created>
    <updated>20230615T120000Z</updated>
    <tag>work</tag>
    <tag>meetings</tag>
  </note>
  <note>
    <title>Shopping List</title>
    <content><![CDATA[<en-note><li>Apples</li><li>Bread</li></en-note>]]></content>
    <created>20230616T080000Z</created>
    <tag>personal</tag>
    <resource><data encoding="base64">abc123</data></resource>
  </note>
</en-export>`;

    const result = await importer.importFromEnex(
      enexContent,
      "Evernote Import",
    );

    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.attachments).toBe(1); // One resource in second note

    // Verify notes were saved to DB
    expect(savedNotes.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Flow 3: Static site export — fetch notes → generate HTML + CSS ──

  it("Flow 3: Static site export — fetch notes from DB → generate index.html + note pages + CSS", async () => {
    const exporter = new StaticSiteExporter({ db: mockDb });

    // Test _fetchNotes retrieves mock notes from DB
    const notes = exporter._fetchNotes(null);
    expect(notes).toHaveLength(2);
    expect(notes[0].title).toBe("Test Note One");
    expect(notes[1].title).toBe("Test Note Two");

    // Test _generateIndexPage produces correct HTML
    const indexHtml = exporter._generateIndexPage(
      "My Knowledge Base",
      notes,
      "light",
    );
    expect(indexHtml).toContain("My Knowledge Base");
    expect(indexHtml).toContain("Test Note One");
    expect(indexHtml).toContain("Test Note Two");
    expect(indexHtml).toContain("2 notes");
    expect(indexHtml).toContain("Generated by ChainlessChain");
    expect(indexHtml).toContain('data-theme="light"');
    expect(indexHtml).toContain("style.css");

    // Verify note links use slugified titles
    expect(indexHtml).toContain("test-note-one.html");
    expect(indexHtml).toContain("test-note-two.html");

    // Verify tags are rendered in index
    expect(indexHtml).toContain("tag1");
    expect(indexHtml).toContain("tag2");
    expect(indexHtml).toContain("coding");

    // Test _generateNotePage produces correct HTML for each note
    const noteHtml = exporter._generateNotePage(
      "My Knowledge Base",
      notes[0],
      "light",
    );
    expect(noteHtml).toContain("Test Note One");
    expect(noteHtml).toContain("Back");
    expect(noteHtml).toContain("index.html");
    expect(noteHtml).toContain("Generated by ChainlessChain");
    expect(noteHtml).toContain('data-theme="light"');
    // Content should be converted from markdown to HTML
    expect(noteHtml).toContain("<strong>bold</strong>");

    // Test _generateCSS produces valid CSS
    const css = exporter._generateCSS("light");
    expect(css).toContain("--bg:");
    expect(css).toContain("--text:");
    expect(css).toContain("--accent:");
    expect(css).toContain("#ffffff"); // light background
    expect(css).toContain("#333333"); // dark text for light theme
    expect(css).toContain("font-family");

    // Test _slugify produces correct slugs
    expect(exporter._slugify("Test Note One")).toBe("test-note-one");
    expect(exporter._slugify("Test Note Two")).toBe("test-note-two");
  });

  // ─── Flow 4: Notion CSV import — parse CSV database export ──────────

  it("Flow 4: Notion CSV import — parse CSV database export → convert rows to notes", () => {
    const importer = new NotionImporter({ db: mockDb });

    // Test CSV parsing
    const csvContent = `Name,Status,Tags,Description
"My Task","In Progress","tag1, tag2","A task description"
"Another Task","Done","tag3","Another description"`;

    const rows = importer._parseCSV(csvContent);
    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe("My Task");
    expect(rows[0].Status).toBe("In Progress");
    expect(rows[0].Tags).toBe("tag1, tag2");
    expect(rows[1].Name).toBe("Another Task");

    // Test CSV row to markdown conversion
    const markdown = importer._csvRowToMarkdown(rows[0]);
    expect(markdown).toContain("**Name**: My Task");
    expect(markdown).toContain("**Status**: In Progress");
    expect(markdown).toContain("**Tags**: tag1, tag2");

    // Test _splitCSVLine with quoted fields
    const line = '"Hello, World",Simple,"Has ""quotes"""';
    const parts = importer._splitCSVLine(line);
    expect(parts[0]).toBe("Hello, World");
    expect(parts[1]).toBe("Simple");

    // Verify that saving a CSV row note uses correct folder suffix
    importer._saveNote({
      title: rows[0].Name,
      content: markdown,
      folder: "Notion Import/Database",
      tags: ["tag1", "tag2"],
      source: "notion-csv",
      sourceFile: "database.csv",
    });

    // Verify DB insert was called with the Database subfolder
    const insertCall = mockPrepareRun.mock.calls.find(
      (c) => c[3] === "Notion Import/Database",
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[4]).toBe(JSON.stringify(["tag1", "tag2"]));
    expect(insertCall[5]).toBe("notion-csv");
  });

  // ─── Flow 5: Privacy/content handling — ENML special tags ───────────

  it("Flow 5: Privacy/content handling — ENML special tags (en-todo, en-note) conversion", () => {
    const importer = new EvernoteImporter({ db: mockDb });

    // Test en-todo checked conversion
    const withChecked = importer._enmlToMarkdown(
      '<en-note><en-todo checked="true"/>Buy groceries<br/><en-todo/>Clean house</en-note>',
    );
    expect(withChecked).toContain("- [x] Buy groceries");
    expect(withChecked).toContain("- [ ] Clean house");

    // Test en-note wrapper removal
    const withEnNote = importer._enmlToMarkdown(
      "<en-note><p>Simple paragraph</p></en-note>",
    );
    expect(withEnNote).not.toContain("en-note");
    expect(withEnNote).toContain("Simple paragraph");

    // Test CDATA wrapper removal
    const withCdata = importer._enmlToMarkdown(
      "<![CDATA[<en-note><b>Bold text</b></en-note>]]>",
    );
    expect(withCdata).toContain("**Bold text**");
    expect(withCdata).not.toContain("CDATA");

    // Test HTML entity decoding
    const withEntities = importer._enmlToMarkdown(
      "<en-note>&amp; &lt; &gt; &quot; &#39; &nbsp;</en-note>",
    );
    expect(withEntities).toContain("&");
    expect(withEntities).toContain("<");
    expect(withEntities).toContain(">");
    expect(withEntities).toContain('"');
    expect(withEntities).toContain("'");

    // Test heading conversion
    const withHeadings = importer._enmlToMarkdown(
      "<en-note><h1>Title</h1><h2>Subtitle</h2><h3>Section</h3></en-note>",
    );
    expect(withHeadings).toContain("# Title");
    expect(withHeadings).toContain("## Subtitle");
    expect(withHeadings).toContain("### Section");

    // Test link conversion
    const withLink = importer._enmlToMarkdown(
      '<en-note><a href="https://example.com">Click here</a></en-note>',
    );
    expect(withLink).toContain("[Click here](https://example.com)");

    // Test code conversion
    const withCode = importer._enmlToMarkdown(
      "<en-note><code>const x = 1</code></en-note>",
    );
    expect(withCode).toContain("`const x = 1`");

    // Test italic/emphasis conversion
    const withItalic = importer._enmlToMarkdown(
      "<en-note><i>italic</i> and <em>emphasis</em></en-note>",
    );
    expect(withItalic).toContain("*italic*");
    expect(withItalic).toContain("*emphasis*");

    // Test list item conversion
    const withList = importer._enmlToMarkdown(
      "<en-note><li>First item</li><li>Second item</li></en-note>",
    );
    expect(withList).toContain("- First item");
    expect(withList).toContain("- Second item");
  });

  // ─── Flow 6: Error handling — invalid inputs ───────────────────────

  it("Flow 6: Error handling — invalid inputs return proper error responses", async () => {
    // EvernoteImporter with empty XML
    const evernoteImporter = new EvernoteImporter({ db: mockDb });
    const emptyResult = await evernoteImporter.importFromEnex(
      "",
      "Evernote Import",
    );
    expect(emptyResult.imported).toBe(0);
    expect(emptyResult.errors).toHaveLength(0);

    // EvernoteImporter with malformed XML (no notes)
    const malformedResult = await evernoteImporter.importFromEnex(
      "<en-export><invalid>not a note</invalid></en-export>",
      "Evernote Import",
    );
    expect(malformedResult.imported).toBe(0);

    // EvernoteImporter._enmlToMarkdown with null/empty content
    expect(evernoteImporter._enmlToMarkdown(null)).toBe("");
    expect(evernoteImporter._enmlToMarkdown("")).toBe("");

    // EvernoteImporter._parseEnexDate with invalid date
    const fallbackDate = evernoteImporter._parseEnexDate("not-a-date");
    expect(fallbackDate).toBeGreaterThan(0); // Falls back to Date.now()

    // EvernoteImporter._parseEnexDate with null
    const nullDate = evernoteImporter._parseEnexDate(null);
    expect(nullDate).toBeGreaterThan(0);

    // NotionImporter._parseCSV with empty content
    const notionImporter = new NotionImporter({ db: mockDb });
    const emptyCSV = notionImporter._parseCSV("");
    expect(emptyCSV).toHaveLength(0);

    // NotionImporter._parseCSV with header only (no data rows)
    const headerOnlyCSV = notionImporter._parseCSV("Name,Status\n");
    expect(headerOnlyCSV).toHaveLength(0);

    // NotionImporter._parseNotionMarkdown with no properties
    const noPropsParsed = notionImporter._parseNotionMarkdown(
      "Just plain content without any properties.",
    );
    expect(noPropsParsed.tags).toHaveLength(0);
    expect(noPropsParsed.content).toContain("Just plain content");

    // StaticSiteExporter with empty notes (mock DB returns empty)
    const emptyDbMock = {
      ...mockDb,
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        run: vi.fn(),
        get: vi.fn(),
        free: vi.fn(),
      })),
    };
    const exporter = new StaticSiteExporter({ db: emptyDbMock });
    const emptyExportResult =
      await exporter.exportToStaticSite("/mock/empty-output");
    expect(emptyExportResult.exported).toBe(0);

    // StaticSiteExporter helper methods edge cases
    const realExporter = new StaticSiteExporter({ db: mockDb });
    expect(realExporter._slugify("")).toBe("untitled");
    expect(realExporter._slugify("Hello World!")).toBe("hello-world");
    expect(realExporter._escapeHtml(null)).toBe("");
    expect(realExporter._escapeHtml('<script>"xss"</script>')).toContain(
      "&lt;script&gt;",
    );
    expect(realExporter._markdownToHtml("")).toBe("");
  });

  // ─── Additional: Evernote date parsing ──────────────────────────────

  it("Evernote date parsing — parses Evernote date format correctly", () => {
    const importer = new EvernoteImporter({ db: mockDb });

    // Standard Evernote format: 20130502T075520Z
    const ts = importer._parseEnexDate("20230615T100000Z");
    const d = new Date(ts);
    expect(d.getUTCFullYear()).toBe(2023);
    expect(d.getUTCMonth()).toBe(5); // June (0-indexed)
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(10);
    expect(d.getUTCMinutes()).toBe(0);
  });

  // ─── Additional: Static site dark theme ─────────────────────────────

  it("Static site export — dark theme generates correct CSS variables", () => {
    const exporter = new StaticSiteExporter({ db: mockDb });

    // Test dark theme CSS generation
    const darkCss = exporter._generateCSS("dark");
    expect(darkCss).toContain("#1a1a2e"); // dark background
    expect(darkCss).toContain("#e0e0e0"); // light text
    expect(darkCss).toContain("#16213e"); // dark card background

    // Verify light theme CSS is different
    const lightCss = exporter._generateCSS("light");
    expect(lightCss).toContain("#ffffff"); // light background
    expect(lightCss).toContain("#333333"); // dark text
    expect(lightCss).not.toContain("#1a1a2e");

    // Verify dark theme HTML uses correct data-theme attribute
    const notes = exporter._fetchNotes(null);
    const darkIndexHtml = exporter._generateIndexPage(
      "Dark Site",
      notes,
      "dark",
    );
    expect(darkIndexHtml).toContain('data-theme="dark"');

    const darkNoteHtml = exporter._generateNotePage(
      "Dark Site",
      notes[0],
      "dark",
    );
    expect(darkNoteHtml).toContain('data-theme="dark"');
  });

  // ─── Additional: Evernote Buffer input ──────────────────────────────

  it("Evernote import — handles Buffer input correctly", async () => {
    const importer = new EvernoteImporter({ db: mockDb });

    const enexBuffer = Buffer.from(
      `<en-export><note>
        <title>Buffer Note</title>
        <content><![CDATA[<en-note>Buffer content</en-note>]]></content>
      </note></en-export>`,
      "utf8",
    );

    const result = await importer.importFromEnex(enexBuffer, "Buffer Test");
    expect(result.imported).toBe(1);
  });

  // ─── Additional: Static site markdown to HTML conversion ────────────

  it("Static site export — _markdownToHtml converts markdown correctly", () => {
    const exporter = new StaticSiteExporter({ db: mockDb });

    const md =
      "# Title\n\n**Bold** and *italic*\n\n- List item 1\n- List item 2\n\nSome `inline code` here";
    const html = exporter._markdownToHtml(md);

    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>List item 1</li>");
    expect(html).toContain("<code>inline code</code>");
  });
});
