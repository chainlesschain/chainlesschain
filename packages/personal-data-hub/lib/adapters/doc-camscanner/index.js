/**
 * §13+ — 扫描全能王 (CamScanner, com.intsig.camscanner) adapter. §12.1 ROI ⭐⭐
 * "扫描文档归档".
 *
 * Thin wrapper over _document-base — CamScanner's scanned-document archive is
 * the same shape as the doc-wps / doc-tencent-docs / doc-baidu-netdisk
 * "own-document list": each scanned doc has a title, page count, create/modify
 * time, and a PDF/jump url. CamScanner syncs the owner's docs to its cloud
 * (intsig sync API, session cookie / sync token); this adapter supplies the
 * endpoint + field mapping, the base handles snapshot + cookie-api orchestration
 * + normalize (event POST + item DOCUMENT). Endpoint best-effort + overridable
 * via opts.listUrl (not field-verified — FAMILY-23 playbook). A signProvider
 * seam covers intsig's request signature; best-effort unsigned when absent.
 */

"use strict";

const { createDocumentAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_document-base");

const NAME = "doc-camscanner";
const VERSION = "0.1.0";

// Best-effort CamScanner cloud doc-list endpoint. Overridable via opts.listUrl.
const CAMSCANNER_LIST_URL = "https://sync.intsig.net/sync/list_docs";

// CamScanner document type hints → normalized docType. A CamScanner "doc" is a
// scanned bundle of pages exportable as PDF; certificate/book/excel are OCR
// sub-modes the app offers.
const TYPE_MAP = {
  0: "scan",
  1: "scan",
  2: "certificate",
  3: "book",
  4: "excel",
  5: "ppt",
  pdf: "pdf",
  doc: "scan",
  certificate: "certificate",
  book: "book",
  excel: "excel",
  ppt: "ppt",
};

function mapCamScannerType(d) {
  const t = d.doc_type != null ? d.doc_type : d.type;
  if (t != null && TYPE_MAP[t] != null) return TYPE_MAP[t];
  const title = String(d.title || d.doc_title || d.pdf_name || "").toLowerCase();
  if (/\.pdf$/.test(title)) return "pdf";
  if (/\.(xlsx?|csv)$/.test(title)) return "excel";
  if (/\.(pptx?)$/.test(title)) return "ppt";
  return "scan";
}

function extractDocs(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.docs)) return resp.docs;
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  if (resp.data && Array.isArray(resp.data.docs)) return resp.data.docs;
  if (resp.data && Array.isArray(resp.data.list)) return resp.data.list;
  return [];
}

function mapDoc(d) {
  if (!d || typeof d !== "object") return null;
  const docId = d.sync_doc_id || d.doc_id || d.docId || d.id || d.sid;
  if (!docId) return null;
  const pages = d.page_num != null ? d.page_num : d.pages != null ? d.pages : d.page_count;
  return {
    docId: String(docId),
    title: d.title || d.doc_title || d.pdf_name || "(未命名扫描件)",
    docType: mapCamScannerType(d),
    url: d.pdf_url || d.url || d.jump_url || null,
    createdMs: parseTime(d.create_time || d.upload_time || d.ctime || d.created),
    updatedMs: parseTime(d.modify_time || d.last_modify_time || d.update_time || d.mtime),
    extra: {
      pageNum: Number.isFinite(Number(pages)) ? Number(pages) : null,
      tags: Array.isArray(d.tags) ? d.tags : d.tag != null ? [d.tag] : [],
      folder: d.dir_title || d.folder || null,
    },
  };
}

const CamScannerDocAdapter = createDocumentAdapter({
  NAME,
  VERSION,
  platform: "camscanner",
  defaultListUrl: CAMSCANNER_LIST_URL,
  extractDocs,
  mapDoc,
});

module.exports = {
  CamScannerDocAdapter,
  extractDocs,
  mapDoc,
  mapCamScannerType,
  TYPE_MAP,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
