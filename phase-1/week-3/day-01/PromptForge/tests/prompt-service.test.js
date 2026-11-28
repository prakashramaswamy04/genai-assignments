import test from "node:test";
import assert from "node:assert/strict";
import { PromptService } from "../services/prompt-service.js";
import { DEFAULT_SETTINGS } from "../utils/constants.js";

const originalFetch = globalThis.fetch;
const analysis = {
  mainObjective: "Create an email validator.",
  inputType: "technical_requirements",
  explicitRequirements: ["Create validate_email(email: str) -> bool"],
  technicalDetails: [{ type: "function", value: "validate_email(email: str) -> bool", mustPreserve: true }],
  missingInformation: [],
  contradictions: [],
  reasonableInferences: [],
  clarificationQuestions: []
};
const generation = {
  sections: {
    instruction: "Implement `validate_email(email: str) -> bool`.",
    context: "Use the supplied Python context.",
    examples: "Include grounded valid and invalid cases.",
    persona: "Senior Python developer.",
    outputFormat: "Return implementation and tests.",
    tone: "Precise and technical."
  },
  quality: {
    requirementCompleteness: 90, technicalAccuracy: 95, clarity: 90, contextSufficiency: 80,
    exampleQuality: 80, personaSuitability: 90, outputSpecificity: 85, constraintCoverage: 85,
    completenessAssessment: "Complete for the supplied requirements.",
    missingInformation: [], detectedAmbiguities: [], unresolvedContradictions: [], improvementRecommendations: []
  }
};

test("generation analyzes first, then returns complete ICEPOT and quality result", async () => {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const content = requests.length === 1 ? JSON.stringify(analysis) : JSON.stringify(generation);
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: requests.length === 1 ? 200 : 100, completion_tokens: requests.length === 1 ? 30 : 40 }
    }), { status: 200 });
  };
  try {
    const service = new PromptService({ ...DEFAULT_SETTINGS }, "test-key");
    const stages = [];
    const result = await service.generate("Create `validate_email(email: str) -> bool`.", { inputType: "technical_requirements", onStage: (stage) => stages.push(stage) });
    assert.equal(requests.length, 2);
    assert.deepEqual(stages, ["analysis", "generation"]);
    assert.equal(result.analysis.inputType, "technical_requirements");
    assert.equal(result.sections.persona, generation.sections.persona);
    assert.match(result.markdown, /## 6\. Tone/);
    assert.equal(result.quality.dimensions.length, 8);
    assert.equal(result.usage.inputTokens, 300);
    assert.equal(result.usage.outputTokens, 70);
    assert.equal(result.usage.requestCount, 2);
    assert.equal(result.usage.cost, 0.000232);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generation rejects an incomplete model response instead of fabricating sections", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    const content = requestCount === 1 ? JSON.stringify(analysis) : JSON.stringify({ sections: { instruction: "Only one section" } });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  try {
    const service = new PromptService({ ...DEFAULT_SETTINGS }, "test-key");
    await assert.rejects(service.generate("Create a validator."), /did not contain all six ICEPOT sections/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("analysis caps clarification questions and normalizes contradictions", async () => {
  const manyQuestions = {
    ...analysis,
    clarificationQuestions: ["Question 1", "Question 2", "Question 3", "Question 4"],
    technicalDetails: ["`legacy_id`"],
    contradictions: [{ statements: ["Use React", "Use vanilla JavaScript"], issue: "Conflicting framework requirements" }]
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(manyQuestions) } }] }), { status: 200 });
  try {
    const service = new PromptService({ ...DEFAULT_SETTINGS }, "test-key");
    const result = await service.analyze("Use React and vanilla JavaScript.");
    assert.equal(result.clarificationQuestions.length, 3);
    assert.deepEqual(result.contradictions[0].statements, ["Use React", "Use vanilla JavaScript"]);
    assert.equal(result.technicalDetails[0].value, "`legacy_id`");
  } finally { globalThis.fetch = originalFetch; }
});

