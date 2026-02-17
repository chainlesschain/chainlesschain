---
name: pdf-toolkit
display-name: PDF Toolkit
description: PDF processing - extract text, merge, split, OCR, info, watermark
version: 1.0.0
category: document
user-invocable: true
tags: [pdf, document, ocr, merge, split, extract]
capabilities: [pdf-extract, pdf-merge, pdf-split, pdf-ocr, pdf-info]
supported-file-types: [pdf]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
  - file_write
instructions: |
  Use this skill for PDF file operations: extract text, merge multiple PDFs,
  split by pages, OCR scanned documents, get file info, and add watermarks.
examples:
  - input: "/pdf-toolkit --extract report.pdf"
    output: "Extracted text content from PDF with metadata"
  - input: "/pdf-toolkit --info document.pdf"
    output: "PDF metadata: pages, title, author, dates"
  - input: "/pdf-toolkit --merge file1.pdf file2.pdf --output combined.pdf"
    output: "Merged 2 PDF files into combined.pdf"
author: ChainlessChain
---

# PDF Toolkit

Comprehensive PDF processing toolkit for text extraction, merging, splitting, OCR, and metadata.

## Usage

```
/pdf-toolkit --extract <file>                    Extract text from PDF
/pdf-toolkit --info <file>                       Show PDF metadata
/pdf-toolkit --merge <file1> <file2> [--output]  Merge multiple PDFs
/pdf-toolkit --split <file> --pages 1-3          Split PDF by page range
/pdf-toolkit --ocr <file>                        OCR scanned PDF pages
/pdf-toolkit --watermark <file> --text "Draft"   Add text watermark
```

## Features

- **Text Extraction**: Full text content with page-level separation
- **Metadata**: Title, author, creator, page count, creation date, file size
- **Merge**: Combine multiple PDF files into one
- **Split**: Extract specific page ranges
- **OCR**: Optical character recognition for scanned documents (Tesseract.js)
- **Watermark**: Add text watermarks to pages

## Dependencies

- `pdf-parse` — PDF text extraction and metadata
- `tesseract.js` — OCR engine (optional, for scanned PDFs)
