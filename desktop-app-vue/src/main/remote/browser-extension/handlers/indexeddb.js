/**
 * IndexedDB command handlers for the ChainlessChain Browser Bridge.
 *
 * Two historical namespaces are unified here:
 *  - `indexedDB.*` (basic): getDatabases/getData/setData/deleteData/clearStore
 *  - `indexeddb.*` (Phase 22 "Advanced"): listDatabases/getDatabaseInfo/
 *    getObjectStores/getStoreData/getStoreIndexes/queryByIndex/countRecords/
 *    deleteDatabase/clearStore/exportDatabase
 *
 * Extracted verbatim from background.js (Phase 1 of the split). All handlers run
 * the IndexedDB API in page context via chrome.scripting.executeScript — no CDP,
 * no shared-layer dependency.
 *
 * NOTE: background.js defined `clearIndexedDBStore` TWICE (basic + advanced
 * sections) with the same signature; JS function hoisting meant the later
 * (advanced) definition was the one that actually ran for BOTH `indexedDB.clearStore`
 * and `indexeddb.clearStore`. This module keeps that single effective definition
 * and maps both command keys to it, eliminating the silent shadowing.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, indexedDB, IDBKeyRange */

// ---------- Basic (indexedDB.*) ----------

export async function getIndexedDBDatabases(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        const databases = await indexedDB.databases();
        return {
          databases: databases.map((db) => ({
            name: db.name,
            version: db.version,
          })),
        };
      } catch (error) {
        return { error: error.message };
      }
    },
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function getIndexedDBData(tabId, dbName, storeName, query = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (db, store, q) => {
      return new Promise((resolve) => {
        const request = indexedDB.open(db);

        request.onerror = () => resolve({ error: request.error?.message });

        request.onsuccess = () => {
          const database = request.result;
          try {
            const tx = database.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);

            let dataRequest;
            if (q.key) {
              dataRequest = objectStore.get(q.key);
            } else if (q.range) {
              const range = IDBKeyRange.bound(q.range.lower, q.range.upper);
              dataRequest = objectStore.getAll(range, q.limit || 100);
            } else {
              dataRequest = objectStore.getAll(null, q.limit || 100);
            }

            dataRequest.onsuccess = () => {
              database.close();
              resolve({ data: dataRequest.result });
            };

            dataRequest.onerror = () => {
              database.close();
              resolve({ error: dataRequest.error?.message });
            };
          } catch (error) {
            database.close();
            resolve({ error: error.message });
          }
        };
      });
    },
    args: [dbName, storeName, query],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function setIndexedDBData(tabId, dbName, storeName, key, value) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (db, store, k, v) => {
      return new Promise((resolve) => {
        const request = indexedDB.open(db);

        request.onerror = () => resolve({ error: request.error?.message });

        request.onsuccess = () => {
          const database = request.result;
          try {
            const tx = database.transaction(store, "readwrite");
            const objectStore = tx.objectStore(store);

            const putRequest = objectStore.put(v, k);

            putRequest.onsuccess = () => {
              database.close();
              resolve({ success: true });
            };

            putRequest.onerror = () => {
              database.close();
              resolve({ error: putRequest.error?.message });
            };
          } catch (error) {
            database.close();
            resolve({ error: error.message });
          }
        };
      });
    },
    args: [dbName, storeName, key, value],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

export async function deleteIndexedDBData(tabId, dbName, storeName, key) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (db, store, k) => {
      return new Promise((resolve) => {
        const request = indexedDB.open(db);

        request.onerror = () => resolve({ error: request.error?.message });

        request.onsuccess = () => {
          const database = request.result;
          try {
            const tx = database.transaction(store, "readwrite");
            const objectStore = tx.objectStore(store);

            const deleteRequest = objectStore.delete(k);

            deleteRequest.onsuccess = () => {
              database.close();
              resolve({ success: true });
            };

            deleteRequest.onerror = () => {
              database.close();
              resolve({ error: deleteRequest.error?.message });
            };
          } catch (error) {
            database.close();
            resolve({ error: error.message });
          }
        };
      });
    },
    args: [dbName, storeName, key],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

// ---------- Advanced (indexeddb.*) ----------

export async function listIndexedDBDatabases(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!indexedDB.databases) {
          return { error: "indexedDB.databases() not supported" };
        }
        const databases = await indexedDB.databases();
        return databases.map((db) => ({
          name: db.name,
          version: db.version,
        }));
      },
    });
    return { databases: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getIndexedDBDatabaseInfo(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const info = {
              name: db.name,
              version: db.version,
              objectStoreNames: Array.from(db.objectStoreNames),
            };
            db.close();
            resolve(info);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getIndexedDBObjectStores(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const stores = [];

            for (const storeName of db.objectStoreNames) {
              const tx = db.transaction(storeName, "readonly");
              const store = tx.objectStore(storeName);
              stores.push({
                name: storeName,
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement,
                indexNames: Array.from(store.indexNames),
              });
            }

            db.close();
            resolve(stores);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName],
    });
    return { stores: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getIndexedDBStoreData(
  tabId,
  dbName,
  storeName,
  options = {},
) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store, opts) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);

            const limit = opts.limit || 100;
            const offset = opts.offset || 0;
            const data = [];
            let count = 0;

            const cursorRequest = objectStore.openCursor();
            cursorRequest.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor && data.length < limit) {
                if (count >= offset) {
                  data.push({
                    key: cursor.key,
                    value: cursor.value,
                  });
                }
                count++;
                cursor.continue();
              } else {
                db.close();
                resolve({ data, total: count });
              }
            };
            cursorRequest.onerror = () => {
              db.close();
              resolve({ error: cursorRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getIndexedDBStoreIndexes(tabId, dbName, storeName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);

            const indexes = [];
            for (const indexName of objectStore.indexNames) {
              const index = objectStore.index(indexName);
              indexes.push({
                name: indexName,
                keyPath: index.keyPath,
                unique: index.unique,
                multiEntry: index.multiEntry,
              });
            }

            db.close();
            resolve(indexes);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName],
    });
    return { indexes: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function queryIndexedDBByIndex(
  tabId,
  dbName,
  storeName,
  indexName,
  query,
) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store, idx, q) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);
            const index = objectStore.index(idx);

            const range =
              q.value !== undefined
                ? IDBKeyRange.only(q.value)
                : q.lower !== undefined && q.upper !== undefined
                  ? IDBKeyRange.bound(
                      q.lower,
                      q.upper,
                      q.lowerOpen,
                      q.upperOpen,
                    )
                  : null;

            const data = [];
            const cursorRequest = range
              ? index.openCursor(range)
              : index.openCursor();

            cursorRequest.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor && data.length < (q.limit || 50)) {
                data.push({
                  key: cursor.key,
                  primaryKey: cursor.primaryKey,
                  value: cursor.value,
                });
                cursor.continue();
              } else {
                db.close();
                resolve({ data });
              }
            };
            cursorRequest.onerror = () => {
              db.close();
              resolve({ error: cursorRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName, indexName, query],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function countIndexedDBRecords(tabId, dbName, storeName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);
            const countRequest = objectStore.count();

            countRequest.onsuccess = () => {
              db.close();
              resolve({ count: countRequest.result });
            };
            countRequest.onerror = () => {
              db.close();
              resolve({ error: countRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function deleteIndexedDBDatabase(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve({ success: true });
          request.onerror = () => resolve({ error: request.error?.message });
          request.onblocked = () =>
            resolve({ error: "Database deletion blocked" });
        });
      },
      args: [dbName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Clear all records from an object store. This is the effective definition that
 * background.js's function hoisting selected for BOTH indexedDB.clearStore and
 * indexeddb.clearStore (see module header note).
 */
export async function clearIndexedDBStore(tabId, dbName, storeName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readwrite");
            const objectStore = tx.objectStore(store);
            const clearRequest = objectStore.clear();

            clearRequest.onsuccess = () => {
              db.close();
              resolve({ success: true });
            };
            clearRequest.onerror = () => {
              db.close();
              resolve({ error: clearRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function exportIndexedDBDatabase(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = async () => {
            const db = request.result;
            const exportData = {
              name: db.name,
              version: db.version,
              stores: {},
            };

            const storeNames = Array.from(db.objectStoreNames);

            for (const storeName of storeNames) {
              const tx = db.transaction(storeName, "readonly");
              const store = tx.objectStore(storeName);
              const data = [];

              await new Promise((resolveStore) => {
                const cursor = store.openCursor();
                cursor.onsuccess = (e) => {
                  const c = e.target.result;
                  if (c) {
                    data.push({ key: c.key, value: c.value });
                    c.continue();
                  } else {
                    exportData.stores[storeName] = {
                      keyPath: store.keyPath,
                      autoIncrement: store.autoIncrement,
                      data: data.slice(0, 1000), // Limit for safety
                    };
                    resolveStore();
                  }
                };
              });
            }

            db.close();
            resolve(exportData);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export const indexeddbHandlers = {
  // Basic
  "indexedDB.getDatabases": ({ tabId }) => getIndexedDBDatabases(tabId),
  "indexedDB.getData": ({ tabId, dbName, storeName, query }) =>
    getIndexedDBData(tabId, dbName, storeName, query),
  "indexedDB.setData": ({ tabId, dbName, storeName, key, value }) =>
    setIndexedDBData(tabId, dbName, storeName, key, value),
  "indexedDB.deleteData": ({ tabId, dbName, storeName, key }) =>
    deleteIndexedDBData(tabId, dbName, storeName, key),
  "indexedDB.clearStore": ({ tabId, dbName, storeName }) =>
    clearIndexedDBStore(tabId, dbName, storeName),
  // Advanced
  "indexeddb.listDatabases": ({ tabId }) => listIndexedDBDatabases(tabId),
  "indexeddb.getDatabaseInfo": ({ tabId, dbName }) =>
    getIndexedDBDatabaseInfo(tabId, dbName),
  "indexeddb.getObjectStores": ({ tabId, dbName }) =>
    getIndexedDBObjectStores(tabId, dbName),
  "indexeddb.getStoreData": ({ tabId, dbName, storeName, options }) =>
    getIndexedDBStoreData(tabId, dbName, storeName, options),
  "indexeddb.getStoreIndexes": ({ tabId, dbName, storeName }) =>
    getIndexedDBStoreIndexes(tabId, dbName, storeName),
  "indexeddb.queryByIndex": ({ tabId, dbName, storeName, indexName, query }) =>
    queryIndexedDBByIndex(tabId, dbName, storeName, indexName, query),
  "indexeddb.countRecords": ({ tabId, dbName, storeName }) =>
    countIndexedDBRecords(tabId, dbName, storeName),
  "indexeddb.deleteDatabase": ({ tabId, dbName }) =>
    deleteIndexedDBDatabase(tabId, dbName),
  "indexeddb.clearStore": ({ tabId, dbName, storeName }) =>
    clearIndexedDBStore(tabId, dbName, storeName),
  "indexeddb.exportDatabase": ({ tabId, dbName }) =>
    exportIndexedDBDatabase(tabId, dbName),
};
