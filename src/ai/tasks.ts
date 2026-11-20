import {
  AIError,
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
  type HybridParams,
  type Part,
  type ThinkingLevel,
} from "firebase/ai";
import { aiService, rcBool, rcNumber, rcString } from "../firebase/app";
import { ENTITY_TYPES, type Detection } from "../shield/types";
import { IMAGE_IO, TEXT_IO } from "./device";
import { ledger, TIER_INFO, type Tier, type Where } from "./ledger";

/*
 * Airlock's core idea: the inference mode is a privacy policy.
 *
 *   Tier               Mode               Sees                    Used for
 *   device-only        ONLY_ON_DEVICE     your unredacted letter  shield scan, image reading, private Q&A, instant gist
 *   redacted-safe      PREFER_ON_DEVICE   redacted text only      question routing, jargon explainer
 *   cloud-strength     PREFER_IN_CLOUD    redacted text only      deep analysis, reply drafting (Nano fallback offline)
 *   consented-cloud    ONLY_IN_CLOUD      what you approved       reading a photo when no on-device model exists
 */

const MODE_BY_TIER: Record<Tier, HybridParams["mode"]> = {
  "device-only": InferenceMode.ONLY_ON_DEVICE,
  "redacted-safe": InferenceMode.PREFER_ON_DEVICE,
  "cloud-strength": InferenceMode.PREFER_IN_CLOUD,
  "consented-cloud": InferenceMode.ONLY_IN_CLOUD,
};

const ON_DEVICE_LANGS = new Set(["en", "es", "ja"]);

interface ModelSpec {
  tier: Tier;
  cloudModel?: "cloud_model" | "fast_cloud_model";
  schema?: object;
  enumValues?: string[];
  image?: boolean;
  outputLang?: string;
  temperature?: number;
}

const cache = new Map<string, GenerativeModel>();

function thinking(key: "thinking_level" | "fast_thinking_level") {
  const level = rcString(key);
  return level ? { thinkingConfig: { thinkingLevel: level as ThinkingLevel } } : {};
}

function model(spec: ModelSpec): GenerativeModel {
  const key = JSON.stringify(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  const io = spec.image ? IMAGE_IO : TEXT_IO;
  const lang = spec.outputLang && ON_DEVICE_LANGS.has(spec.outputLang) ? spec.outputLang : "en";
  const enumSchema = spec.enumValues ? { type: "string", enum: spec.enumValues } : undefined;
  const constraint = spec.schema ?? enumSchema;
  const m = getGenerativeModel(aiService(), {
    mode: MODE_BY_TIER[spec.tier],
    inCloudParams: {
      model: rcString(spec.cloudModel ?? "cloud_model"),
      generationConfig: {
        temperature: spec.temperature ?? 0.3,
        // Latency matters to a stressed reader; tunable live via Remote Config ("" = model default).
        ...thinking(spec.cloudModel === "fast_cloud_model" ? "fast_thinking_level" : "thinking_level"),
        ...(spec.schema ? { responseMimeType: "application/json", responseSchema: spec.schema as never } : {}),
        ...(enumSchema ? { responseMimeType: "text/x.enum", responseSchema: enumSchema as never } : {}),
      },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: io.expectedInputs,
        expectedOutputs: [{ type: "text", languages: [lang] }],
      },
      ...(constraint ? { promptOptions: { responseConstraint: constraint } } : {}),
    },
  });
  cache.set(key, m);
  return m;
}

/** Call once from a click handler: starts (or resumes) the Gemini Nano download. */
export async function initializeDevice(onProgress: (p: number) => void, withImages: boolean): Promise<void> {
  await model({ tier: "device-only", image: withImages }).initializeDeviceModel(onProgress);
}

export class DeviceUnavailableError extends Error {
  constructor(task: string) {
    super(`${task} needs Gemini Nano, which isn't available in this browser. Nothing was sent anywhere.`);
  }
}

function whereOf(src: string | undefined): Where {
  return src === InferenceSource.ON_DEVICE ? "on_device" : "in_cloud";
}

function promptText(prompt: string | Array<string | Part>): string {
  if (typeof prompt === "string") return prompt;
  return prompt.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "[image]")).join("\n");
}

/** Run one non-streaming call through the ledger. */
async function call(task: string, spec: ModelSpec, prompt: string | Array<string | Part>): Promise<{ text: string; where: Where }> {
  const t0 = performance.now();
  try {
    const res = await model(spec).generateContent(prompt);
    const where = whereOf(res.response.inferenceSource);
    ledger.add({
      task,
      tier: spec.tier,
      mode: TIER_INFO[spec.tier].mode,
      where,
      ms: Math.round(performance.now() - t0),
      outbound: where === "in_cloud" ? promptText(prompt) : undefined,
    });
    return { text: res.response.text(), where };
  } catch (e) {
    return fail(task, spec, t0, e);
  }
}

/** Streaming variant: yields text as it arrives, records the ledger entry at the end. */
async function* stream(task: string, spec: ModelSpec, prompt: string): AsyncGenerator<{ delta: string; where: Where }> {
  const t0 = performance.now();
  let where: Where = "in_cloud";
  try {
    const res = await model(spec).generateContentStream(prompt);
    for await (const chunk of res.stream) {
      where = whereOf(chunk.inferenceSource);
      yield { delta: chunk.text(), where };
    }
    ledger.add({
      task,
      tier: spec.tier,
      mode: TIER_INFO[spec.tier].mode,
      where,
      ms: Math.round(performance.now() - t0),
      outbound: where === "in_cloud" ? prompt : undefined,
    });
  } catch (e) {
    fail(task, spec, t0, e);
  }
}

function fail(task: string, spec: ModelSpec, t0: number, e: unknown): never {
  const deviceMissing =
    spec.tier === "device-only" && e instanceof AIError && /on-device|LanguageModel|not available/i.test(e.message);
  ledger.add({
    task,
    tier: spec.tier,
    mode: TIER_INFO[spec.tier].mode,
    where: deviceMissing ? "blocked" : "failed",
    ms: Math.round(performance.now() - t0),
    note: deviceMissing ? "Gemini Nano unavailable: step skipped, nothing left the device" : String((e as Error)?.message ?? e).slice(0, 200),
  });
  if (deviceMissing) throw new DeviceUnavailableError(task);
  throw e;
}

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(cleaned) as T;
}

/* ------------------------------------------------------------------ */
/* Tier 1: device-only (sees the real letter)                           */
/* ------------------------------------------------------------------ */

const SHIELD_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...ENTITY_TYPES] },
          text: { type: "string" },
        },
        required: ["type", "text"],
      },
    },
  },
  required: ["entities"],
};

function chunk(text: string, max: number): string[] {
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max) {
      out.push(cur);
      cur = "";
    }
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Gemini Nano reads the letter and lists personal details the rules can't catch
 * (unlabeled names, free-form addresses, health details). Runs ONLY_ON_DEVICE.
 */
export async function deviceShieldScan(text: string, onChunk?: (i: number, n: number) => void): Promise<Detection[]> {
  if (!rcBool("device_shield_enabled")) return [];
  const parts = chunk(text, rcNumber("device_chunk_chars"));
  const found: Detection[] = [];
  for (let i = 0; i < parts.length; i++) {
    onChunk?.(i, parts.length);
    const prompt = `You are a privacy filter. List every piece of personal information in the TEXT below.
Types:
- PERSON: names of people (patients, tenants, staff, agents, doctors)
- ADDRESS: street addresses, cities with ZIP codes, PO boxes, unit numbers
- EMAIL, PHONE
- GOV_ID: SSN, tax IDs, passport, driver's license, Medicare numbers
- ACCOUNT: account, member, policy, claim, case, lease, invoice or reference numbers
- FINANCIAL: card numbers, bank account or routing numbers, last-4 digits of cards
- DOB: dates of birth
- ORG: names of companies, hospitals, agencies, landlords
- HEALTH: diagnoses, conditions, body parts, medications, procedures
Copy each item EXACTLY as written in the text. Do not list money amounts or ordinary dates. Return an empty list if none.

TEXT:
"""
${parts[i]}
"""`;
    const { text: out } = await call("Shield scan", { tier: "device-only", schema: SHIELD_SCHEMA, temperature: 0 }, prompt);
    try {
      const { entities } = parseJson<{ entities: Array<{ type: string; text: string }> }>(out);
      for (const e of entities ?? []) {
        if (!e?.text || !(ENTITY_TYPES as readonly string[]).includes(e.type)) continue;
        found.push({ type: e.type as Detection["type"], text: e.text.trim(), start: -1, end: -1, source: "device" });
      }
    } catch {
      // A malformed chunk just means fewer device findings; rules still cover it.
    }
  }
  return found;
}

/** Read a photo of a letter. ONLY_ON_DEVICE by default; ONLY_IN_CLOUD only with explicit consent. */
export async function* transcribeImage(image: { data: string; mimeType: string }, consentToCloud: boolean) {
  const spec: ModelSpec = { tier: consentToCloud ? "consented-cloud" : "device-only", image: true, temperature: 0 };
  const t0 = performance.now();
  const prompt: Array<string | Part> = [
    "Transcribe all of the text in this image of a letter exactly as written. Preserve line breaks. Output only the text.",
    { type: "inlineData", inlineData: image } as Part,
  ];
  try {
    const res = await model(spec).generateContentStream(prompt);
    let where: Where = "on_device";
    for await (const c of res.stream) {
      where = whereOf(c.inferenceSource);
      yield c.text();
    }
    ledger.add({
      task: "Read photo",
      tier: spec.tier,
      mode: TIER_INFO[spec.tier].mode,
      where,
      ms: Math.round(performance.now() - t0),
      outbound: where === "in_cloud" ? "[the photo you uploaded, sent with your consent]" : undefined,
    });
  } catch (e) {
    fail("Read photo", spec, t0, e);
  }
}

/** A two-sentence gist from the real letter, instantly and privately. */
export async function privateGist(original: string): Promise<string> {
  const { text } = await call(
    "Instant gist",
    { tier: "device-only", temperature: 0.2 },
    `In two short, plain sentences: what is this letter, and what does it want the reader to do? Mention the key amount and deadline if any.

LETTER:
"""
${original}
"""`,
  );
  return text.trim();
}

/** Answer a question from the real letter, entirely on-device. */
export function answerPrivately(original: string, question: string) {
  return stream(
    "Private answer",
    { tier: "device-only", temperature: 0.2 },
    `Answer the QUESTION using only the LETTER. Reply in 1-3 plain sentences. If the letter doesn't say, say so.

LETTER:
"""
${original}
"""

QUESTION: ${question}`,
  );
}

/* ------------------------------------------------------------------ */
/* Tier 2: redacted-safe (PREFER_ON_DEVICE)                             */
/* ------------------------------------------------------------------ */

export type Route = "letter_lookup" | "needs_expertise";

/** Decide where a (redacted) question should be answered. */
export async function routeQuestion(redactedQuestion: string): Promise<{ route: Route; where: Where }> {
  const { text, where } = await call(
    "Route question",
    { tier: "redacted-safe", cloudModel: "fast_cloud_model", enumValues: ["letter_lookup", "needs_expertise"], temperature: 0 },
    `Classify the user's question about a letter they received.
letter_lookup: can be answered just by reading the letter (what it says, amounts, dates, numbers, who sent it, what a line means).
needs_expertise: needs outside knowledge or judgment (rights, laws, strategy, negotiation, whether it's fair or a scam, what to write back).

QUESTION: ${redactedQuestion}`,
  );
  const route = text.trim().replace(/"/g, "") === "letter_lookup" ? "letter_lookup" : "needs_expertise";
  return { route, where };
}

/** Plain-language definition of a jargon term. The term carries no personal data. */
export async function explainTerm(term: string, docType: string, lang: string): Promise<{ text: string; where: Where }> {
  return call(
    "Explain term",
    { tier: "redacted-safe", cloudModel: "fast_cloud_model", outputLang: lang, temperature: 0.2 },
    `Explain "${term}" in one or two plain sentences for someone reading a ${docType}. Language: ${langName(lang)}.`,
  );
}

/* ------------------------------------------------------------------ */
/* Tier 3: cloud-strength (PREFER_IN_CLOUD, redacted only)              */
/* ------------------------------------------------------------------ */

export interface Analysis {
  docType: string;
  sender: string;
  headline: string;
  summary: string;
  urgency: "low" | "medium" | "high" | "critical";
  deadlines: Array<{ date: string; isoDate?: string; what: string; ifMissed?: string }>;
  money: Array<{ label: string; amount: string; note?: string }>;
  actions: Array<{ step: string; why?: string; when: "now" | "this week" | "before deadline" | "optional" }>;
  options: string[];
  questions: string[];
  redFlags: string[];
  scamRisk: "low" | "medium" | "high";
  jargon: Array<{ term: string; meaning: string }>;
  replyGoals: string[];
}

const S = { type: "string" };
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    docType: S,
    sender: S,
    headline: S,
    summary: S,
    urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
    deadlines: {
      type: "array",
      items: { type: "object", properties: { date: S, isoDate: S, what: S, ifMissed: S }, required: ["date", "what"] },
    },
    money: { type: "array", items: { type: "object", properties: { label: S, amount: S, note: S }, required: ["label", "amount"] } },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { step: S, why: S, when: { type: "string", enum: ["now", "this week", "before deadline", "optional"] } },
        required: ["step", "when"],
      },
    },
    options: { type: "array", items: S },
    questions: { type: "array", items: S },
    redFlags: { type: "array", items: S },
    scamRisk: { type: "string", enum: ["low", "medium", "high"] },
    jargon: { type: "array", items: { type: "object", properties: { term: S, meaning: S }, required: ["term", "meaning"] } },
    replyGoals: { type: "array", items: S },
  },
  required: ["docType", "sender", "headline", "summary", "urgency", "deadlines", "money", "actions", "options", "questions", "redFlags", "scamRisk", "jargon", "replyGoals"],
};

export const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "zh", name: "中文" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "tl", name: "Tagalog" },
  { code: "ar", name: "العربية" },
  { code: "hi", name: "हिन्दी" },
  { code: "ja", name: "日本語" },
  { code: "fr", name: "Français" },
  { code: "pt", name: "Português" },
];
export const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? "English";

const PRIVACY_RULES = `PRIVACY: The user's device replaced personal details with placeholders like [PERSON_1], [ADDRESS_2] or [ACCOUNT_1]. Treat them as opaque labels. Copy a placeholder exactly when you need to refer to that detail. Never guess, invent or ask for the real values.`;

const today = () => new Date().toISOString().slice(0, 10);

export async function analyzeLetter(outbound: string, lang: string): Promise<{ analysis: Analysis; where: Where }> {
  const allowDevice = rcBool("offline_device_analysis");
  const spec: ModelSpec = { tier: allowDevice ? "cloud-strength" : "consented-cloud", schema: ANALYSIS_SCHEMA, outputLang: lang };
  const { text, where } = await call(
    "Analyze letter",
    spec,
    `You are Airlock, a calm, plain-spoken advocate who helps people understand official letters (medical bills, insurance, housing, government, debt collection) and decide what to do next.

${PRIVACY_RULES}

Today is ${today()}. Write every text field in ${langName(lang)}, at a 6th-grade reading level, for a stressed reader.
- Be specific to THIS letter: quote its amounts, dates, codes and deadlines. No generic filler.
- headline: one sentence, what this means for the reader. summary: 2-4 sentences.
- deadlines: every date the reader must act by; add isoDate (YYYY-MM-DD) when it can be worked out, and what happens if missed.
- actions: concrete next steps in order, each with when.
- options: rights, programs or choices the reader has (e.g. appeals, financial assistance, payment plans, legal aid).
- questions: what the reader should ask the sender.
- redFlags: anything wrong, unusual or suspicious. scamRisk "high" for classic scam signs (gift cards, arrest threats, secrecy, unofficial email).
- jargon: up to 6 terms from the letter a layperson may not know.
- replyGoals: 2-4 short goals a reply letter could pursue (e.g. "Request an itemized bill").

LETTER (redacted on the user's device):
"""
${outbound}
"""`,
  );
  return { analysis: parseJson<Analysis>(text), where };
}

export function draftReply(outbound: string, analysis: Analysis, goal: string, lang: string) {
  return stream(
    "Draft reply",
    { tier: rcBool("offline_device_analysis") ? "cloud-strength" : "consented-cloud", outputLang: lang, temperature: 0.4 },
    `Write a short, firm, polite reply letter for the person who RECEIVED the letter below.
Goal: ${goal}
${PRIVACY_RULES}
Use placeholders for the sender's own details (their name, address, account numbers), e.g. sign it with the recipient's [PERSON_n] placeholder. Reference specific facts from the letter. Date the letter ${today()}. Language: ${langName(lang)}. Output only the letter text, no commentary, no markdown.

Context: ${analysis.headline}

LETTER (redacted):
"""
${outbound}
"""`,
  );
}

export function answerInCloud(outbound: string, analysis: Analysis | undefined, redactedQuestion: string, history: string, lang: string) {
  return stream(
    "Expert answer",
    { tier: rcBool("offline_device_analysis") ? "cloud-strength" : "consented-cloud", outputLang: lang, temperature: 0.3 },
    `You are Airlock, a plain-spoken advocate. Answer the user's QUESTION about the letter below in ${langName(lang)}, in under 150 words, with concrete steps where useful. Note when something depends on their state or country. Plain text only: no markdown, no asterisks; use short numbered lines for steps.
${PRIVACY_RULES}
${analysis ? `\nWhat we know: ${analysis.headline} ${analysis.summary}` : ""}
${history ? `\nEarlier in this conversation:\n${history}` : ""}

LETTER (redacted):
"""
${outbound}
"""

QUESTION: ${redactedQuestion}`,
  );
}
