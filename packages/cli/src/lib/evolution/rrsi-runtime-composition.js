/** Initial governed PM preparation composition; no signer/provider/promotion defaults. */
import { isProxy } from "node:util/types";
import { verifyRrsiCampaign } from "./rrsi-contracts.js";
import { recheckRrsiEffectiveParent } from "./rrsi-parent-binding.js";
import { bindRrsiPmRuntime } from "./rrsi-pm-execution-bridge.js";
import { snapshotRrsiData, rrsiEnvelope, rrsiFail } from "./rrsi-data.js";

export const RRSI_RUNTIME_COMPOSITION_SCHEMA =
  "chainlesschain.rrsi-runtime-composition/v1";
const COMPOSITIONS = new WeakMap();

export function createRrsiRuntimeComposition(input) {
  const keys = ["campaign", "pmBridge", "parentBinding", "mode"];
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== keys.length
  )
    rrsiFail("RRSI runtime composition requires plain own fields");
  const ports = Object.fromEntries(
    keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("RRSI runtime composition cannot use accessors");
      return [key, field.value];
    }),
  );
  const campaign = verifyRrsiCampaign(snapshotRrsiData(ports.campaign));
  recheckRrsiEffectiveParent(ports.parentBinding);
  if (ports.parentBinding.descriptor.campaignDigest !== campaign.campaignDigest)
    rrsiFail("RRSI runtime parent belongs to another campaign");
  // Mutating binding happens last, after all independent validation.
  const bridge = bindRrsiPmRuntime(
    ports.pmBridge,
    ports.parentBinding,
    ports.mode,
  );
  const composition = Object.freeze({
    descriptor: rrsiEnvelope(
      RRSI_RUNTIME_COMPOSITION_SCHEMA,
      "compositionDigest",
      {
        campaignDigest: campaign.campaignDigest,
        parentBindingDigest: bridge.parentBindingDigest,
        bridgeDigest: bridge.descriptor.bridgeDigest,
        mode: bridge.mode,
        supportedOperation: bridge.descriptor.supportedOperation,
        effectiveParentRecheckedBeforeReservationAndDispatch: true,
        fullProductionAdmissionVerified: false,
        monetaryBudgetAuthorityVerified: false,
        supportsEnforcedMode: false,
        supportsPromotion: false,
      },
    ),
  });
  COMPOSITIONS.set(composition, bridge);
  return composition;
}

function portsFor(composition) {
  const ports = COMPOSITIONS.get(composition);
  if (!ports) rrsiFail("a branded live RRSI runtime composition is required");
  return ports;
}

export function reserveRrsiRuntimePmBroadRound(composition, journal, input) {
  return portsFor(composition).reserveBroadRound(journal, input);
}

export async function executeRrsiRuntimePmBroadRound(composition, response) {
  return portsFor(composition).executeBroadRound(response);
}

/** Stale parents and off mode must not prevent existing execution reconciliation. */
export function inspectRrsiRuntimeHistory(composition) {
  return portsFor(composition).inspectHistory();
}
