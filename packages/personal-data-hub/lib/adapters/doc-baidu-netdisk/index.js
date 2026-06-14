/**
 * §13+ — 百度网盘 (Baidu Netdisk, com.baidu.netdisk) adapter. §12.1 ROI ⭐⭐⭐
 * "文件 + 外链".
 *
 * Thin wrapper over _document-base — a cloud-drive file list is the same shape
 * as the doc-wps / doc-tencent-docs "own-document list". Baidu Netdisk exposes
 * the owner's files via pan.baidu.com/api/list (BDUSS cookie); this adapter
 * supplies the endpoint + field mapping, the base handles snapshot + cookie-api
 * orchestration + normalize (event POST + item DOCUMENT). Endpoint best-effort +
 * overridable via opts.listUrl (not field-verified — FAMILY-23 playbook).
 */

"use strict";

const { createDocumentAdapter, parseTime, SNAPSHOT_SCHEMA_VERSION } = require("../_document-base");

const NAME = "doc-baidu-netdisk";
const VERSION = "0.1.0";

// Best-effort Baidu Netdisk file-list endpoint. Overridable via opts.listUrl.
const NETDISK_LIST_URL = "https://pan.baidu.com/api/list";

// Baidu Netdisk `category` codes → normalized docType.
const CATEGORY_MAP = {
  1: "video",
  2: "audio",
  3: "image",
  4: "doc",
  5: "app",
  6: "other",
  7: "seed",
};

function mapNetdiskType(d) {
  if (d.isdir === 1 || d.isdir === true) return "folder";
  const cat = d.category != null ? d.category : d.file_category;
  if (cat != null && CATEGORY_MAP[cat]) return CATEGORY_MAP[cat];
  const name = String(d.server_filename || d.filename || "").toLowerCase();
  if (/\.(mp4|mkv|avi|mov)$/.test(name)) return "video";
  if (/\.(mp3|flac|wav|m4a)$/.test(name)) return "audio";
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(name)) return "image";
  if (/\.(docx?|xlsx?|pptx?|pdf|txt)$/.test(name)) return "doc";
  return "file";
}

function extractDocs(resp) {
  if (!resp || typeof resp !== "object") return [];
  if (Array.isArray(resp.list)) return resp.list;
  if (Array.isArray(resp.data)) return resp.data;
  if (resp.data && Array.isArray(resp.data.list)) return resp.data.list;
  return [];
}

function mapDoc(d) {
  if (!d || typeof d !== "object") return null;
  const docId = d.fs_id || d.fsId || d.id || d.path;
  if (!docId) return null;
  return {
    docId: String(docId),
    title: d.server_filename || d.filename || d.title || "(未命名)",
    docType: mapNetdiskType(d),
    url: d.path || d.dlink || null,
    createdMs: parseTime(d.server_ctime || d.local_ctime || d.ctime),
    updatedMs: parseTime(d.server_mtime || d.local_mtime || d.mtime),
    extra: {
      size: d.size != null ? d.size : null,
      isDir: d.isdir === 1 || d.isdir === true ? true : false,
      path: d.path || null,
      category: d.category != null ? d.category : null,
    },
  };
}

const BaiduNetdiskAdapter = createDocumentAdapter({
  NAME,
  VERSION,
  platform: "baidu-netdisk",
  defaultListUrl: NETDISK_LIST_URL,
  extractDocs,
  mapDoc,
});

module.exports = {
  BaiduNetdiskAdapter,
  extractDocs,
  mapDoc,
  CATEGORY_MAP,
  NAME,
  VERSION,
  SNAPSHOT_SCHEMA_VERSION,
};
