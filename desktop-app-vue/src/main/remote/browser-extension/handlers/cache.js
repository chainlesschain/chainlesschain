/**
 * Cache Storage command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the Phase 17 Cache Storage (`caches.*`) operations: list caches, list
 * entries, get/delete a single entry, delete a whole cache, add an entry.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * the Cache Storage API in page context via chrome.scripting.executeScript — no
 * CDP, no shared-layer dependency.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, caches, Response */

export async function listCaches(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const cacheNames = await caches.keys();
        const cacheInfo = await Promise.all(
          cacheNames.map(async (name) => {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            return { name, entryCount: keys.length };
          }),
        );
        return { caches: cacheInfo };
      },
    });
    return result[0]?.result || { caches: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function listCacheEntries(tabId, cacheName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        return {
          entries: requests.map((req) => ({
            url: req.url,
            method: req.method,
            headers: Object.fromEntries(req.headers.entries()),
          })),
        };
      },
      args: [cacheName],
    });
    return result[0]?.result || { entries: [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getCacheEntry(tabId, cacheName, url) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name, reqUrl) => {
        const cache = await caches.open(name);
        const response = await cache.match(reqUrl);
        if (!response) return { error: "Entry not found" };
        const text = await response.text();
        return {
          url: reqUrl,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: text.substring(0, 10000), // Limit body size
          bodyTruncated: text.length > 10000,
        };
      },
      args: [cacheName, url],
    });
    return result[0]?.result || { error: "Failed to get entry" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function deleteCacheEntry(tabId, cacheName, url) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name, reqUrl) => {
        const cache = await caches.open(name);
        const deleted = await cache.delete(reqUrl);
        return { success: deleted };
      },
      args: [cacheName, url],
    });
    return result[0]?.result || { success: false };
  } catch (error) {
    return { error: error.message };
  }
}

export async function deleteCache(tabId, cacheName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name) => {
        const deleted = await caches.delete(name);
        return { success: deleted };
      },
      args: [cacheName],
    });
    return result[0]?.result || { success: false };
  } catch (error) {
    return { error: error.message };
  }
}

export async function addCacheEntry(tabId, cacheName, url, responseData) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name, reqUrl, respData) => {
        const cache = await caches.open(name);
        const response = new Response(respData.body, {
          status: respData.status || 200,
          headers: respData.headers || {},
        });
        await cache.put(reqUrl, response);
        return { success: true };
      },
      args: [cacheName, url, responseData],
    });
    return result[0]?.result || { success: false };
  } catch (error) {
    return { error: error.message };
  }
}

export const cacheHandlers = {
  "cache.listCaches": ({ tabId }) => listCaches(tabId),
  "cache.listEntries": ({ tabId, cacheName }) =>
    listCacheEntries(tabId, cacheName),
  "cache.getEntry": ({ tabId, cacheName, url }) =>
    getCacheEntry(tabId, cacheName, url),
  "cache.deleteEntry": ({ tabId, cacheName, url }) =>
    deleteCacheEntry(tabId, cacheName, url),
  "cache.deleteCache": ({ tabId, cacheName }) => deleteCache(tabId, cacheName),
  "cache.addEntry": ({ tabId, cacheName, url, response }) =>
    addCacheEntry(tabId, cacheName, url, response),
};
