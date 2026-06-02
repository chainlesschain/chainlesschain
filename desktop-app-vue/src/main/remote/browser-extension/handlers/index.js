import { bookmarksHandlers } from "./bookmarks.js";
import { clipboardHandlers } from "./clipboard.js";
import { downloadsHandlers } from "./downloads.js";
import { historyHandlers } from "./history.js";
import { notificationsHandlers } from "./notifications.js";
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
};

export { listTabs };
