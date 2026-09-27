const HASH = /^[a-f0-9]{64}$/u;
const hash = (value) => typeof value === "string" && HASH.test(value);

/**
 * Display association only. Message writers return a synchronous append receipt,
 * not the event body. The caller determines the role from the writer it invoked;
 * consumers still need the history reader's full chain/anchor verification.
 */
export function transcriptMessageEventId(receipt) {
  if (!receipt || receipt.commitState !== "committed" || !hash(receipt.hash))
    return null;
  return receipt.hash;
}

export function transcriptResultReferences({
  sessionId,
  userEventId = null,
  assistantEventId = null,
  clientMessageId = null,
}) {
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.length > 256 ||
    !hash(assistantEventId)
  )
    return null;
  return {
    schema: "chainlesschain.session-transcript-references/v1",
    sessionId,
    assistantEventId,
    ...(hash(userEventId) ? { userEventId } : {}),
    ...(typeof clientMessageId === "string" &&
    /^[a-zA-Z0-9_-]{1,80}$/u.test(clientMessageId)
      ? { clientMessageId }
      : {}),
  };
}
