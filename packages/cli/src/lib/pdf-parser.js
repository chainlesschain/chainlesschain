/**
 * Lightweight PDF text extractor.
 * Uses a simple built-in parser for basic PDF text extraction.
 * Falls back gracefully if text cannot be extracted.
 */

import { readFileSync } from "fs";
import { basename, extname } from "path";

/**
 * Extract text content from a PDF file.
 * Uses a basic approach: scan PDF stream for text operators.
 * This handles simple PDFs without requiring heavy external dependencies.
 *
 * @param {string} filePath - Path to the PDF file
 * @returns {{ title: string, content: string, pages: number|null }}
 */
export async function parsePdfText(filePath) {
  const buffer = readFileSync(filePath);
  const title = basename(filePath, extname(filePath));

  // Try to extract text from PDF binary
  const text = extractTextFromPdf(buffer);

  // Count pages by looking for /Type /Page objects
  const pdfStr = buffer.toString("latin1");
  const pageMatches = pdfStr.match(/\/Type\s*\/Page[^s]/g);
  const pages = pageMatches ? pageMatches.length : null;

  return {
    title,
    content: text,
    pages,
  };
}

/**
 * Basic PDF text extraction.
 * Scans for text between BT/ET operators and decodes common encodings.
 */
function extractTextFromPdf(buffer) {
  const pdfStr = buffer.toString("latin1");
  const textParts = [];

  // Find all stream sections and decode them
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = streamRegex.exec(pdfStr)) !== null) {
    const streamContent = match[1];

    // Look for text showing operators: Tj, TJ, ', "
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
      const decoded = decodePdfString(tjMatch[1]);
      if (decoded.trim()) textParts.push(decoded);
    }

    // TJ operator: array of strings and numbers
    const tjArrayRegex = /\[((?:\([^)]*\)|[^[\]])*)\]\s*TJ/gi;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(streamContent)) !== null) {
      const inner = tjArrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      const parts = [];
      while ((strMatch = strRegex.exec(inner)) !== null) {
        parts.push(decodePdfString(strMatch[1]));
      }
      if (parts.length > 0) textParts.push(parts.join(""));
    }
  }

  // Clean up and join
  const text = textParts
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * Decode a PDF string (handle basic escape sequences).
 */
function decodePdfString(str) {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}
