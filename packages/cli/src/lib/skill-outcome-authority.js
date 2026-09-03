import {
  buildSkillOutcomeIndexAuthority,
  unavailableSkillOutcomeIndexAuthority,
} from "./evolution/skill-outcome-index-authority.js";
import {
  buildSkillOutcomeTranscriptAuthority,
  unavailableSkillOutcomeTranscriptAuthority,
} from "./skill-outcome-transcript-authority.js";

export function resolveSkillOutcomeAuthority(options = {}, dependencies = {}) {
  if (
    options &&
    typeof options === "object" &&
    Object.prototype.hasOwnProperty.call(options, "index")
  ) {
    const buildIndex =
      dependencies.buildSkillOutcomeIndexAuthority ||
      buildSkillOutcomeIndexAuthority;
    const unavailableIndex =
      dependencies.unavailableSkillOutcomeIndexAuthority ||
      unavailableSkillOutcomeIndexAuthority;
    try {
      return buildIndex(options.index, dependencies.indexDependencies);
    } catch (error) {
      return unavailableIndex(error);
    }
  }

  const buildTranscript =
    dependencies.buildSkillOutcomeTranscriptAuthority ||
    buildSkillOutcomeTranscriptAuthority;
  const unavailableTranscript =
    dependencies.unavailableSkillOutcomeTranscriptAuthority ||
    unavailableSkillOutcomeTranscriptAuthority;
  try {
    return buildTranscript(
      options?.transcriptOptions,
      dependencies.transcriptDependencies,
    );
  } catch (error) {
    return unavailableTranscript(error);
  }
}
