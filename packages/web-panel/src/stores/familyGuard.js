/**
 * FAMILY-26 家长端家庭守护仪表板 store (web-panel)。
 *
 * 镜像 desktop renderer 的 stores/family-guard.ts，但走 WS topic
 * (useFamilyGuard composable) 而非 Electron IPC。数据来自 desktop web-shell 的
 * family_child_event 镜像表；cc ui standalone 无数据时优雅显空（不崩）。
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useFamilyGuard } from "../composables/useFamilyGuard.js";

export const useFamilyGuardStore = defineStore("familyGuard", () => {
  const children = ref([]);
  const selectedChildDid = ref(null);
  const events = ref([]);
  const summary = ref({ totalMs: 0, apps: [] });
  const loading = ref(false);
  const error = ref(null);

  const hasChildren = computed(() => children.value.length > 0);
  const totalMinutes = computed(() =>
    Math.round((summary.value.totalMs || 0) / 60000),
  );

  async function fetchChildren() {
    loading.value = true;
    error.value = null;
    try {
      const hub = useFamilyGuard();
      children.value = await hub.listChildren();
      if (!selectedChildDid.value && children.value.length > 0) {
        await selectChild(children.value[0].childDid);
      }
    } catch (err) {
      error.value = err?.message || String(err);
    } finally {
      loading.value = false;
    }
  }

  async function selectChild(childDid, sinceMs = 0) {
    selectedChildDid.value = childDid;
    await Promise.all([fetchEvents(sinceMs), fetchSummary(sinceMs)]);
  }

  async function fetchEvents(sinceMs = 0, limit = 200) {
    if (!selectedChildDid.value) {
      return;
    }
    const hub = useFamilyGuard();
    events.value = await hub.listChildEvents({
      childDid: selectedChildDid.value,
      sinceMs,
      limit,
    });
  }

  async function fetchSummary(sinceMs = 0) {
    if (!selectedChildDid.value) {
      return;
    }
    const hub = useFamilyGuard();
    summary.value = await hub.appUsageSummary({
      childDid: selectedChildDid.value,
      sinceMs,
    });
  }

  return {
    children,
    selectedChildDid,
    events,
    summary,
    loading,
    error,
    hasChildren,
    totalMinutes,
    fetchChildren,
    selectChild,
    fetchEvents,
    fetchSummary,
  };
});
