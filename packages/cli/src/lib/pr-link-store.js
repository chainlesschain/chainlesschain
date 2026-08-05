import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getHomeDir } from "./paths.js";

export function prLinkLedgerPath() {
  return join(getHomeDir(), "pr-links.json");
}

export function readPrLinkLedger() {
  try {
    const ledgerPath = prLinkLedgerPath();
    if (!existsSync(ledgerPath)) return {};
    const parsed = JSON.parse(readFileSync(ledgerPath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getPrLinks(sessionId) {
  if (!sessionId) return [];
  const links = readPrLinkLedger()[sessionId];
  return Array.isArray(links)
    ? [...links].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    : [];
}
