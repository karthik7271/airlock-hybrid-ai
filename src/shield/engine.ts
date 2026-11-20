import { detectWithRules } from "./rules";
import {
  ENTITY_TYPES,
  IDENTITY_TYPES,
  type Detection,
  type DetectionSource,
  type Entity,
  type EntityType,
} from "./types";

/* ------------------------------------------------------------------ */
/* Locating values                                                      */
/* ------------------------------------------------------------------ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whitespace-tolerant regex for a literal value (models often re-flow line breaks). */
function looseValueRe(value: string, flags: string): RegExp {
  const parts = value.trim().split(/\s+/).map(escapeRe);
  const body = parts.join("\\s+");
  const startsWord = /^\w/.test(value);
  const endsWord = /\w$/.test(value);
  return new RegExp(`${startsWord ? "(?<![\\w])" : ""}${body}${endsWord ? "(?![\\w])" : ""}`, flags);
}

/** Every occurrence of `value` in `text` (case-sensitive first, then case-insensitive). */
export function locate(text: string, value: string): Array<{ start: number; end: number }> {
  const v = value.trim();
  if (v.length < 2) return [];
  for (const flags of ["g", "gi"]) {
    const re = looseValueRe(v, flags);
    const spans = [...text.matchAll(re)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
    if (spans.length) return spans;
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Building entities                                                    */
/* ------------------------------------------------------------------ */

export function normalizeKey(value: string): string {
  const v = value.trim().replace(/[\s,.;:]+$/, "");
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length / v.replace(/\s/g, "").length >= 0.6) return `#${digits}`;
  return v.toLowerCase().replace(/\s+/g, " ");
}

const SOURCE_RANK: Record<DetectionSource, number> = { user: 3, device: 2, rule: 1 };

interface Candidate extends Detection {
  len: number;
}

function better(a: Candidate, b: Candidate): boolean {
  if (a.len !== b.len) return a.len > b.len;
  const ai = IDENTITY_TYPES.has(a.type) ? 1 : 0;
  const bi = IDENTITY_TYPES.has(b.type) ? 1 : 0;
  if (ai !== bi) return ai > bi;
  return SOURCE_RANK[a.source] > SOURCE_RANK[b.source];
}

/** Greedy non-overlapping selection: longest, most-identifying span wins. */
function resolveOverlaps(cands: Candidate[]): Candidate[] {
  const sorted = [...cands].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : a.start - b.start));
  const chosen: Candidate[] = [];
  for (const c of sorted) {
    if (chosen.some((k) => c.start < k.end && k.start < c.end)) continue;
    chosen.push(c);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

const ALIAS_STOP = new Set([
  "the", "and", "for", "von", "van", "der", "del", "de", "la", "le", "jr", "sr", "ii", "iii",
  "mr", "ms", "mrs", "mx", "dr",
]);

function nameAliases(value: string): string[] {
  const tokens = value
    .split(/\s+/)
    .map((t) => t.replace(/[.,]/g, ""))
    .filter((t) => t.length >= 3 && /^[A-Z]/.test(t) && !ALIAS_STOP.has(t.toLowerCase()));
  const aliases = new Set<string>();
  if (tokens.length >= 2) {
    aliases.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    for (const t of tokens) aliases.add(t);
  }
  aliases.delete(value);
  return [...aliases];
}

export interface BuildOptions {
  /** Keys (normalizeKey) the user explicitly chose to keep or redact, preserved across rebuilds. */
  overrides?: Record<string, boolean>;
}

/**
 * Turn raw detections from rules, the on-device model and the user into a de-duplicated
 * list of entities, each with a stable placeholder and every span where it occurs.
 */
export function buildEntities(text: string, detections: Detection[], opts: BuildOptions = {}): Entity[] {
  // 1. Expand: a detection may only carry a value (from the model); find all its occurrences.
  const cands: Candidate[] = [];
  const seen = new Set<string>();
  for (const d of detections) {
    const spans =
      d.source === "rule" && text.slice(d.start, d.end) === d.text
        ? [{ start: d.start, end: d.end }, ...locate(text, d.text)]
        : locate(text, d.text);
    for (const s of spans) {
      const k = `${s.start}:${s.end}:${d.type}:${d.source}`;
      if (seen.has(k)) continue;
      seen.add(k);
      cands.push({ ...d, start: s.start, end: s.end, text: text.slice(s.start, s.end), len: s.end - s.start });
    }
  }

  // 2. Resolve overlaps.
  const chosen = resolveOverlaps(cands);

  // 3. Group by normalized value.
  const groups = new Map<string, { type: EntityType; value: string; sources: Set<DetectionSource>; spans: Array<{ start: number; end: number }> }>();
  for (const c of chosen) {
    const key = normalizeKey(c.text);
    const g = groups.get(key);
    if (g) {
      g.sources.add(c.source);
      g.spans.push({ start: c.start, end: c.end });
    } else {
      groups.set(key, { type: c.type, value: c.text, sources: new Set([c.source]), spans: [{ start: c.start, end: c.end }] });
    }
  }

  // 4. Name aliases ("Ms. Delgado" after "Maria L. Delgado"), skipping ambiguous ones.
  const aliasOwners = new Map<string, number>();
  for (const g of groups.values())
    if (g.type === "PERSON") for (const a of nameAliases(g.value)) aliasOwners.set(a, (aliasOwners.get(a) ?? 0) + 1);
  // A short name found on its own ("Dear Ms. Delgado") folds into the one full name it belongs to.
  for (const [key, g] of [...groups.entries()]) {
    if (g.type !== "PERSON" || (aliasOwners.get(g.value) ?? 0) !== 1) continue;
    const owner = [...groups.values()].find((o) => o !== g && o.type === "PERSON" && nameAliases(o.value).includes(g.value));
    if (!owner) continue;
    owner.spans.push(...g.spans);
    for (const s of g.sources) owner.sources.add(s);
    groups.delete(key);
  }
  const persons = [...groups.values()].filter((g) => g.type === "PERSON");
  const taken = chosen.map((c) => ({ start: c.start, end: c.end }));
  const aliasesByGroup = new Map<object, string[]>();
  for (const p of persons) {
    const used: string[] = [];
    // longest aliases first so "Maria Delgado" beats "Maria"
    for (const a of nameAliases(p.value).sort((x, y) => y.length - x.length)) {
      if ((aliasOwners.get(a) ?? 0) > 1 || groups.has(normalizeKey(a))) continue;
      for (const s of locate(text, a)) {
        if (taken.some((t) => s.start < t.end && t.start < s.end)) continue;
        // aliases are case-sensitive proper nouns
        if (text.slice(s.start, s.end) !== a) continue;
        p.spans.push(s);
        taken.push(s);
        if (!used.includes(a)) used.push(a);
      }
    }
    // Remember every unambiguous short form, not just the ones in this letter, so a follow-up
    // question like "Can Maria Delgado pay later?" is caught too.
    const all = nameAliases(p.value).filter((a) => (aliasOwners.get(a) ?? 0) <= 1 && !groups.has(normalizeKey(a)));
    aliasesByGroup.set(p, [...new Set([...used, ...all])]);
  }

  // 5. Assign placeholders in order of first appearance.
  const ordered = [...groups.entries()].sort(
    (a, b) => Math.min(...a[1].spans.map((s) => s.start)) - Math.min(...b[1].spans.map((s) => s.start)),
  );
  const counters: Partial<Record<EntityType, number>> = {};
  return ordered.map(([key, g]) => {
    const n = (counters[g.type] = (counters[g.type] ?? 0) + 1);
    const redactDefault = IDENTITY_TYPES.has(g.type);
    return {
      id: key,
      type: g.type,
      value: g.value,
      aliases: aliasesByGroup.get(g) ?? [],
      placeholder: `[${g.type}_${n}]`,
      redact: opts.overrides?.[key] ?? redactDefault,
      sources: [...g.sources],
      spans: g.spans.sort((a, b) => a.start - b.start),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Redaction, leak check, rehydration                                   */
/* ------------------------------------------------------------------ */

/** Replace every span of every redacted entity with its placeholder. */
export function redact(text: string, entities: Entity[]): string {
  const spans = entities
    .filter((e) => e.redact)
    .flatMap((e) => e.spans.map((s) => ({ ...s, placeholder: e.placeholder })))
    .sort((a, b) => b.start - a.start);
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + s.placeholder + out.slice(s.end);
  return out;
}

/** Redact free text (e.g. a follow-up question) using an existing vault plus fresh rule detections. */
export function redactWithVault(text: string, entities: Entity[]): { text: string; newFindings: Detection[] } {
  let out = text;
  const redacted = entities.filter((e) => e.redact);
  const forms = redacted
    .flatMap((e) => [e.value, ...e.aliases].map((f) => ({ form: f, placeholder: e.placeholder })))
    .sort((a, b) => b.form.length - a.form.length);
  for (const { form, placeholder } of forms) {
    const re = looseValueRe(form, "gi");
    out = out.replace(re, placeholder);
  }
  const placeholderSpans = [...out.matchAll(PLACEHOLDER_RE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  const fresh = detectWithRules(out).filter(
    (d) => !placeholderSpans.some((p) => d.start < p.end && p.start < d.end) && IDENTITY_TYPES.has(d.type),
  );
  for (const d of [...fresh].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, d.start) + `[${d.type}]` + out.slice(d.end);
  }
  return { text: out, newFindings: fresh };
}

const TYPE_ALT = ENTITY_TYPES.join("|");
/** Matches placeholders and the sloppy variants models produce: [PERSON_1], [ PERSON 1 ], {PERSON_1}, PERSON_1 */
export const PLACEHOLDER_RE = new RegExp(String.raw`[\[{(]\s*(${TYPE_ALT})[\s_\-]?(\d+)\s*[\]})]|\b(${TYPE_ALT})_(\d+)\b`, "g");

export interface Leak {
  text: string;
  type: EntityType | "VALUE";
  reason: string;
}

/**
 * Outbound scan: the last check before text leaves the device.
 * Flags (a) any redacted value still present verbatim, and (b) anything the rules still
 * recognise as identity data outside a placeholder.
 */
export function leakCheck(outbound: string, entities: Entity[]): Leak[] {
  const leaks: Leak[] = [];
  for (const e of entities.filter((x) => x.redact)) {
    for (const form of [e.value, ...e.aliases]) {
      if (locate(outbound, form).length) {
        leaks.push({ text: form, type: e.type, reason: "Redacted value still present" });
        break;
      }
    }
  }
  const placeholders = [...outbound.matchAll(PLACEHOLDER_RE)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  const keptKeys = new Set(entities.filter((e) => !e.redact).map((e) => e.id));
  for (const d of detectWithRules(outbound)) {
    if (!IDENTITY_TYPES.has(d.type)) continue;
    if (placeholders.some((p) => d.start < p.end && p.start < d.end)) continue;
    if (keptKeys.has(normalizeKey(d.text))) continue; // user deliberately kept it
    if (leaks.some((l) => l.text === d.text)) continue;
    leaks.push({ text: d.text, type: d.type, reason: "Looks like identity data" });
  }
  return leaks;
}

export interface Segment {
  text: string;
  entity?: Entity;
}

/** Split model output into plain text and restored-on-device values (for highlighting). */
export function rehydrateSegments(text: string, entities: Entity[]): Segment[] {
  const byPlaceholder = new Map(entities.map((e) => [e.placeholder, e]));
  const segs: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const type = (m[1] ?? m[3]) as EntityType;
    const n = m[2] ?? m[4];
    const e = byPlaceholder.get(`[${type.toUpperCase()}_${n}]`);
    if (!e) continue;
    if (m.index! > last) segs.push({ text: text.slice(last, m.index!) });
    // "Ms. [PERSON_1]" reads naturally as "Ms. Delgado", not "Ms. Maria L. Delgado"
    const afterHonorific = e.type === "PERSON" && /\b(?:Mr|Ms|Mrs|Mx|Dr)\.?\s*$/.test(text.slice(0, m.index!));
    const value = afterHonorific ? e.value.trim().split(/\s+/).pop()! : e.value;
    segs.push({ text: value, entity: e });
    last = m.index! + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs;
}

export function rehydrate(text: string, entities: Entity[]): string {
  return rehydrateSegments(text, entities)
    .map((s) => s.text)
    .join("");
}

/** Everything the shield found, in one call. */
export function shield(text: string, extra: Detection[] = [], opts: BuildOptions = {}) {
  const detections = [...detectWithRules(text), ...extra];
  const entities = buildEntities(text, detections, opts);
  const outbound = redact(text, entities);
  return { entities, outbound, leaks: leakCheck(outbound, entities) };
}
