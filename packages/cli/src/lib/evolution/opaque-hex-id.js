const OPAQUE_HEX_GROUP_LENGTH = 8;

export function formatOpaqueHexId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]+$/u.test(value)) {
    throw new TypeError(
      "Opaque ID must be a non-empty lowercase hexadecimal string",
    );
  }

  const groups = [];
  for (
    let offset = 0;
    offset < value.length;
    offset += OPAQUE_HEX_GROUP_LENGTH
  ) {
    groups.push(value.slice(offset, offset + OPAQUE_HEX_GROUP_LENGTH));
  }
  return groups.join("-");
}

// Keep every hexadecimal nibble while preventing generated identifiers from
// resembling payment-card or phone numbers across their group separators.
export function encodeOpaqueHexId(value) {
  return formatOpaqueHexId(value).replace(/[0-9]/gu, (digit) =>
    String.fromCharCode(103 + Number(digit)),
  );
}

export function formatLocalUiTenantReferenceId(value) {
  const prefix = "local-ui-";
  if (typeof value !== "string" || !value.startsWith(prefix)) return value;

  const hex = value.slice(prefix.length).replaceAll("-", "");
  if (!/^[a-f0-9]{32}$/u.test(hex)) return value;
  return `${prefix}${formatOpaqueHexId(hex)}`;
}
