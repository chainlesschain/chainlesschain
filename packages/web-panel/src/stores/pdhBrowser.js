/**
 * Phase 16 — PDH Vault Browser store.
 *
 * Owns the browser view's filter state + paginated results + facet counts.
 * Search calls go through usePersonalDataHub composable (WS topic
 * personal-data-hub.search-events / .facet-counts). Cursor pagination on
 * (occurred_at DESC, id DESC); see vault.searchEvents for the contract.
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { usePersonalDataHub } from "../composables/usePersonalDataHub.js";

const DEFAULT_FILTERS = Object.freeze({
  q: "",
  category: null,
  adapter: null,
  subtype: null,
  since: null,
  until: null,
});

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

export const usePdhBrowserStore = defineStore("pdhBrowser", () => {
  const filters = ref({ ...DEFAULT_FILTERS });
  const results = ref([]);           // Event[]
  const cursor = ref(null);          // { occurredAt, id } | null
  const isLoading = ref(false);      // full reload
  const isAppending = ref(false);    // load-more
  const error = ref(null);
  const mode = ref(null);            // 'fts5' | 'like' | null (pre-first-load)
  const shortQuery = ref(false);
  const facets = ref({ byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 });

  // Race-resolution: every search() bumps a token; if a slow response
  // returns after a newer search has been kicked off, we discard it.
  let _searchToken = 0;
  let _debounceTimer = null;

  const hasResults = computed(() => results.value.length > 0);
  const canLoadMore = computed(() => cursor.value != null);

  function _buildFiltersPayload(extra = {}) {
    const out = {};
    const f = filters.value;
    if (f.q && f.q.trim()) out.q = f.q.trim();
    if (f.category) out.category = f.category;
    if (f.adapter) out.adapter = f.adapter;
    if (f.subtype) out.subtype = f.subtype;
    if (Number.isFinite(f.since)) out.since = f.since;
    if (Number.isFinite(f.until)) out.until = f.until;
    return { ...out, ...extra };
  }

  /**
   * Run a fresh search with current filters. Replaces results.
   * Also refreshes facet counts in parallel — both calls observe the same
   * filter snapshot so the sidebar/chip counts stay in sync with the list.
   */
  async function search() {
    const myToken = ++_searchToken;
    isLoading.value = true;
    error.value = null;
    const hub = usePersonalDataHub();
    try {
      const [searchRes, facetRes] = await Promise.all([
        hub.searchEvents(_buildFiltersPayload({ limit: PAGE_SIZE })),
        // facets ignore adapter/subtype/category — they describe the
        // *unfiltered-by-bucket* total within q+date scope, otherwise the
        // sidebar would always read 100% in the selected category (useless).
        hub.facetCounts({
          ...(filters.value.q && filters.value.q.trim() ? { q: filters.value.q.trim() } : {}),
          ...(Number.isFinite(filters.value.since) ? { since: filters.value.since } : {}),
          ...(Number.isFinite(filters.value.until) ? { until: filters.value.until } : {}),
        }),
      ]);
      // Discard stale response if a newer search was kicked off in between
      if (myToken !== _searchToken) return;
      results.value = searchRes.rows || [];
      cursor.value = searchRes.nextCursor || null;
      mode.value = searchRes.mode || "like";
      shortQuery.value = !!searchRes.shortQuery;
      facets.value = {
        byCategory: facetRes.byCategory || {},
        byAdapter: facetRes.byAdapter || {},
        bySubtype: facetRes.bySubtype || {},
        total: facetRes.total || 0,
      };
    } catch (err) {
      if (myToken !== _searchToken) return;
      error.value = err && err.message ? err.message : String(err);
      results.value = [];
      cursor.value = null;
    } finally {
      if (myToken === _searchToken) isLoading.value = false;
    }
  }

  /** Append the next page using the stored cursor. No-op when no cursor. */
  async function loadMore() {
    if (!cursor.value || isAppending.value) return;
    isAppending.value = true;
    error.value = null;
    const hub = usePersonalDataHub();
    try {
      const res = await hub.searchEvents(
        _buildFiltersPayload({ cursor: cursor.value, limit: PAGE_SIZE })
      );
      // Append even if the user has changed filters mid-flight; but only if
      // the underlying mode is unchanged (sanity guard). If the user kicked
      // off a fresh search() this paginate is moot — search() resets cursor.
      results.value = results.value.concat(res.rows || []);
      cursor.value = res.nextCursor || null;
      mode.value = res.mode || mode.value;
    } catch (err) {
      error.value = err && err.message ? err.message : String(err);
    } finally {
      isAppending.value = false;
    }
  }

  /** Mutate one filter + debounced re-search. */
  function setFilter(key, value) {
    if (!(key in DEFAULT_FILTERS)) {
      throw new Error(`pdhBrowser.setFilter: unknown key "${key}"`);
    }
    filters.value = { ...filters.value, [key]: value };
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      search();
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Replace whole filter object (e.g. URL-driven). Immediate search. */
  function setFilters(next) {
    filters.value = { ...DEFAULT_FILTERS, ...next };
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    return search();
  }

  function reset() {
    filters.value = { ...DEFAULT_FILTERS };
    results.value = [];
    cursor.value = null;
    error.value = null;
    facets.value = { byCategory: {}, byAdapter: {}, bySubtype: {}, total: 0 };
  }

  return {
    // state
    filters,
    results,
    cursor,
    isLoading,
    isAppending,
    error,
    mode,
    shortQuery,
    facets,
    // computed
    hasResults,
    canLoadMore,
    // actions
    search,
    loadMore,
    setFilter,
    setFilters,
    reset,
    // constants
    PAGE_SIZE,
    SEARCH_DEBOUNCE_MS,
  };
});
