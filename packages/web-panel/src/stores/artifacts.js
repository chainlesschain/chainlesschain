import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useWsStore } from "./ws";

/**
 * Artifacts panel — drives the CLI's artifact-* WS protocol over the
 * agent-published deliverable store (publish_artifact tool / cc artifacts):
 * list deliverables, preview inline (text utf8 / image base64, server-capped),
 * remove one, clean expired.
 */
export const useArtifactsStore = defineStore("artifacts", () => {
  const artifacts = ref([]);
  const loading = ref(false);
  const kindFilter = ref("");
  const sessionFilter = ref("");
  const preview = ref(null); // { entry, previewable, encoding, content, truncated, reason }
  const previewLoading = ref(false);

  const kinds = computed(() => {
    const set = new Set(artifacts.value.map((a) => a.kind).filter(Boolean));
    return [...set].sort();
  });

  async function fetchArtifacts() {
    const ws = useWsStore();
    loading.value = true;
    try {
      const payload = { type: "artifact-list" };
      if (kindFilter.value) payload.kind = kindFilter.value;
      if (sessionFilter.value) payload.session = sessionFilter.value;
      const result = await ws.sendRaw(payload);
      if (result && Array.isArray(result.artifacts)) {
        // newest first for the panel
        artifacts.value = [...result.artifacts].reverse();
      }
    } catch {
      // Non-critical — refresh retries
    } finally {
      loading.value = false;
    }
  }

  async function openPreview(entry) {
    const ws = useWsStore();
    previewLoading.value = true;
    preview.value = { entry, previewable: false };
    try {
      const result = await ws.sendRaw({
        type: "artifact-content",
        artifactId: entry.id,
      });
      preview.value = {
        entry,
        previewable: result?.previewable === true,
        encoding: result?.encoding || null,
        content: result?.content || "",
        truncated: result?.truncated === true,
        reason: result?.reason || null,
      };
    } catch (err) {
      preview.value = {
        entry,
        previewable: false,
        reason: err?.message || "preview failed",
      };
    } finally {
      previewLoading.value = false;
    }
  }

  function closePreview() {
    preview.value = null;
  }

  /** data: URI for an image preview (null when not an image preview). */
  const previewImageSrc = computed(() => {
    const p = preview.value;
    if (!p?.previewable || p.encoding !== "base64") return null;
    return `data:${p.entry?.mime || "image/png"};base64,${p.content}`;
  });

  /** Rich-render the preview as Markdown? (utf8 text with a markdown mime) */
  const previewIsMarkdown = computed(() => {
    const p = preview.value;
    return (
      p?.previewable === true &&
      p.encoding === "utf8" &&
      String(p.entry?.mime || "").toLowerCase() === "text/markdown"
    );
  });

  /**
   * Download the FULL stored file through the HTTP endpoint (the WS preview
   * route is capped; this one streams everything) — fetch + blob + a
   * transient <a download> click. The panel's WS token authenticates the
   * request as a Bearer header (never in the URL, so it can't leak into
   * browser history).
   */
  async function downloadArtifact(entry, deps = {}) {
    if (!entry?.id) return false;
    const fetchFn = deps.fetch || globalThis.fetch;
    const doc = deps.document || globalThis.document;
    const urlApi = deps.URL || globalThis.URL;
    const cfg = (deps.config || globalThis.window?.__CC_CONFIG__) ?? {};
    try {
      const res = await fetchFn(`/api/artifacts/${entry.id}/download`, {
        headers: cfg.wsToken
          ? { Authorization: `Bearer ${cfg.wsToken}` }
          : {},
      });
      if (!res.ok) return false;
      const blob = await res.blob();
      const href = urlApi.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = href;
      a.download = entry.title || entry.id;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      urlApi.revokeObjectURL(href);
      return true;
    } catch {
      return false;
    }
  }

  async function removeArtifact(artifactId) {
    const ws = useWsStore();
    if (!artifactId) return false;
    try {
      const result = await ws.sendRaw({
        type: "artifact-remove",
        artifactId,
      });
      if (preview.value?.entry?.id === artifactId) preview.value = null;
      await fetchArtifacts();
      return result?.found === true;
    } catch {
      return false;
    }
  }

  async function cleanExpired() {
    const ws = useWsStore();
    try {
      const result = await ws.sendRaw({ type: "artifact-clean" });
      await fetchArtifacts();
      return Number(result?.removed) || 0;
    } catch {
      return 0;
    }
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function kindColor(kind) {
    switch (kind) {
      case "report":
        return "blue";
      case "patch":
        return "purple";
      case "screenshot":
        return "cyan";
      case "log":
        return "default";
      case "data":
        return "green";
      default:
        return "default";
    }
  }

  return {
    artifacts,
    loading,
    kindFilter,
    sessionFilter,
    kinds,
    preview,
    previewLoading,
    previewImageSrc,
    previewIsMarkdown,
    fetchArtifacts,
    openPreview,
    closePreview,
    removeArtifact,
    cleanExpired,
    downloadArtifact,
    formatSize,
    kindColor,
  };
});
