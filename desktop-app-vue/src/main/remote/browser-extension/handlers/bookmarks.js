export async function getBookmarkTree() {
  const tree = await chrome.bookmarks.getTree();
  return { tree };
}

export async function searchBookmarks(query) {
  const results = await chrome.bookmarks.search(query);
  return { bookmarks: results };
}

export async function createBookmark(params = {}) {
  const bookmark = await chrome.bookmarks.create({
    parentId: params.parentId,
    title: params.title,
    url: params.url,
  });
  return { bookmark };
}

export async function removeBookmark(id) {
  await chrome.bookmarks.remove(id);
  return { success: true };
}

export const bookmarksHandlers = {
  "bookmarks.getTree": async () => getBookmarkTree(),
  "bookmarks.search": async ({ query }) => searchBookmarks(query),
  "bookmarks.create": async (params) => createBookmark(params),
  "bookmarks.remove": async ({ id }) => removeBookmark(id),
};
