export const MODEL_EGRESS_INGRESS_FAILED = 'CC_AGENT_EVOLUTION_INGRESS_FAILED'

export function rejectLegacyModelEgress() {
  const error = new Error(
    'UniApp model egress requires an authenticated Evolution ingress',
  )
  error.code = MODEL_EGRESS_INGRESS_FAILED
  throw error
}
