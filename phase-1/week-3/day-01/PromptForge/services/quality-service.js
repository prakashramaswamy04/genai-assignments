import { ICEPOT_SECTIONS } from "../utils/constants.js";

const DIMENSIONS = [
  ["requirementCompleteness", "Requirement completeness"],
  ["technicalAccuracy", "Technical accuracy"],
  ["clarity", "Clarity"],
  ["contextSufficiency", "Context sufficiency"],
  ["exampleQuality", "Example quality"],
  ["personaSuitability", "Persona suitability"],
  ["outputSpecificity", "Output specificity"],
  ["constraintCoverage", "Constraint coverage"]
];

function findPreservationLiterals(source) {
  const values = new Set();
  const patterns = [
    /`([^`\n]{1,180})`/g,
    /"([^"\n]{2,180})"|'([^'\n]{2,180})'/g,
    /\b(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\b[A-Za-z_$][\w$]*\s*\([^\n)]{0,160}\)\s*(?:->|:\s*[\w\[\]|<> ,]+)?/g,
    /https?:\/\/[^\s"'`<>]+/g,
    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_./{}?=&%-]+/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] || match[2] || match[0];
      if (value.trim().length >= 2) values.add(value.trim());
    }
  }
  return [...values].slice(0, 100);
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

export function assessPrompt({ sections, rawQuality = {}, sourceInput = "", analysis = {} }) {
  const completenessWarnings = [];
  const prompt = ICEPOT_SECTIONS.map(({ key }) => sections?.[key] || "").join("\n\n");
  const missingSections = ICEPOT_SECTIONS.filter(({ key }) => !String(sections?.[key] || "").trim());
  if (missingSections.length) completenessWarnings.push(`Missing sections: ${missingSections.map((section) => section.title).join(", ")}.`);

  const sourceLiterals = findPreservationLiterals(sourceInput);
  const missingLiterals = sourceLiterals.filter((literal) => !prompt.includes(literal));
  if (missingLiterals.length) {
    completenessWarnings.push(`${missingLiterals.length} exact technical literal(s) detected in the source were not found verbatim in the prompt. Review: ${missingLiterals.slice(0, 8).map((item) => `\`${item}\``).join(", ")}${missingLiterals.length > 8 ? ", …" : ""}.`);
  }

  const tagCount = (prompt.match(/\[(?:STRICT|MANDATORY|IMPORTANT)\]/g) || []).length;
  if (tagCount > 6) completenessWarnings.push(`Metadata tags appear ${tagCount} times; use only the 3–6 most critical tags across the prompt.`);

  const details = Array.isArray(analysis.technicalDetails) ? analysis.technicalDetails : [];
  const explicitPreservation = details.filter((item) => item?.mustPreserve && typeof item.value === "string");
  const missingAnalyzedDetails = explicitPreservation.filter((item) => !prompt.includes(item.value));
  if (missingAnalyzedDetails.length) {
    completenessWarnings.push(`${missingAnalyzedDetails.length} analyzed technical detail(s) marked for exact preservation were not found in the prompt: ${missingAnalyzedDetails.slice(0, 8).map((item) => `\`${item.value}\``).join(", ")}.`);
  }

  const scores = {};
  for (const [key] of DIMENSIONS) {
    const value = Number(rawQuality[key]);
    scores[key] = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 50;
  }
  if (missingSections.length) scores.requirementCompleteness = Math.min(scores.requirementCompleteness, 35);
  if (missingLiterals.length || missingAnalyzedDetails.length) {
    scores.technicalAccuracy = Math.min(scores.technicalAccuracy, 45);
  }
  const overall = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / DIMENSIONS.length);

  return {
    overall,
    scores,
    dimensions: DIMENSIONS.map(([key, label]) => ({ key, label, score: scores[key] })),
    completenessAssessment: String(rawQuality.completenessAssessment || "AI-generated assessment; review the checks and unresolved items below."),
    missingInformation: asStringArray(rawQuality.missingInformation).length
      ? asStringArray(rawQuality.missingInformation)
      : asStringArray(analysis.missingInformation),
    detectedAmbiguities: asStringArray(rawQuality.detectedAmbiguities).length
      ? asStringArray(rawQuality.detectedAmbiguities)
      : asStringArray(analysis.technicalUncertainties),
    unresolvedContradictions: asStringArray(rawQuality.unresolvedContradictions).length
      ? asStringArray(rawQuality.unresolvedContradictions)
      : (Array.isArray(analysis.contradictions) ? analysis.contradictions.map((item) => `${(item.statements || []).join(" / ")}: ${item.issue || "Conflicting requirements"}`) : []),
    improvementRecommendations: asStringArray(rawQuality.improvementRecommendations),
    preservationWarnings: completenessWarnings,
    scoreDisclaimer: "AI-generated estimate supported by local structural and literal-preservation checks. It is not an objective guarantee of prompt quality."
  };
}

export function renderIcepotMarkdown(sections) {
  return ICEPOT_SECTIONS.map(({ number, title, key }) => `## ${number}. ${title}\n\n${String(sections[key] || "").trim()}`).join("\n\n---\n\n").trim() + "\n";
}

export function parseIcepotMarkdown(markdown) {
  const output = {};
  const aliases = {
    instruction: "instruction",
    context: "context",
    examples: "examples",
    persona: "persona",
    "output format": "outputFormat",
    tone: "tone"
  };
  const regex = /^##\s*(?:\d+\.\s*)?(.+?)\s*$/gm;
  const matches = [...String(markdown).matchAll(regex)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = match[1].trim().toLowerCase();
    const key = aliases[title];
    if (!key) continue;
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? String(markdown).length;
    output[key] = String(markdown).slice(start, end).replace(/^\s*---\s*$/gm, "").trim();
  }
  return output;
}
