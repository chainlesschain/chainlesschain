/**
 * Email provider presets — mainland-China-first.
 *
 * Each entry tells the adapter where to connect + which folders are
 * worth syncing by default. Users can override host/port/tls via the
 * adapter constructor (provider="custom").
 *
 * Authentication is consistently the per-provider "authorization code"
 * pattern (per design doc §3 OQ-1). The user goes to their email
 * web console, enables IMAP/SMTP, copies the auth code, pastes it
 * into the adapter config. The adapter never sees the user's actual
 * login password.
 */

"use strict";

const PROVIDERS = Object.freeze({
  qq: {
    id: "qq",
    displayName: "QQ 邮箱",
    host: "imap.qq.com",
    port: 993,
    secure: true,
    setupUrl: "https://mail.qq.com/cgi-bin/frame_html?sid=&r=&t=client",
    defaultFolders: ["INBOX", "Sent Messages"],
    authNote: "Use 授权码 (设置 → 账户 → 开启 IMAP/SMTP), NOT your QQ login password.",
  },
  "189": {
    id: "189",
    displayName: "189 邮箱",
    host: "imap.189.cn",
    port: 993,
    secure: true,
    setupUrl: "https://mail.189.cn/",
    defaultFolders: ["INBOX", "已发送"],
    authNote: "Use 授权码 (设置 → 第三方客户端授权码).",
  },
  "163": {
    id: "163",
    displayName: "网易邮箱 (163/126)",
    host: "imap.163.com",
    port: 993,
    secure: true,
    setupUrl: "https://mail.163.com/",
    defaultFolders: ["INBOX", "已发送"],
    authNote: "Use 授权码 (设置 → POP3/SMTP/IMAP).",
  },
  outlook: {
    id: "outlook",
    displayName: "Outlook / Hotmail",
    host: "outlook.office365.com",
    port: 993,
    secure: true,
    setupUrl: "https://outlook.live.com/mail/0/options/mail/forwarding",
    defaultFolders: ["INBOX", "Sent"],
    authNote: "App password (account.microsoft.com/security) — basic-auth deprecation pending; v1 will switch to OAuth2.",
  },
  gmail: {
    id: "gmail",
    displayName: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    setupUrl: "https://myaccount.google.com/apppasswords",
    defaultFolders: ["INBOX", "[Gmail]/Sent Mail"],
    authNote: "App password (myaccount.google.com/apppasswords). OAuth2 in v2.",
  },
});

function resolveProvider(account) {
  if (!account || typeof account !== "object") {
    throw new Error("resolveProvider: account required");
  }
  const id = account.provider;
  if (id === "custom") {
    if (typeof account.host !== "string" || !account.host) {
      throw new Error("resolveProvider: custom provider requires host");
    }
    return {
      host: account.host,
      port: Number.isInteger(account.port) ? account.port : 993,
      secure: account.secure !== false,
      folders: Array.isArray(account.folders) && account.folders.length > 0
        ? account.folders
        : ["INBOX"],
      displayName: account.displayName || account.host,
      providerId: "custom",
    };
  }
  const preset = PROVIDERS[id];
  if (!preset) {
    throw new Error(
      `resolveProvider: unknown provider "${id}". Known: ${Object.keys(PROVIDERS).join(", ")}, or use "custom".`
    );
  }
  return {
    host: account.host || preset.host,
    port: Number.isInteger(account.port) ? account.port : preset.port,
    secure: typeof account.secure === "boolean" ? account.secure : preset.secure,
    folders: Array.isArray(account.folders) && account.folders.length > 0
      ? account.folders
      : preset.defaultFolders,
    displayName: account.displayName || preset.displayName,
    providerId: preset.id,
  };
}

module.exports = {
  PROVIDERS,
  resolveProvider,
};
