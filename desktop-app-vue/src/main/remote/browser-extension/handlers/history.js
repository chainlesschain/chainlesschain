export async function searchHistory(params = {}) {
  const results = await chrome.history.search({
    text: params.query || "",
    maxResults: params.limit || 100,
    startTime: params.startTime || 0,
    endTime: params.endTime || Date.now(),
  });
  return { history: results };
}

export async function getVisits(url) {
  const visits = await chrome.history.getVisits({ url });
  return { visits };
}

export async function deleteHistory(url) {
  await chrome.history.deleteUrl({ url });
  return { success: true };
}

export const historyHandlers = {
  "history.search": async (params) => searchHistory(params),
  "history.getVisits": async ({ url }) => getVisits(url),
  "history.delete": async ({ url }) => deleteHistory(url),
};
