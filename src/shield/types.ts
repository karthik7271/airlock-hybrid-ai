/**
 * Shared types for Airlock's privacy shield.
 *
 * The shield splits a document into two worlds:
 *   - identity  (who you are)        -> replaced with placeholders before anything leaves the device
 *   - substance (what the letter says) -> kept, so the cloud model can actually help
 */

export const ENTITY_TYPES = [
  "PERSON",
  "ADDRESS",
  "EMAIL",
  "PHONE",
  "GOV_ID",
  "ACCOUNT",
  "FINANCIAL",
  "DOB",
  "ORG",
  "HEALTH",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type DetectionSource = "rule" | "device" | "user";

/** A raw span found by one detector. Offsets index into the original text. */
export interface Detection {
  type: EntityType;
  start: number;
  end: number;
  text: string;
  source: DetectionSource;
}

/** A unique sensitive value in the document, with every place it occurs. */
export interface Entity {
  id: string;
  type: EntityType;
  /** Canonical value (first occurrence as written). */
  value: string;
  /** Other surface forms that map to the same placeholder (e.g. surname alone). */
  aliases: string[];
  placeholder: string;
  /** true -> replaced before leaving the device; false -> kept for context. */
  redact: boolean;
  sources: DetectionSource[];
  spans: Array<{ start: number; end: number }>;
}

/** Types that describe *who* you are. Redacted by default. */
export const IDENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  "PERSON",
  "ADDRESS",
  "EMAIL",
  "PHONE",
  "GOV_ID",
  "ACCOUNT",
  "FINANCIAL",
  "DOB",
]);

/** Types that describe *what* the letter is about. Kept by default, user can flip. */
export const CONTEXT_TYPES: ReadonlySet<EntityType> = new Set(["ORG", "HEALTH"]);

export const TYPE_LABELS: Record<EntityType, string> = {
  PERSON: "Name",
  ADDRESS: "Address",
  EMAIL: "Email",
  PHONE: "Phone",
  GOV_ID: "Government ID",
  ACCOUNT: "Account / case number",
  FINANCIAL: "Card / bank number",
  DOB: "Date of birth",
  ORG: "Organization",
  HEALTH: "Health detail",
};
