import type { RiskLevel } from "@devbridge/protocol";

export interface RiskInput {
  file: string;
  /** How many other source files import/reference this file (fan-in). */
  fanIn: number;
  /** Whether the patch touches an exported symbol / public API. */
  touchesPublicApi: boolean;
  /** Whether the patch touches a shared design token file. */
  touchesSharedToken: boolean;
  /** Whether the diff appears to change control flow / state logic, not just styling. */
  touchesLogic: boolean;
  testsAffected: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

/**
 * Not a "quality score" — a concrete impact assessment (section 39).
 * Deliberately simple and legible: every contributing factor is named in
 * `reasons` so the developer (or the patch review UI) can see exactly why a
 * patch was flagged, rather than trusting an opaque number.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;

  if (input.fanIn > 20) {
    score += 3;
    reasons.push(`Used by ${input.fanIn} other files`);
  } else if (input.fanIn > 5) {
    score += 1;
    reasons.push(`Used by ${input.fanIn} other files`);
  }

  if (input.touchesPublicApi) {
    score += 2;
    reasons.push("Modifies an exported/public symbol");
  }

  if (input.touchesSharedToken) {
    score += 2;
    reasons.push("Modifies a shared design token");
  }

  if (input.touchesLogic) {
    score += 3;
    reasons.push("Changes control flow or state logic, not just styling");
  }

  if (input.testsAffected > 0) {
    reasons.push(`${input.testsAffected} test(s) cover this file`);
  } else {
    score += 1;
    reasons.push("No tests currently cover this file");
  }

  const level: RiskLevel = score >= 6 ? "high" : score >= 3 ? "medium" : "low";
  return { level, reasons };
}
