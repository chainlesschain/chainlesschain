/**
 * Storage command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers three related areas:
 *  - Cookies (chrome.cookies): getAll/get/set/remove/clear
 *  - Web storage (page context via executeScript): local/session get/set/clear,
 *    plus the Phase 18 "Storage Inspector" quota/usage/export/import helpers
 *  - Browsing data (chrome.browsingData): clear
 *
 * Extracted verbatim from background.js (Phase 1 of the split). Self-contained:
 * chrome.cookies / chrome.browsingData / chrome.scripting only, no shared-layer
 * dependency. IndexedDB and Cache Storage are intentionally NOT here — they live
 * in their own modules (DB/CDP-heavy).
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, localStorage, sessionStorage, navigator, document, window, Blob */

// ---------- Cookies (chrome.cookies) ----------

export async function getAllCookies(params) {
  const details = {};
  if (params.url) {
    details.url = params.url;
  }
  if (params.domain) {
    details.domain = params.domain;
  }
  if (params.name) {
    details.name = params.name;
  }
  const cookies = await chrome.cookies.getAll(details);
  return { cookies };
}

export async function getCookie(params) {
  const cookie = await chrome.cookies.get({
    url: params.url,
    name: params.name,
  });
  return { cookie };
}

export async function setCookie(params) {
  const cookie = await chrome.cookies.set({
    url: params.url,
    name: params.name,
    value: params.value,
    domain: params.domain,
    path: params.path || "/",
    secure: params.secure,
    httpOnly: params.httpOnly,
    sameSite: params.sameSite,
    expirationDate: params.expirationDate,
  });
  return { cookie };
}

export async function removeCookie(params) {
  const details = await chrome.cookies.remove({
    url: params.url,
    name: params.name,
  });
  return { success: !!details };
}

export async function clearCookies(params) {
  const cookies = await chrome.cookies.getAll(
    params.domain ? { domain: params.domain } : {},
  );
  let removed = 0;
  for (const cookie of cookies) {
    const protocol = cookie.secure ? "https:" : "http:";
    const url = `${protocol}//${cookie.domain}${cookie.path}`;
    await chrome.cookies.remove({ url, name: cookie.name });
    removed++;
  }
  return { success: true, removed };
}

// ---------- Web storage (page context) ----------

export async function getLocalStorage(tabId, keys) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (keyList) => {
      if (!keyList || keyList.length === 0) {
        // Return all localStorage
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data[key] = localStorage.getItem(key);
        }
        return data;
      }
      const data = {};
      for (const key of keyList) {
        data[key] = localStorage.getItem(key);
      }
      return data;
    },
    args: [keys],
  });
  return { data: results[0]?.result };
}

export async function setLocalStorage(tabId, data) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageData) => {
      for (const [key, value] of Object.entries(storageData)) {
        localStorage.setItem(key, value);
      }
    },
    args: [data],
  });
  return { success: true };
}

export async function getSessionStorage(tabId, keys) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (keyList) => {
      if (!keyList || keyList.length === 0) {
        const data = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          data[key] = sessionStorage.getItem(key);
        }
        return data;
      }
      const data = {};
      for (const key of keyList) {
        data[key] = sessionStorage.getItem(key);
      }
      return data;
    },
    args: [keys],
  });
  return { data: results[0]?.result };
}

export async function setSessionStorage(tabId, data) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageData) => {
      for (const [key, value] of Object.entries(storageData)) {
        sessionStorage.setItem(key, value);
      }
    },
    args: [data],
  });
  return { success: true };
}

export async function clearLocalStorage(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      localStorage.clear();
    },
  });
  return { success: true };
}

export async function clearSessionStorage(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      sessionStorage.clear();
    },
  });
  return { success: true };
}

// ---------- Storage Inspector (Phase 18, page context) ----------

export async function getStorageQuota(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (navigator.storage && navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          return {
            quota: estimate.quota,
            usage: estimate.usage,
            usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(2),
            quotaFormatted: `${(estimate.quota / 1024 / 1024 / 1024).toFixed(2)} GB`,
            usageFormatted: `${(estimate.usage / 1024 / 1024).toFixed(2)} MB`,
          };
        }
        return { error: "Storage API not available" };
      },
    });
    return result[0]?.result || { error: "Failed to get quota" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getStorageUsage(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const usage = {
          localStorage: {
            items: localStorage.length,
            size: new Blob(Object.values(localStorage)).size,
          },
          sessionStorage: {
            items: sessionStorage.length,
            size: new Blob(Object.values(sessionStorage)).size,
          },
        };

        // Estimate cookie size
        usage.cookies = {
          size: document.cookie.length,
        };

        return usage;
      },
    });
    return result[0]?.result || { error: "Failed to get usage" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function exportAllStorage(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const data = {
          localStorage: {},
          sessionStorage: {},
          exportedAt: Date.now(),
          origin: window.location.origin,
        };

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data.localStorage[key] = localStorage.getItem(key);
        }

        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          data.sessionStorage[key] = sessionStorage.getItem(key);
        }

        return data;
      },
    });
    return result[0]?.result || { error: "Failed to export" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function importAllStorage(tabId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (importData) => {
        let imported = { localStorage: 0, sessionStorage: 0 };

        if (importData.localStorage) {
          Object.entries(importData.localStorage).forEach(([key, value]) => {
            localStorage.setItem(key, value);
            imported.localStorage++;
          });
        }

        if (importData.sessionStorage) {
          Object.entries(importData.sessionStorage).forEach(([key, value]) => {
            sessionStorage.setItem(key, value);
            imported.sessionStorage++;
          });
        }

        return { success: true, imported };
      },
      args: [data],
    });
    return result[0]?.result || { error: "Failed to import" };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Browsing data (chrome.browsingData) ----------

export async function clearBrowsingData(params) {
  const dataToRemove = {};
  const options = {
    since: params.since || 0,
  };

  if (params.cache) {
    dataToRemove.cache = true;
  }
  if (params.cookies) {
    dataToRemove.cookies = true;
  }
  if (params.history) {
    dataToRemove.history = true;
  }
  if (params.localStorage) {
    dataToRemove.localStorage = true;
  }
  if (params.passwords) {
    dataToRemove.passwords = true;
  }
  if (params.formData) {
    dataToRemove.formData = true;
  }
  if (params.downloads) {
    dataToRemove.downloads = true;
  }

  if (Object.keys(dataToRemove).length === 0) {
    return { error: "No data types specified" };
  }

  await chrome.browsingData.remove(options, dataToRemove);
  return { success: true, cleared: Object.keys(dataToRemove) };
}

export const storageHandlers = {
  "cookies.getAll": (params) => getAllCookies(params),
  "cookies.get": (params) => getCookie(params),
  "cookies.set": (params) => setCookie(params),
  "cookies.remove": (params) => removeCookie(params),
  "cookies.clear": (params) => clearCookies(params),
  "storage.getLocal": ({ tabId, keys }) => getLocalStorage(tabId, keys),
  "storage.setLocal": ({ tabId, data }) => setLocalStorage(tabId, data),
  "storage.getSession": ({ tabId, keys }) => getSessionStorage(tabId, keys),
  "storage.setSession": ({ tabId, data }) => setSessionStorage(tabId, data),
  "storage.clearLocal": ({ tabId }) => clearLocalStorage(tabId),
  "storage.clearSession": ({ tabId }) => clearSessionStorage(tabId),
  "storage.getQuota": ({ tabId }) => getStorageQuota(tabId),
  "storage.getUsage": ({ tabId }) => getStorageUsage(tabId),
  "storage.exportAll": ({ tabId }) => exportAllStorage(tabId),
  "storage.importAll": ({ tabId, data }) => importAllStorage(tabId, data),
  "browsingData.clear": (params) => clearBrowsingData(params),
};
