import { bookmarksHandlers } from "./bookmarks.js";
import { cacheHandlers } from "./cache.js";
import { clipboardHandlers } from "./clipboard.js";
import { downloadsHandlers } from "./downloads.js";
import { historyHandlers } from "./history.js";
import { indexeddbHandlers } from "./indexeddb.js";
import { networkHandlers } from "./network.js";
import { notificationsHandlers } from "./notifications.js";
import { storageHandlers } from "./storage.js";
import { listTabs, tabsHandlers } from "./tabs.js";
import { windowsHandlers } from "./windows.js";

export const commandHandlerRegistry = {
  ...tabsHandlers,
  ...bookmarksHandlers,
  ...historyHandlers,
  ...clipboardHandlers,
  ...notificationsHandlers,
  ...downloadsHandlers,
  ...windowsHandlers,
  ...storageHandlers,
  ...indexeddbHandlers,
  ...cacheHandlers,
  ...networkHandlers,
};

export { listTabs };
