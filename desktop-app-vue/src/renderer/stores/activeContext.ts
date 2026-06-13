import { defineStore } from "pinia";

/**
 * The document the user is CURRENTLY viewing in some view (e.g. a project file
 * open in the editor). Views publish it on show and clear it on hide, so the
 * AI chat's "file" context mode reflects what's visible NOW — not the globally
 * persisted last-opened file (`projectStore.currentFile`, which other features
 * rely on staying set across navigation). Keeping this separate avoids
 * disturbing that persistence while giving the chat accurate "visible" context.
 */
export interface ActiveDocument {
  /** Origin view, e.g. "project-file" — lets the chat label/scope context. */
  source: string;
  name: string;
  path?: string;
  content?: string;
}

interface ActiveContextState {
  document: ActiveDocument | null;
}

export const useActiveContextStore = defineStore("activeContext", {
  state: (): ActiveContextState => ({
    document: null,
  }),
  getters: {
    /** True only when a document with non-empty content is visible. */
    hasDocument: (state): boolean =>
      !!(state.document && (state.document.content?.trim().length ?? 0) > 0),
  },
  actions: {
    setActiveDocument(doc: ActiveDocument | null): void {
      this.document = doc;
    },
    clearActiveDocument(): void {
      this.document = null;
    },
  },
});
