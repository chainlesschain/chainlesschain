/**
 * DID Management Store
 * Wraps the did:* IPC channels exposed by src/main/did/did-ipc.js.
 * Phase 3 of the V6 page port — covers list/setDefault/delete + DHT
 * publish-status read + create-identity wizard (form → optional mnemonic
 * display → confirmed). Create flow is driven by `creationFlow` state
 * machine instead of the V5 defineExpose pattern. Details / DHT publish /
 * mnemonic export / auto-republish flows land in Phase 4-6.
 * @version 1.2.0
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
  };
});
