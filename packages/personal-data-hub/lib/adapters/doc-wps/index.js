/**
 * §13+ — WPS 云文档 (Kingsoft Office) adapter. "自创文档列表" (§12.1, ROI ⭐⭐⭐).
 *
 * Thin wrapper over _document-base. WPS exposes the owner's cloud documents via
 * drive.wps.cn; this adapter supplies the endpoint + field mapping, the base
 * handles snapshot + cookie-api orchestration + normalize (event POST + item
 * DOCUMENT). Endpoint is best-effort + overridable via opts.listUrl (WPS rotates
 * its drive API — FAMILY-23 playbook, not field-verified).
 */

"use strict";

const { createDocumentAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_document-base");

const NAME = "doc-wps";
const VERSION = "0.1.0";

// Best-effort WPS cloud-drive file list. Overridable via opts.listUrl.
const WPS_LIST_URL = "https://drive.wps.cn/api/v5/groups/special/files";

// WPS doc-type codes/names → normalized docType.
function mapWpsType(d) {
  const t = String(d.fname || d.name || "").toLowerCase();
  if (d.ftype && typeof d.ftype === "string") return d.ftype;
  if (/\.(xlsx?|et|csv)$/.test(t)) return "sheet";
  if (/\.(pptx?|dps)$/.test(t)) return "slide";
  if (/\.pdf$/.test(t)) return "pdf";
  if (/\.(docx?|wps)$/.test(t)) return "doc";
  return "doc";
}

function extractDocs(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.files)) return resp.files;
  if (Array.isArray(resp.data)) return resp.data;
  if (resp.data && Array.isArray(resp.data.files)) return resp.data.files;
  if (Array.isArray(resp.list)) return resp.list;
  return [];
}

function mapDoc(d) {
  if (!d || typeof d !== "object") return null;
  const docId = d.id || d.fileid || d.file_id || d.fid;
  if (!docId) return null;
  return {
    docId: String(docId),
    title: d.fname || d.name || d.title || "(无标题)",
    docType: mapWpsType(d),
    url:
      d.url ||
      (d.id ? `https://www.kdocs.cn/p/${d.id}` : null),
    createdMs: parseTime(d.ctime || d.create_time || d.created),
    updatedMs: parseTime(d.mtime || d.modify_time || d.updated || d.utime),
    extra: {
      size: d.fsize || d.size || null,
      groupId: d.group_id || d.groupid || null,
    },
  };
}

const WpsDocAdapter = createDocumentAdapter({
  NAME,
  VERSION,
  platform: "wps",
  defaultListUrl: WPS_LIST_URL,
  extractDocs,
  mapDoc,
});

module.exports = {
  WpsDocAdapter,
  extractDocs,
  mapDoc,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
