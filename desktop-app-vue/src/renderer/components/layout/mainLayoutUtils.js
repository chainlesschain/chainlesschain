/**
 * Pure helpers extracted from MainLayout.vue.
 *
 * getIconComponent stays in the SFC because it imports ~40 Ant Design icon
 * components and uses them as values; moving it here would mean dragging
 * those icon imports along too. getMenuIcon is just a key→icon-name string
 * map and is the natural slice for utility extraction.
 */

const MENU_ICON_MAP = {
  "project-categories": "AppstoreOutlined",
  projects: "FolderOpenOutlined",
  "project-list-management": "TableOutlined",
  "workspace-management": "ApartmentOutlined",
  "template-management": "TagsOutlined",
  "project-market": "ShopOutlined",
  "project-collaboration": "TeamOutlined",
  "project-archived": "InboxOutlined",
  home: "HomeOutlined",
  "knowledge-list": "FileTextOutlined",
  "knowledge-graph": "NodeIndexOutlined",
  "file-import": "CloudUploadOutlined",
  "image-upload": "FileImageOutlined",
  "audio-import": "SoundOutlined",
  "multimedia-demo": "VideoCameraOutlined",
  "prompt-templates": "TagsOutlined",
  "ai-chat": "RobotOutlined",
  "knowledge-store": "ShopOutlined",
  "my-purchases": "ShoppingCartOutlined",
  did: "IdcardOutlined",
  credentials: "SafetyCertificateOutlined",
  contacts: "TeamOutlined",
  friends: "UserOutlined",
  posts: "CommentOutlined",
  "p2p-messaging": "MessageOutlined",
  trading: "DashboardOutlined",
  marketplace: "ShopOutlined",
  contracts: "AuditOutlined",
  "credit-score": "StarOutlined",
  wallet: "WalletOutlined",
  bridge: "SwapOutlined",
  webide: "CodeOutlined",
  "design-editor": "BgColorsOutlined",
  "rss-feeds": "ReadOutlined",
  "email-accounts": "MailOutlined",
  organizations: "ApartmentOutlined",
  "enterprise-dashboard": "DashboardOutlined",
  "permission-management": "SafetyCertificateOutlined",
  "system-settings": "SettingOutlined",
  settings: "SettingOutlined",
  "plugin-management": "AppstoreOutlined",
  "plugin-marketplace": "ShopOutlined",
  "plugin-publisher": "CloudUploadOutlined",
  "skill-management": "ThunderboltOutlined",
  "demo-templates": "ExperimentOutlined",
  "tools-explorer": "AppstoreOutlined",
  "tool-management": "ToolOutlined",
  "llm-settings": "ApiOutlined",
  "rag-settings": "DatabaseOutlined",
  "git-settings": "SyncOutlined",
  "sync-conflicts": "ExclamationCircleOutlined",
  "ukey-settings": "SafetyOutlined",
  "database-performance": "DashboardOutlined",
  "workflow-optimizations": "ThunderboltOutlined",
};

/**
 * Map a sidebar/menu route key (e.g. "p2p-messaging") to the Ant Design icon
 * NAME (e.g. "MessageOutlined") that the SFC then resolves to a component
 * via getIconComponent.
 *
 * @param {string} key
 * @returns {string} icon name; "FileTextOutlined" if no match.
 */
export const getMenuIcon = (key) => MENU_ICON_MAP[key] || "FileTextOutlined";
