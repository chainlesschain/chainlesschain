import {
  assertEvolutionDeploymentActiveTrustRoot,
  assertEvolutionDeploymentDescriptorNotRevoked,
  assertEvolutionDeploymentRevisionFloor,
  readEvolutionDeploymentProfile,
  setEvolutionDeploymentProfileEnabled,
  updateEvolutionDeploymentProfile,
} from "./evolution-deployment-profile.js";
import { verifyEvolutionDeployment } from "./evolution-deployment-loader.js";
import { verifyEvolutionDeploymentRootRotationSync } from "./evolution-deployment-root-rotation.js";
import { verifyEvolutionDeploymentDescriptorRevocationsSync } from "./evolution-deployment-descriptor-revocations.js";

function environmentSelection(env) {
  const descriptorPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR;
  const trustRootPath = env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
  if (!descriptorPath && !trustRootPath) return null;
  return { descriptorPath, trustRootPath };
}

export async function getEvolutionDeploymentStatus(options = {}) {
  const env = options.env || process.env;
  const saved = await readEvolutionDeploymentProfile(options);
  const fromEnvironment = environmentSelection(env);
  const source = fromEnvironment
    ? "environment"
    : saved.profile?.enabled
      ? "profile"
      : "none";
  const selected =
    fromEnvironment || (saved.profile?.enabled ? saved.profile : null);
  const base = {
    source,
    effectiveEnabled: source !== "none",
    profileEnabled: saved.profile?.enabled === true,
    profilePath: saved.filePath,
    activeTrustRootDigest: saved.profile?.activeTrustRootDigest || null,
    descriptorPath:
      selected?.descriptorPath || saved.profile?.descriptorPath || null,
    trustRootPath:
      selected?.trustRootPath || saved.profile?.trustRootPath || null,
    verified: false,
    error: saved.error,
    autoPromotion: "hold",
  };
  if (!selected || saved.error) return Object.freeze(base);
  try {
    const verified = await verifyEvolutionDeployment(selected, options);
    if (source === "profile")
      assertEvolutionDeploymentActiveTrustRoot(
        saved.profile,
        verified.descriptor,
      );
    if (source === "profile")
      assertEvolutionDeploymentDescriptorNotRevoked(
        saved.profile,
        verified.descriptor,
      );
    if (source === "profile")
      assertEvolutionDeploymentRevisionFloor(
        saved.profile,
        verified.descriptor,
      );
    return Object.freeze({
      ...base,
      verified: true,
      error: null,
      revision: verified.descriptor.revision,
      revisionFloor:
        saved.profile?.revisionFloors?.[verified.descriptor.trustRootDigest] ||
        null,
      modulePath: verified.modulePath,
      moduleDigest: verified.descriptor.moduleDigest,
      commands: verified.descriptor.commands,
    });
  } catch (error) {
    return Object.freeze({
      ...base,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function configureEvolutionDeployment(
  {
    descriptorPath,
    trustRootPath,
    rootRotationPath = null,
    revocationPath = null,
    enabled = true,
  },
  options = {},
) {
  const verified = await verifyEvolutionDeployment(
    { descriptorPath, trustRootPath },
    options,
  );
  updateEvolutionDeploymentProfile((current) => {
    if (
      current?.activeTrustRootDigest &&
      current.activeTrustRootDigest !== verified.descriptor.trustRootDigest
    ) {
      if (typeof rootRotationPath !== "string" || !rootRotationPath) {
        const error = new Error(
          "evolution deployment trust root rotation requires a certificate signed by the active root",
        );
        error.code = "EVOLUTION_DEPLOYMENT_ROOT_ROTATION_REQUIRED";
        throw error;
      }
      verifyEvolutionDeploymentRootRotationSync({
        rotationPath: rootRotationPath,
        fromTrustRootPath: current.trustRootPath,
        expectedFromTrustRootDigest: current.activeTrustRootDigest,
        expectedToTrustRootDigest: verified.descriptor.trustRootDigest,
        destinationRevision: verified.descriptor.revision,
      });
    }
    assertEvolutionDeploymentRevisionFloor(current, verified.descriptor);
    const receivedRevocations = revocationPath
      ? verifyEvolutionDeploymentDescriptorRevocationsSync({
          revocationPath,
          trustRootPath: verified.trustRootPath,
          expectedTrustRootDigest: verified.descriptor.trustRootDigest,
        }).revokedDescriptorRevisions
      : [];
    const priorRevocations =
      current?.revokedDescriptorRevisions?.[
        verified.descriptor.trustRootDigest
      ] || [];
    const revokedDescriptorRevisions = {
      ...(current?.revokedDescriptorRevisions || {}),
      [verified.descriptor.trustRootDigest]: [
        ...new Set([...priorRevocations, ...receivedRevocations]),
      ].sort((left, right) => left - right),
    };
    assertEvolutionDeploymentDescriptorNotRevoked(
      { revokedDescriptorRevisions },
      verified.descriptor,
    );
    const revisionFloors = {
      ...(current?.revisionFloors || {}),
      [verified.descriptor.trustRootDigest]: Math.max(
        current?.revisionFloors?.[verified.descriptor.trustRootDigest] || 0,
        verified.descriptor.revision,
      ),
    };
    return {
      enabled: enabled === true,
      descriptorPath: verified.descriptorPath,
      trustRootPath: verified.trustRootPath,
      revisionFloors,
      activeTrustRootDigest: verified.descriptor.trustRootDigest,
      revokedDescriptorRevisions,
    };
  }, options);
  return getEvolutionDeploymentStatus(options);
}

export async function setEvolutionDeploymentEnabled(enabled, options = {}) {
  await setEvolutionDeploymentProfileEnabled(enabled, options);
  return getEvolutionDeploymentStatus(options);
}

export function revokeEvolutionDeploymentDescriptorRevisions(
  { revocationPath },
  options = {},
) {
  updateEvolutionDeploymentProfile((current) => {
    if (!current?.activeTrustRootDigest)
      throw new Error("evolution deployment profile is not configured");
    const record = verifyEvolutionDeploymentDescriptorRevocationsSync({
      revocationPath,
      trustRootPath: current.trustRootPath,
      expectedTrustRootDigest: current.activeTrustRootDigest,
    });
    const prior =
      current.revokedDescriptorRevisions?.[current.activeTrustRootDigest] ||
      [];
    return {
      ...current,
      // Disabling is conservative: the current descriptor may be one of the
      // newly revoked revisions, and it must not remain executable while the
      // caller is recovering or selecting a replacement.
      enabled: false,
      revokedDescriptorRevisions: {
        ...(current.revokedDescriptorRevisions || {}),
        [current.activeTrustRootDigest]: [
          ...new Set([...prior, ...record.revokedDescriptorRevisions]),
        ].sort((left, right) => left - right),
      },
    };
  }, options);
  return getEvolutionDeploymentStatus(options);
}
