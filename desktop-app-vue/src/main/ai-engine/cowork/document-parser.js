/**
 * Document Parser — PDF/DOCX/XLSX Content Extraction (v3.2)
 *
 * Extracts structured content from various document formats:
 * - PDF: text, tables, images, page structure
 * - DOCX: paragraphs, headings, tables, images
 * - XLSX: sheets, rows, named ranges
 * - Plain text / Markdown passthrough
 *
 * Uses graceful fallback when parsing libraries are unavailable.
 *
 * @module ai-engine/cowork/document-parser
 */

const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const SUPPORTED_FORMATS = {
  PDF: "pdf",
  DOCX: "docx",
  XLSX: "xlsx",
  TXT: "txt",
  MD: "md",
  CSV: "csv",
  JSON: "json",
};

const FORMAT_EXTENSIONS = {
  ".pdf": SUPPORTED_FORMATS.PDF,
  ".docx": SUPPORTED_FORMATS.DOCX,
  ".doc": SUPPORTED_FORMATS.DOCX,
  ".xlsx": SUPPORTED_FORMATS.XLSX,
  ".xls": SUPPORTED_FORMATS.XLSX,
  ".txt": SUPPORTED_FORMATS.TXT,
  ".md": SUPPORTED_FORMATS.MD,
  ".csv": SUPPORTED_FORMATS.CSV,
  ".json": SUPPORTED_FORMATS.JSON,
};

const DEFAULT_CONFIG = {
  maxFileSizeMB: 50,
  extractTables: true,
  extractImages: false,
  maxPages: 100,
  csvDelimiter: ",",
  encoding: "utf-8",
};

// ============================================================
// DocumentParser Class
// ============================================================

class DocumentParser extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.config = { ...DEFAULT_CONFIG };
    this.stats = {
      totalParsed: 0,
      successCount: 0,
      failureCount: 0,
      formatDistribution: {},
      averageParseTimeMs: 0,
    };
    this._parseTimes = [];
  }

  /**
   * Initialize
   * @param {Object} db - Database instance
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    logger.info("[DocumentParser] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Parse a document file or buffer
   * @param {string|Buffer} input - File path or buffer data
   * @param {Object} [options] - Parse options
   * @param {string} [options.format] - Force format (auto-detect from extension if omitted)
   * @param {boolean} [options.extractTables] - Extract tables
   * @param {boolean} [options.extractImages] - Extract images
   * @returns {Object} Parsed document content
   */
  async parse(input, options = {}) {
    if (!this.initialized) {
      throw new Error("DocumentParser not initialized");
    }

    const startTime = Date.now();
    this.stats.totalParsed++;

    try {
      let filePath = null;
      let buffer = null;
      let format = options.format || null;

      // Determine input type
      if (typeof input === "string") {
        if (fs.existsSync(input)) {
          filePath = input;
          buffer = fs.readFileSync(input);
          if (!format) {
            const ext = path.extname(input).toLowerCase();
            format = FORMAT_EXTENSIONS[ext] || SUPPORTED_FORMATS.TXT;
          }
        } else {
          // Treat as raw text content
          return this._parseText(input, options);
        }
      } else if (Buffer.isBuffer(input)) {
        buffer = input;
        format = format || SUPPORTED_FORMATS.TXT;
      } else {
        throw new Error("Input must be a file path or Buffer");
      }

      // Check file size
      if (buffer && buffer.length > this.config.maxFileSizeMB * 1024 * 1024) {
        throw new Error(
          `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds ${this.config.maxFileSizeMB}MB limit`,
        );
      }

      // Dispatch to format-specific parser
      let result;
      switch (format) {
        case SUPPORTED_FORMATS.PDF:
          result = await this._parsePDF(buffer, options);
          break;
        case SUPPORTED_FORMATS.DOCX:
          result = await this._parseDOCX(buffer, options);
          break;
        case SUPPORTED_FORMATS.XLSX:
          result = await this._parseXLSX(buffer, options);
          break;
        case SUPPORTED_FORMATS.CSV:
          result = this._parseCSV(
            buffer.toString(this.config.encoding),
            options,
          );
          break;
        case SUPPORTED_FORMATS.JSON:
          result = this._parseJSON(buffer.toString(this.config.encoding));
          break;
        case SUPPORTED_FORMATS.MD:
        case SUPPORTED_FORMATS.TXT:
        default:
          result = this._parseText(
            buffer.toString(this.config.encoding),
            options,
          );
          break;
      }

      result.format = format;
      result.filePath = filePath;
      result.parsedAt = new Date().toISOString();

      // Stats
      const elapsed = Date.now() - startTime;
      this._parseTimes.push(elapsed);
      if (this._parseTimes.length > 100) {
        this._parseTimes.shift();
      }
      this.stats.successCount++;
      this.stats.formatDistribution[format] =
        (this.stats.formatDistribution[format] || 0) + 1;
      this.stats.averageParseTimeMs = Math.round(
        this._parseTimes.reduce((a, b) => a + b, 0) / this._parseTimes.length,
      );

      this.emit("document:parsed", {
        format,
        pages: result.pages,
        textLength: result.text?.length || 0,
        elapsed,
      });

      logger.info(
        `[DocumentParser] Parsed ${format} (${result.text?.length || 0} chars, ${elapsed}ms)`,
      );

      return result;
    } catch (error) {
      this.stats.failureCount++;
      logger.error(`[DocumentParser] Parse error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get supported format list
   */
  getSupportedFormats() {
    return Object.values(SUPPORTED_FORMATS);
  }

  /**
   * Get stats
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Get config
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Format-specific Parsers
  // ============================================================

  async _parsePDF(buffer, options = {}) {
    try {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer, {
        max: options.maxPages || this.config.maxPages,
      });

      const result = {
        text: data.text || "",
        pages: data.numpages || 0,
        info: data.info || {},
        tables: [],
        images: [],
      };

      // Simple table detection from text (heuristic)
      if (options.extractTables !== false && this.config.extractTables) {
        result.tables = this._extractTablesFromText(data.text);
      }

      return result;
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        return {
          text: "[pdf-parse 未安装 — 请运行 npm install pdf-parse]",
          pages: 0,
          tables: [],
          images: [],
          error: "module-not-found",
        };
      }
      throw error;
    }
  }

  async _parseDOCX(buffer, options = {}) {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const htmlResult = await mammoth.convertToHtml({ buffer });

      const parsed = {
        text: result.value || "",
        html: htmlResult.value || "",
        pages: this._estimatePages(result.value),
        tables: [],
        images: [],
        messages: result.messages || [],
      };

      // Extract tables from HTML
      if (options.extractTables !== false && this.config.extractTables) {
        parsed.tables = this._extractTablesFromHTML(htmlResult.value);
      }

      return parsed;
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        return {
          text: "[mammoth 未安装 — 请运行 npm install mammoth]",
          pages: 0,
          tables: [],
          images: [],
          error: "module-not-found",
        };
      }
      throw error;
    }
  }

  async _parseXLSX(buffer, options = {}) {
    try {
      const XLSX = require("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });

      const sheets = [];
      let fullText = "";

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const csvText = XLSX.utils.sheet_to_csv(sheet);

        sheets.push({
          name: sheetName,
          rows: jsonData.length,
          columns: jsonData[0]?.length || 0,
          data: jsonData,
          csv: csvText,
        });

        fullText += `=== Sheet: ${sheetName} ===\n${csvText}\n\n`;
      }

      return {
        text: fullText.trim(),
        pages: sheets.length,
        sheets,
        tables: sheets.map((s) => ({
          name: s.name,
          headers: s.data[0] || [],
          rows: s.data.slice(1),
          rowCount: s.rows - 1,
        })),
        images: [],
      };
    } catch (error) {
      if (error.code === "MODULE_NOT_FOUND") {
        return {
          text: "[xlsx 未安装 — 请运行 npm install xlsx]",
          pages: 0,
          sheets: [],
          tables: [],
          images: [],
          error: "module-not-found",
        };
      }
      throw error;
    }
  }

  _parseCSV(text, options = {}) {
    const delimiter = options.delimiter || this.config.csvDelimiter;
    const lines = text.split("\n").filter((l) => l.trim());
    const rows = lines.map((line) =>
      line.split(delimiter).map((cell) => cell.trim()),
    );

    const headers = rows[0] || [];
    const data = rows.slice(1);

    return {
      text,
      pages: 1,
      tables: [
        {
          headers,
          rows: data,
          rowCount: data.length,
        },
      ],
      images: [],
    };
  }

  _parseJSON(text) {
    try {
      const data = JSON.parse(text);
      const formatted = JSON.stringify(data, null, 2);
      return {
        text: formatted,
        pages: 1,
        data,
        tables: [],
        images: [],
      };
    } catch {
      return {
        text,
        pages: 1,
        tables: [],
        images: [],
        error: "invalid-json",
      };
    }
  }

  _parseText(text, options = {}) {
    return {
      text: typeof text === "string" ? text : String(text),
      pages: this._estimatePages(text),
      tables: [],
      images: [],
    };
  }

  // ============================================================
  // Table Extraction Helpers
  // ============================================================

  _extractTablesFromText(text) {
    if (!text) {
      return [];
    }
    const tables = [];

    // Detect Markdown-style tables
    const lines = text.split("\n");
    let tableStart = -1;
    let currentTable = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes("|") && line.split("|").length >= 3) {
        if (tableStart === -1) {
          tableStart = i;
        }
        // Skip separator lines
        if (!/^[\s|:-]+$/.test(line)) {
          currentTable.push(
            line
              .split("|")
              .map((c) => c.trim())
              .filter(Boolean),
          );
        }
      } else if (tableStart !== -1 && currentTable.length > 0) {
        tables.push({
          headers: currentTable[0] || [],
          rows: currentTable.slice(1),
          rowCount: currentTable.length - 1,
        });
        currentTable = [];
        tableStart = -1;
      }
    }

    // Flush remaining table
    if (currentTable.length > 0) {
      tables.push({
        headers: currentTable[0] || [],
        rows: currentTable.slice(1),
        rowCount: currentTable.length - 1,
      });
    }

    return tables;
  }

  _extractTablesFromHTML(html) {
    if (!html) {
      return [];
    }
    const tables = [];

    // Simple regex-based table extraction from HTML
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHtml = tableMatch[1];
      const rows = [];

      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;

      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        const cells = [];
        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
        }
        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        tables.push({
          headers: rows[0] || [],
          rows: rows.slice(1),
          rowCount: rows.length - 1,
        });
      }
    }

    return tables;
  }

  // ============================================================
  // Utility
  // ============================================================

  _estimatePages(text) {
    if (!text) {
      return 0;
    }
    // ~3000 chars per page estimate
    return Math.max(1, Math.ceil(text.length / 3000));
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getDocumentParser() {
  if (!instance) {
    instance = new DocumentParser();
  }
  return instance;
}

module.exports = {
  DocumentParser,
  getDocumentParser,
  SUPPORTED_FORMATS,
};
