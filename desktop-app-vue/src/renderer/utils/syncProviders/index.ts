/**
 * SyncProvider 注册表。
 *
 * 顺序即 Settings 页 + scheduler 串行执行的顺序。新增 provider 在此 push。
 */

import { backendProvider } from "./backend";
import { gitProvider } from "./git";
import { p2pProvider } from "./p2p";
import { mobileProvider } from "./mobile";
import { webdavProvider } from "./webdav";
import { ossProvider } from "./oss";
import type { SyncProvider } from "./types";

export const PROVIDERS: SyncProvider[] = [
  backendProvider,
  gitProvider,
  p2pProvider,
  mobileProvider,
  webdavProvider,
  ossProvider,
];

export const PROVIDERS_BY_ID: Record<string, SyncProvider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
);

export function getProvider(id: string): SyncProvider | undefined {
  return PROVIDERS_BY_ID[id];
}

export type { SyncProvider, SyncProviderResult } from "./types";
