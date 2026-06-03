export async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    windowId: tab.windowId,
    index: tab.index,
    pinned: tab.pinned,
    favIconUrl: tab.favIconUrl,
  }));
}

export async function getTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    windowId: tab.windowId,
  };
}

export async function createTab(params = {}) {
  const tab = await chrome.tabs.create({
    url: params.url || "about:blank",
    active: params.active !== false,
  });
  return { id: tab.id, url: tab.url };
}

export async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  return { success: true };
}

export async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { success: true };
}

export async function navigateTab(tabId, url) {
  const tab = await chrome.tabs.update(tabId, { url });
  return { id: tab.id, url: tab.url };
}

export async function reloadTab(tabId) {
  await chrome.tabs.reload(tabId);
  return { success: true };
}

export async function goBack(tabId) {
  await chrome.tabs.goBack(tabId);
  return { success: true };
}

export async function goForward(tabId) {
  await chrome.tabs.goForward(tabId);
  return { success: true };
}

export const tabsHandlers = {
  "tabs.list": async () => listTabs(),
  "tabs.get": async ({ tabId }) => getTab(tabId),
  "tabs.create": async (params) => createTab(params),
  "tabs.close": async ({ tabId }) => closeTab(tabId),
  "tabs.focus": async ({ tabId }) => focusTab(tabId),
  "tabs.navigate": async ({ tabId, url }) => navigateTab(tabId, url),
  "tabs.reload": async ({ tabId }) => reloadTab(tabId),
  "tabs.goBack": async ({ tabId }) => goBack(tabId),
  "tabs.goForward": async ({ tabId }) => goForward(tabId),
};
