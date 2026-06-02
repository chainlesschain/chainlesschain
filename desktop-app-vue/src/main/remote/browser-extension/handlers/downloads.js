/**
 * Download command handlers for the ChainlessChain Browser Bridge.
 *
 * Thin wrappers over the chrome.downloads API: list/search, start, and the
 * per-download lifecycle controls (cancel/pause/resume/open/show/erase).
 *
 * Extracted verbatim from background.js (Phase 1 of the split). Self-contained:
 * pure chrome.downloads, no shared-layer dependency.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome */

export async function listDownloads(params = {}) {
  const query = {};
  if (params.query) {
    query.query = [params.query];
  }
  if (params.limit) {
    query.limit = params.limit;
  }
  if (params.orderBy) {
    query.orderBy = [params.orderBy];
  }
  if (params.state) {
    query.state = params.state;
  }
  const downloads = await chrome.downloads.search(query);
  return {
    downloads: downloads.map((d) => ({
      id: d.id,
      url: d.url,
      filename: d.filename,
      state: d.state,
      bytesReceived: d.bytesReceived,
      totalBytes: d.totalBytes,
      startTime: d.startTime,
      endTime: d.endTime,
      error: d.error,
      mime: d.mime,
    })),
  };
}

export async function startDownload(params) {
  const options = {
    url: params.url,
  };
  if (params.filename) {
    options.filename = params.filename;
  }
  if (params.saveAs !== undefined) {
    options.saveAs = params.saveAs;
  }
  if (params.conflictAction) {
    options.conflictAction = params.conflictAction;
  }
  const downloadId = await chrome.downloads.download(options);
  return { downloadId };
}

export async function cancelDownload(downloadId) {
  await chrome.downloads.cancel(downloadId);
  return { success: true };
}

export async function pauseDownload(downloadId) {
  await chrome.downloads.pause(downloadId);
  return { success: true };
}

export async function resumeDownload(downloadId) {
  await chrome.downloads.resume(downloadId);
  return { success: true };
}

export async function openDownload(downloadId) {
  await chrome.downloads.open(downloadId);
  return { success: true };
}

export async function showDownloadInFolder(downloadId) {
  await chrome.downloads.show(downloadId);
  return { success: true };
}

export async function eraseDownloads(params = {}) {
  const query = {};
  if (params.state) {
    query.state = params.state;
  }
  if (params.startedBefore) {
    query.startedBefore = params.startedBefore;
  }
  const erased = await chrome.downloads.erase(query);
  return { erased: erased.length };
}

export const downloadsHandlers = {
  "downloads.list": (params) => listDownloads(params),
  "downloads.download": (params) => startDownload(params),
  "downloads.cancel": ({ downloadId }) => cancelDownload(downloadId),
  "downloads.pause": ({ downloadId }) => pauseDownload(downloadId),
  "downloads.resume": ({ downloadId }) => resumeDownload(downloadId),
  "downloads.open": ({ downloadId }) => openDownload(downloadId),
  "downloads.show": ({ downloadId }) => showDownloadInFolder(downloadId),
  "downloads.erase": (params) => eraseDownloads(params),
};
