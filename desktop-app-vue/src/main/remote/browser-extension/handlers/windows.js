/**
 * Window + Tab Group command handlers for the ChainlessChain Browser Bridge.
 *
 * Covers the chrome.windows API (enumerate/get/create/update/remove/current)
 * and the Phase 23 chrome.tabGroups API (create/get/getAll/update/move/ungroup).
 *
 * Extracted verbatim from background.js (Phase 1 of the split). Self-contained:
 * chrome.windows / chrome.tabs / chrome.tabGroups only, no shared-layer
 * dependency.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome */

// ---------- chrome.windows ----------

export async function getAllWindows() {
  const windows = await chrome.windows.getAll({ populate: true });
  return {
    windows: windows.map((w) => ({
      id: w.id,
      type: w.type,
      state: w.state,
      focused: w.focused,
      top: w.top,
      left: w.left,
      width: w.width,
      height: w.height,
      incognito: w.incognito,
      tabCount: w.tabs ? w.tabs.length : 0,
    })),
  };
}

export async function getWindow(windowId) {
  const window = await chrome.windows.get(windowId, { populate: true });
  return {
    id: window.id,
    type: window.type,
    state: window.state,
    focused: window.focused,
    top: window.top,
    left: window.left,
    width: window.width,
    height: window.height,
    incognito: window.incognito,
    tabs: window.tabs
      ? window.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          active: t.active,
        }))
      : [],
  };
}

export async function createWindow(params) {
  const options = {};
  if (params.url) {
    options.url = params.url;
  }
  if (params.type) {
    options.type = params.type;
  }
  if (params.state) {
    options.state = params.state;
  }
  if (params.focused !== undefined) {
    options.focused = params.focused;
  }
  if (params.incognito !== undefined) {
    options.incognito = params.incognito;
  }
  if (params.width) {
    options.width = params.width;
  }
  if (params.height) {
    options.height = params.height;
  }
  if (params.top !== undefined) {
    options.top = params.top;
  }
  if (params.left !== undefined) {
    options.left = params.left;
  }
  const window = await chrome.windows.create(options);
  return { windowId: window.id };
}

export async function updateWindow(windowId, params) {
  const updateInfo = {};
  if (params.state) {
    updateInfo.state = params.state;
  }
  if (params.focused !== undefined) {
    updateInfo.focused = params.focused;
  }
  if (params.width) {
    updateInfo.width = params.width;
  }
  if (params.height) {
    updateInfo.height = params.height;
  }
  if (params.top !== undefined) {
    updateInfo.top = params.top;
  }
  if (params.left !== undefined) {
    updateInfo.left = params.left;
  }
  if (params.drawAttention !== undefined) {
    updateInfo.drawAttention = params.drawAttention;
  }
  const window = await chrome.windows.update(windowId, updateInfo);
  return { success: true, state: window.state };
}

export async function removeWindow(windowId) {
  await chrome.windows.remove(windowId);
  return { success: true };
}

export async function getCurrentWindow() {
  const window = await chrome.windows.getCurrent({ populate: true });
  return {
    id: window.id,
    type: window.type,
    state: window.state,
    focused: window.focused,
    width: window.width,
    height: window.height,
  };
}

// ---------- chrome.tabGroups (Chrome specific) ----------

export async function createTabGroup(tabIds, options = {}) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const groupId = await chrome.tabs.group({ tabIds });
    if (options.title || options.color || options.collapsed !== undefined) {
      await chrome.tabGroups.update(groupId, {
        title: options.title,
        color: options.color,
        collapsed: options.collapsed,
      });
    }
    const group = await chrome.tabGroups.get(groupId);
    return {
      groupId,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      windowId: group.windowId,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getTabGroup(groupId) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const group = await chrome.tabGroups.get(groupId);
    const tabs = await chrome.tabs.query({ groupId });
    return {
      id: group.id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      windowId: group.windowId,
      tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getAllTabGroups(windowId) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const queryInfo = windowId ? { windowId } : {};
    const groups = await chrome.tabGroups.query(queryInfo);
    const result = [];
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      result.push({
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        windowId: group.windowId,
        tabCount: tabs.length,
      });
    }
    return { groups: result };
  } catch (error) {
    return { error: error.message };
  }
}

export async function updateTabGroup(groupId, options) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const group = await chrome.tabGroups.update(groupId, options);
    return {
      id: group.id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function moveTabGroup(groupId, moveProperties) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const group = await chrome.tabGroups.move(groupId, moveProperties);
    return {
      id: group.id,
      windowId: group.windowId,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function ungroupTabs(tabIds) {
  try {
    await chrome.tabs.ungroup(tabIds);
    return { success: true, ungroupedTabs: tabIds.length };
  } catch (error) {
    return { error: error.message };
  }
}

export const windowsHandlers = {
  "windows.getAll": () => getAllWindows(),
  "windows.get": ({ windowId }) => getWindow(windowId),
  "windows.create": (params) => createWindow(params),
  "windows.update": ({ windowId, ...params }) => updateWindow(windowId, params),
  "windows.remove": ({ windowId }) => removeWindow(windowId),
  "windows.getCurrent": () => getCurrentWindow(),
  "tabGroups.create": ({ tabIds, options }) => createTabGroup(tabIds, options),
  "tabGroups.get": ({ groupId }) => getTabGroup(groupId),
  "tabGroups.getAll": ({ windowId }) => getAllTabGroups(windowId),
  "tabGroups.update": ({ groupId, options }) =>
    updateTabGroup(groupId, options),
  "tabGroups.move": ({ groupId, moveProperties }) =>
    moveTabGroup(groupId, moveProperties),
  "tabGroups.ungroup": ({ tabIds }) => ungroupTabs(tabIds),
};
