<template>
  <component :is="rendererFor(event)" :event="event" />
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import { getCategory } from "../../../utils/pdhCategories.js";

defineProps({
  event: { type: Object, required: true },
});

// Lazy-load renderer components so the initial bundle doesn't pull every
// renderer's CSS. Only the category being viewed pays the cost.
const ChatBubbleRenderer = defineAsyncComponent(() => import("./ChatBubbleRenderer.vue"));
const OrderTableRenderer = defineAsyncComponent(() => import("./OrderTableRenderer.vue"));
const TimelineRenderer = defineAsyncComponent(() => import("./TimelineRenderer.vue"));
const EmailListRenderer = defineAsyncComponent(() => import("./EmailListRenderer.vue"));
const GenericCardRenderer = defineAsyncComponent(() => import("./GenericCardRenderer.vue"));

// Category → component mapping. Pure dispatch; renderer-internal logic
// handles field variation within the category. Per memory pdh_llm_routing_split_trap,
// dispatch is keyed on **category** (stable) not subtype (drifts fast).
function rendererFor(event) {
  const adapter = event && event.source && event.source.adapter;
  const cat = getCategory(adapter);
  switch (cat) {
    case "chat":
    case "ai-chat":
      return ChatBubbleRenderer;
    case "shopping":
      return OrderTableRenderer;
    case "travel":
      return TimelineRenderer;
    case "email":
      return EmailListRenderer;
    // social / system / other → generic fallback
    default:
      return GenericCardRenderer;
  }
}
</script>
