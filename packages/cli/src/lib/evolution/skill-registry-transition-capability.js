const TRANSITION_CAPABILITIES = new WeakMap();

function capabilityError(code, message) {
  const error = new Error(message);
  error.name = "SkillRegistryTransitionCapabilityError";
  error.code = code;
  return error;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw capabilityError(
        "SKILL_PROMOTION_TRANSITION_CAPABILITY_INVALID",
        "registry transition payload must contain only data fields",
      );
    }
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function issueRegistryTransitionCapability(registry, payload) {
  const capability = Object.freeze(Object.create(null));
  TRANSITION_CAPABILITIES.set(capability, {
    registry,
    payload: deepFreeze(payload),
    status: "issued",
  });
  return capability;
}

export function consumeRegistryTransitionCapability(capability, registry) {
  const state =
    capability && typeof capability === "object"
      ? TRANSITION_CAPABILITIES.get(capability)
      : null;
  if (!state || state.registry !== registry) {
    throw capabilityError(
      "SKILL_PROMOTION_TRANSITION_CAPABILITY_INVALID",
      "registry transition capability is forged or bound to another registry",
    );
  }
  if (state.status !== "issued") {
    throw capabilityError(
      "SKILL_PROMOTION_TRANSITION_CAPABILITY_REPLAYED",
      "registry transition capability has already been consumed",
    );
  }
  state.status = "consumed";
  return state.payload;
}
