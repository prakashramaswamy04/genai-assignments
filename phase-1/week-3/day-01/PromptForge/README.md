# PromptForge — ICEPOT Prompt Engineer

PromptForge is a local-first Google Chrome extension that turns rough ideas, existing prompts, code snippets, bug reports, and technical specifications into structured, copy-ready prompts using the six-part ICEPOT framework.

It is designed as a prompt-engineering workspace rather than a basic text-to-text wrapper: it analyzes requirements before drafting, separates stated facts from inferences, flags gaps and contradictions, scores prompt quality, and keeps a versioned prompt library.

## Features

- **Two-stage generation:** AI requirement analysis followed by ICEPOT prompt drafting.
- **Technical preservation:** extraction and local checks for identifiers, code literals, signatures, API URLs, and routes; possible omissions are surfaced for review.
- **Ambiguity handling:** explicit requirements, inferences, missing details, contradictions, and up to three blocking clarification questions.
- **Six ICEPOT sections:** Instruction, Context, Examples, Persona, Output Format, and Tone.
- **Quality analysis:** eight AI-scored dimensions plus local structural and exact-literal checks.
- **AI usage tracking:** shows input/output tokens used across both generation requests and estimates USD cost for supported models; usage is saved with each generated version.
- **Version history:** generated prompts and manual edits are stored as separate versions.
- **Copy and export:** copy the full prompt or individual sections; download Markdown.
- **History management:** search, reopen, rename, delete, and compare versions.
- **Configurable AI providers:** OpenAI-compatible Chat Completions, Groq, Anthropic Messages, and Google Gemini `generateContent` adapters.
- **Privacy-conscious permissions:** no access to browsing history, webpage contents, or tabs beyond opening the workspace. The extension requests host access for the configured API origin when the user tests or runs a request.

## ICEPOT framework

| Section | Purpose |
|---|---|
| **Instruction** | The task, steps, functional and technical requirements, constraints, edge cases, and acceptance criteria. |
| **Context** | Background, environment, stack, existing implementation, schemas, and assumptions. |
| **Examples** | Grounded sample inputs/outputs, valid and invalid cases, and edge cases where supported. |
| **Persona** | The most useful expert role for the task. |
| **Output Format** | Exact deliverables, file structure, data format, and presentation requirements. |
| **Tone** | Communication style and level of detail. |

## Project structure

```text
PromptForge/
├── manifest.json
├── background.js
├── package.json
├── README.md
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   ├── usage.css
│   └── dashboard.js
├── services/
│   ├── ai-service.js
│   ├── prompt-service.js
│   ├── quality-service.js
│   ├── storage-service.js
│   └── usage-service.js
├── utils/
│   ├── constants.js
│   ├── helpers.js
│   └── validators.js
├── prompts/
│   └── icepot-system-prompt.js
├── assets/
│   └── icons/
└── tests/
    ├── ai-service.test.js
    ├── prompt-service.test.js
    ├── quality-service.test.js
    ├── usage-service.test.js
    └── validators.test.js
```

## Installation in Chrome

1. Download or clone this project folder and extract it if needed.
2. Open `chrome://extensions` in Google Chrome.
3. Turn on **Developer mode**.
4. Select **Load unpacked**.
5. Choose the `PromptForge` project folder (the folder containing `manifest.json`).
6. Pin the PromptForge extension from Chrome's Extensions menu for convenient access.
7. Open PromptForge, choose **Settings**, configure your AI provider, and save an API key.
8. Select **Test connection**. Chrome will ask for permission to connect to the configured API host; grant it to continue.

The popup opens the full workspace in a new tab. The project uses no build step and no runtime package dependencies.

## AI provider configuration

### OpenAI-compatible API

- Default endpoint: `https://api.openai.com/v1/chat/completions`
- Authentication: `Authorization: Bearer <API_KEY>`
- Request format: Chat Completions with JSON response format and `max_completion_tokens`.
- Model: configurable (the default is `gpt-4.1-mini`; availability depends on the API account).

Compatible gateways may work when they implement the Chat Completions request/response shape and JSON response format.

### Groq API

- Default endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Authentication: `Authorization: Bearer <API_KEY>`
- Request format: OpenAI-compatible Chat Completions with JSON response format and `max_tokens`.
- Model: configurable (for example, `llama-3.3-70b-versatile`; availability depends on the Groq account).

### Anthropic Messages API

- Default endpoint: `https://api.anthropic.com/v1/messages`
- Authentication: `x-api-key` and `anthropic-version` headers.
- Browser requests include Anthropic's direct-browser-access header. Direct browser calls may still be blocked for organizations with Zero Data Retention, Compliance API, or certain inherited organization settings.
- Model: configurable; use a model enabled for the API account.

### Google Gemini API

- Default endpoint template: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- The `{model}` placeholder is replaced with the configured model.
- Authentication: `x-goog-api-key` request header; the key is not added to the endpoint URL.
- Model: configurable; use a model enabled for the API key.

### Custom endpoint and host access

The endpoint must be an absolute URL. Remote endpoints must use HTTPS. Plain HTTP is accepted only for `localhost` and `127.0.0.1`. Do not put a key in the endpoint URL. PromptForge requests optional host access for that origin when the user runs a connection test or generation action. The permission is limited to the endpoint origin rather than granting access to every site in the browser.

### API key storage

- **Remember on this browser:** stores the key in `chrome.storage.local` until it is removed.
- **Session only:** stores the key in `chrome.storage.session`, which is cleared when the browser session ends.
- The extension never intentionally logs or exports credentials and does not add them to generated prompt content.
- Chrome extension storage is not a dedicated hardware-backed or encrypted secrets vault. Use a key with narrow permissions and appropriate usage limits. Remove it from Settings when no longer needed.

## Generation workflow

1. **Source input:** Paste rough thoughts, an existing prompt, project requirements, a bug report, or code. Select an input type or leave Auto-detect enabled.
2. **Requirement analysis:** The AI extracts explicit requirements, technical details, business rules, constraints, existing implementation context, reasonable inferences, missing information, contradictions, and uncertainties.
3. **ICEPOT drafting:** The second AI request builds all six sections and returns an initial quality assessment.
4. **Usage tracking:** PromptForge totals provider-reported tokens from both requests and displays an estimated cost when the model has a known standard rate. Custom endpoints, unknown models, and providers that omit usage may not have a cost or token total. Rates are estimates and actual billing can vary.
5. **Quality checks:** PromptForge computes an average across eight model-provided quality dimensions, then caps selected dimensions when structural omissions or exact-literal mismatches are detected locally.
6. **Review:** Edit the Markdown, inspect the analysis and quality findings, and copy the full prompt or an individual section.
7. **Versioning:** A generated prompt or manual edit is saved as a separate version. Earlier versions are not silently overwritten.
8. **Export:** Download the current prompt as a Markdown `.md` file.

## Quality analysis

The score contains these dimensions (0–100):

- Requirement completeness
- Technical accuracy
- Clarity
- Context sufficiency
- Example quality
- Persona suitability
- Output specificity
- Constraint coverage

The overall score is the arithmetic mean of those eight dimension scores after local caps for missing ICEPOT sections and detected exact-literal omissions. The assessment also presents missing information, ambiguities, contradictions, recommendations, and preservation warnings.

**Important:** AI scoring is an estimate, not an objective guarantee. Exact-literal checks are heuristic and cannot prove semantic equivalence or catch every changed technical detail. Review important outputs manually.

## Data storage and limits

- Prompt history and settings use `chrome.storage.local`.
- API keys use local or session storage according to the selected preference.
- History is capped at 100 prompt records and approximately 4 MiB of serialized prompt data (to leave headroom under Chrome's local-storage quota). Each record keeps up to 30 versions; if the byte cap is reached, the oldest versions are pruned first and the oldest prompt records are removed only when necessary.
- Input is limited to 50,000 characters; generated output is limited to 100,000 characters.
- No backend service is required. AI requests are sent directly from the extension page to the provider after an explicit user action.
- Prompt data is not synchronized to a PromptForge server. Browser profile sync behavior is governed by Chrome and account settings; this extension itself uses `chrome.storage.local`.

## Tests and development checks

Requires Node.js 20 or later for the built-in `node:test` test runner (the extension itself does not need Node at runtime).

```bash
npm test
npm run check
```

The tests cover validators, JSON parsing/provider request handling, two-stage prompt generation with mocked model responses, ICEPOT Markdown parsing, scoring, and exact-literal warnings. No live provider call is made by the test suite.

## Known limitations

- The extension has been implemented and statically/unit tested in a local environment; a real Chrome install and live provider request still need to be verified in your own Chrome profile and with your API account.
- Provider APIs and model availability can change. Ensure the configured endpoint and model match the provider's current API documentation.
- OpenAI-compatible providers must return the expected Chat Completions response shape. Non-compatible custom APIs require a provider adapter.
- The UI edits the complete Markdown document. All six `##` headings must remain present when saving a manual edit so PromptForge can map the text back into sections.
- Quality scores and technical-preservation detection are heuristic. They should guide review, not replace code review, tests, or domain expertise.
- Session-only storage depends on Chrome's `storage.session` support.
- Browser-side API access means provider CORS policy and extension host permission must both allow the request.

## Troubleshooting

**Connection test fails with host access denied**

Retry the connection test and grant the requested API origin. You can also inspect the extension's Site access setting from `chrome://extensions`.

**Could not reach AI endpoint**

Check the endpoint spelling, provider model, internet connection, provider CORS support, and host permission. Remote endpoints must use HTTPS.

**Unauthorized / invalid API key**

Confirm the key is active for the selected provider and that it has permission to use the configured model. Re-enter and save the key in Settings.

**Malformed JSON response**

PromptForge requires structured JSON from the model. Try a model that follows JSON instructions more reliably, increase the output-token limit, or use a provider endpoint that supports JSON output.

**Prompt is cut off or rejected**

Reduce the source size, increase the token limit within the provider's supported maximum, or choose a model with a larger output allowance.

**Extension changes do not appear**

Open `chrome://extensions`, select the PromptForge reload button, and refresh the PromptForge workspace tab.

## Security notes

- Manifest V3 extension pages use a local-script-only policy; no remote JavaScript is loaded.
- Model output is inserted into the UI using `textContent` or form values, not interpreted as HTML.
- The extension does not request browser history, active-tab content, or webpage access.
- Fetch requests omit cookies and reject redirects.
- Do not paste secrets into source material unless the selected AI provider is authorized to process that data.
