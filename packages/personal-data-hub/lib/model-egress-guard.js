"use strict";

const MODEL_EGRESS_INGRESS_FAILED = "CC_AGENT_EVOLUTION_INGRESS_FAILED";

function rejectLegacyModelEgress() {
  const error = new Error(
    "Personal Data Hub model egress requires an authenticated Evolution ingress",
  );
  error.code = MODEL_EGRESS_INGRESS_FAILED;
  throw error;
}

module.exports = {
  MODEL_EGRESS_INGRESS_FAILED,
  rejectLegacyModelEgress,
};
