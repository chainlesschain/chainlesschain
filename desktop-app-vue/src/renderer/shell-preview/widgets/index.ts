import type { Component } from "vue";
import P2pPreviewWidget from "./P2pPreviewWidget.vue";
import TradePreviewWidget from "./TradePreviewWidget.vue";
import SocialPreviewWidget from "./SocialPreviewWidget.vue";
import UKeyPreviewWidget from "./UKeyPreviewWidget.vue";

export type DecentralEntryId = "p2p" | "trade" | "social" | "ukey";

export interface PreviewWidgetEntry {
  id: DecentralEntryId;
  title: string;
  component: Component;
}

export const PREVIEW_WIDGETS: Record<DecentralEntryId, PreviewWidgetEntry> = {
  p2p: {
    id: "p2p",
    title: "P2P 协作",
    component: P2pPreviewWidget,
  },
  trade: {
    id: "trade",
    title: "去中心化交易",
    component: TradePreviewWidget,
  },
  social: {
    id: "social",
    title: "去中心化社交",
    component: SocialPreviewWidget,
  },
  ukey: {
    id: "ukey",
    title: "U-Key 安全",
    component: UKeyPreviewWidget,
  },
};

export function getPreviewWidget(id: string): PreviewWidgetEntry | undefined {
  return PREVIEW_WIDGETS[id as DecentralEntryId];
}
