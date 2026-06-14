/**
 * §13+ — 腾讯文档 (Tencent Docs) adapter. "自创文档列表" (§12.1, ROI ⭐⭐⭐).
 *
 * Thin wrapper over _document-base. 腾讯文档 exposes the owner's documents via
 * docs.qq.com dop-api; this adapter supplies the endpoint + field mapping, the
 * base handles snapshot + cookie-api orchestration + normalize. Endpoint is
 * best-effort + overridable via opts.listUrl (docs.qq.com rotates its dop-api;
 * some calls need a sign — opts.signProvider seam — FAMILY-23 playbook, not
 * field-verified).
 */

"use strict";

const { createDocumentAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_document-base");

const NAME = "doc-tencent-docs";
const VERSION = "0.1.0";

// Best-effort Tencent Docs "my documents" list. Overridable via opts.listUrl.
const TENCENT_DOCS_LIST_URL = "https://docs.qq.com/dop-api/get/personal/files";

// Tencent Docs type codes → normalized docType.
const TYPE_MAP = {
  doc: "doc",
  document: "doc",
  sheet: "sheet",
  spreadsheet: "sheet",
  slide: "slide",
  presentation: "slide",
  pdf: "pdf",
  form: "form",
  mind: "mind",
  1: "doc",
  2: "sheet",
  3: "slide",
};

function mapTencentType(d) {
  const raw = d.type != null ? d.type : d.docType != null ? d.docType : d.fileType;
  const key = String(raw == null ? "" : raw).toLowerCase();
  return TYPE_MAP[key] || TYPE_MAP[raw] || "doc";
}

function extractDocs(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.files)) return resp.files;
  if (Array.isArray(resp.list)) return resp.list;
  const data = resp.data && typeof resp.data === "object" ? resp.data : null;
  if (data) {
    if (Array.isArray(data.files)) return data.files;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.records)) return data.records;
  }
  return [];
}

function mapDoc(d) {
  if (!d || typeof d !== "object") return null;
  const docId = d.id || d.fileId || d.file_id || d.docId || d.url;
  if (!docId) return null;
  return {
    docId: String(docId),
    title: d.title || d.name || d.fileName || "(无标题)",
    docType: mapTencentType(d),
    url:
      d.url ||
      (d.id ? `https://docs.qq.com/doc/${d.id}` : null),
    createdMs: parseTime(d.createTime || d.create_time || d.gmtCreate),
    updatedMs: parseTime(d.lastModifyTime || d.modifyTime || d.updateTime || d.gmtModify),
    extra: {
      ownerName: d.ownerName || d.creatorName || null,
      starred: d.isStar != null ? d.isStar : undefined,
    },
  };
}

const TencentDocsAdapter = createDocumentAdapter({
  NAME,
  VERSION,
  platform: "tencent-docs",
  defaultListUrl: TENCENT_DOCS_LIST_URL,
  extractDocs,
  mapDoc,
});

module.exports = {
  TencentDocsAdapter,
  extractDocs,
  mapDoc,
  TYPE_MAP,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
