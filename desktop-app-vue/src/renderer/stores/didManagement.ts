/**
 * DID Management Store
 * Wraps the did:* IPC channels exposed by src/main/did/did-ipc.js.
 * Phase 5 of the V6 page port — covers list/setDefault/delete + DHT
 * publish-status read + create-identity wizard + details drawer +
 * mnemonic backup status + export-mnemonic. Auto-republish lands in
 * Phase 6.
 * @version 1.4.0
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface IdentitySummary {
  did: string;
  displayName?: string;
  publicKey?: string;
  isDefault?: boolean;
  createdAt?: string | number;
  [key: string]: unknown;
}

export interface CreateIdentityInput {
  nickname: string;
  bio?: string;
  avatar?: string;
  setAsDefault?: boolean;
  // When provided, restore from this BIP39 mnemonic instead of generating one.
  importMnemonic?: string;
}

export type CreationFlowStep =
  | "idle"
  | "form"
  | "submitting"
  | "mnemonic-display";

interface ElectronApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function api(): ElectronApi | undefined {
  return (window as unknown as { electronAPI?: ElectronApi }).electronAPI;
}

export const useDIDManagementStore = defineStore("didManagement", () => {
  const identities = ref<IdentitySummary[]>([]);
  const currentDid = ref<string | null>(null);
  const publishStatus = ref<Record<string, boolean>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoaded = ref(false);

  const creationFlow = ref<CreationFlowStep>("idle");
  const pendingMnemonic = ref<string | null>(null);
  const pendingDid = ref<string | null>(null);
  const mnemonicCopied = ref(false);
  const creationError = ref<string | null>(null);

  const viewingDid = ref<string | null>(null);
  const viewingIdentity = ref<IdentitySummary | null>(null);
  const viewingDocument = ref<unknown>(null);
  const detailsLoading = ref(false);
  const detailsError = ref<string | null>(null);
  const publishingDid = ref<string | null>(null);
  const unpublishingDid = ref<string | null>(null);

  const mnemonicBackupStatus = ref<Record<string, boolean>>({});
  const exportingMnemonicDid = ref<string | null>(null);

  const defaultIdentity = computed(() => {
    if (currentDid.value) {
      return identities.value.find((i) => i.did === currentDid.value) ?? null;
    }
    return (
      identities.value.find((i) => i.isDefault) ?? identities.value[0] ?? null
    );
  });

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const list = (await api()?.invoke("did:get-all-identities")) as
        | IdentitySummary[]
        | null
        | undefined;
      identities.value = Array.isArray(list) ? list : [];
      try {
        const current = (await api()?.invoke("did:get-current-identity")) as
          | IdentitySummary
          | null
          | undefined;
        currentDid.value = current?.did ?? null;
      } catch {
        currentDid.value = null;
      }
      hasLoaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadPublishStatus(): Promise<void> {
    if (identities.value.length === 0) {
      publishStatus.value = {};
      return;
    }
    const entries = await Promise.all(
      identities.value.map(async (id) => {
        try {
          const published = (await api()?.invoke(
            "did:is-published-to-dht",
            id.did,
          )) as boolean | null | undefined;
          return [id.did, published === true] as const;
        } catch {
          return [id.did, false] as const;
        }
      }),
    );
    publishStatus.value = Object.fromEntries(entries);
  }

  async function setDefault(did: string): Promise<void> {
    error.value = null;
    try {
      await api()?.invoke("did:set-default-identity", did);
      await loadAll();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function deleteIdentity(did: string): Promise<boolean> {
    error.value = null;
    try {
      await api()?.invoke("did:delete-identity", did);
      await loadAll();
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  // ---- Phase 3: creation wizard ---------------------------------------------

  function openCreateForm(): void {
    creationFlow.value = "form";
    pendingMnemonic.value = null;
    pendingDid.value = null;
    mnemonicCopied.value = false;
    creationError.value = null;
  }

  function closeCreateForm(): void {
    if (creationFlow.value === "submitting") {
      return;
    }
    creationFlow.value = "idle";
    creationError.value = null;
  }

  async function validateMnemonic(mnemonic: string): Promise<boolean> {
    try {
      const ok = (await api()?.invoke("did:validate-mnemonic", mnemonic)) as
        | boolean
        | null
        | undefined;
      return ok === true;
    } catch {
      return false;
    }
  }

  async function generateMnemonic(): Promise<string> {
    const result = (await api()?.invoke("did:generate-mnemonic")) as
      | string
      | null
      | undefined;
    if (typeof result !== "string" || result.trim().length === 0) {
      throw new Error("助记词生成失败");
    }
    return result;
  }

  async function createIdentity(input: CreateIdentityInput): Promise<boolean> {
    if (!input.nickname || !input.nickname.trim()) {
      creationError.value = "请输入昵称";
      return false;
    }

    creationFlow.value = "submitting";
    creationError.value = null;

    const profile = {
      nickname: input.nickname.trim(),
      bio: input.bio?.trim() || null,
      avatar: input.avatar?.trim() || null,
    };
    const options = { setAsDefault: input.setAsDefault === true };

    try {
      let mnemonic: string;
      const isImport = !!input.importMnemonic && !!input.importMnemonic.trim();

      if (isImport) {
        const candidate = input.importMnemonic!.trim();
        const valid = await validateMnemonic(candidate);
        if (!valid) {
          creationError.value = "助记词格式无效，请检查后重试";
          creationFlow.value = "form";
          return false;
        }
        mnemonic = candidate;
      } else {
        mnemonic = await generateMnemonic();
      }

      const result = (await api()?.invoke(
        "did:create-from-mnemonic",
        profile,
        mnemonic,
        options,
      )) as { did?: string } | null | undefined;

      const newDid =
        result && typeof result === "object" && "did" in result
          ? String(result.did ?? "")
          : "";

      await loadAll();
      await loadPublishStatus();

      if (isImport) {
        // user supplied the mnemonic — no need to display it back
        creationFlow.value = "idle";
        pendingMnemonic.value = null;
        pendingDid.value = null;
      } else {
        // brand-new identity — force the user through the backup screen
        pendingMnemonic.value = mnemonic;
        pendingDid.value = newDid || null;
        mnemonicCopied.value = false;
        creationFlow.value = "mnemonic-display";
      }
      return true;
    } catch (e) {
      creationError.value = e instanceof Error ? e.message : String(e);
      creationFlow.value = "form";
      return false;
    }
  }

  function markMnemonicCopied(): void {
    mnemonicCopied.value = true;
  }

  function dismissMnemonic(): boolean {
    if (creationFlow.value !== "mnemonic-display") {
      return false;
    }
    if (!mnemonicCopied.value) {
      return false;
    }
    creationFlow.value = "idle";
    pendingMnemonic.value = null;
    pendingDid.value = null;
    return true;
  }

  function clearCreationError(): void {
    creationError.value = null;
  }

  // ---- Phase 4: details drawer + DHT publish/unpublish + QR -----------------

  async function openDetails(did: string): Promise<void> {
    viewingDid.value = did;
    viewingDocument.value = null;
    viewingIdentity.value = null;
    detailsError.value = null;
    detailsLoading.value = true;
    try {
      const detail = (await api()?.invoke("did:get-identity", did)) as
        | IdentitySummary
        | null
        | undefined;
      viewingIdentity.value = detail ?? null;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      detailsLoading.value = false;
    }
  }

  function closeDetails(): void {
    viewingDid.value = null;
    viewingIdentity.value = null;
    viewingDocument.value = null;
    detailsError.value = null;
  }

  async function loadDocument(did: string): Promise<unknown> {
    detailsError.value = null;
    try {
      const doc = await api()?.invoke("did:export-document", did);
      viewingDocument.value = doc ?? null;
      return doc ?? null;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async function publishToDHT(did: string): Promise<boolean> {
    detailsError.value = null;
    publishingDid.value = did;
    try {
      await api()?.invoke("did:publish-to-dht", did);
      publishStatus.value = { ...publishStatus.value, [did]: true };
      return true;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      publishingDid.value = null;
    }
  }

  async function unpublishFromDHT(did: string): Promise<boolean> {
    detailsError.value = null;
    unpublishingDid.value = did;
    try {
      await api()?.invoke("did:unpublish-from-dht", did);
      publishStatus.value = { ...publishStatus.value, [did]: false };
      return true;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      unpublishingDid.value = null;
    }
  }

  async function generateQRData(did: string): Promise<string | null> {
    try {
      const data = (await api()?.invoke("did:generate-qrcode", did)) as
        | string
        | null
        | undefined;
      return typeof data === "string" ? data : null;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  function clearDetailsError(): void {
    detailsError.value = null;
  }

  // ---- Phase 5: mnemonic backup status + export ----------------------------

  async function loadMnemonicBackupStatus(): Promise<void> {
    if (identities.value.length === 0) {
      mnemonicBackupStatus.value = {};
      return;
    }
    const entries = await Promise.all(
      identities.value.map(async (id) => {
        try {
          const has = (await api()?.invoke("did:has-mnemonic", id.did)) as
            | boolean
            | null
            | undefined;
          return [id.did, has === true] as const;
        } catch {
          return [id.did, false] as const;
        }
      }),
    );
    mnemonicBackupStatus.value = Object.fromEntries(entries);
  }

  async function exportMnemonic(did: string): Promise<string | null> {
    detailsError.value = null;
    exportingMnemonicDid.value = did;
    try {
      const result = (await api()?.invoke("did:export-mnemonic", did)) as
        | string
        | null
        | undefined;
      if (typeof result !== "string" || result.trim().length === 0) {
        return null;
      }
      // Surfacing a known-good backup also flips the cached status so the
      // UI doesn't lag behind for this row.
      mnemonicBackupStatus.value = {
        ...mnemonicBackupStatus.value,
        [did]: true,
      };
      return result;
    } catch (e) {
      detailsError.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      exportingMnemonicDid.value = null;
    }
  }

  return {
    identities,
    currentDid,
    publishStatus,
    loading,
    error,
    hasLoaded,
    creationFlow,
    pendingMnemonic,
    pendingDid,
    mnemonicCopied,
    creationError,
    viewingDid,
    viewingIdentity,
    viewingDocument,
    detailsLoading,
    detailsError,
    publishingDid,
    unpublishingDid,
    mnemonicBackupStatus,
    exportingMnemonicDid,
    defaultIdentity,
    loadAll,
    loadPublishStatus,
    setDefault,
    deleteIdentity,
    clearError,
    openCreateForm,
    closeCreateForm,
    validateMnemonic,
    generateMnemonic,
    createIdentity,
    markMnemonicCopied,
    dismissMnemonic,
    clearCreationError,
    openDetails,
    closeDetails,
    loadDocument,
    publishToDHT,
    unpublishFromDHT,
    generateQRData,
    clearDetailsError,
    loadMnemonicBackupStatus,
    exportMnemonic,
  };
});
