import type { Detection, EntityType } from "./types";

/**
 * Deterministic detectors. They run on every document, on every device, with no model,
 * so Airlock still protects you when Gemini Nano isn't available. Gemini Nano (on-device)
 * adds the things rules can't see: unlabeled names, free-form addresses, health details.
 */

interface Rule {
  type: EntityType;
  re: RegExp;
  /** Which capture group holds the sensitive value (0 = whole match). */
  group?: number;
  validate?: (value: string) => boolean;
}

// Names never span lines; a middle initial must be "L." or a lone letter.
const NAME = String.raw`[A-Z][a-zA-Z'’\-]+(?:[ \t]+[A-Z](?:\.|(?=[ \t])))?(?:[ \t]+[A-Z][a-zA-Z'’\-]+){0,2}`;
const STREET_SUFFIX = String.raw`(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Square|Sq|Trail|Trl|Loop)`;
const DATE = String.raw`(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})`;

export function luhnValid(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const RULES: Rule[] = [
  { type: "EMAIL", re: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g },

  // US SSN / ITIN, including partially masked forms like XXX-XX-1234
  { type: "GOV_ID", re: /\b(?:\d{3}|[Xx*]{3})-(?:\d{2}|[Xx*]{2})-\d{4}\b/g },
  // Labeled government identifiers
  {
    type: "GOV_ID",
    re: /\b(?:SSN|Social Security(?: Number| No\.?)?|ITIN|TIN|EIN|Passport(?: No\.?| Number)?|Driver'?s License(?: No\.?| Number)?|Medicare(?: Number| ID| No\.?)?|Medicaid(?: Number| ID| No\.?)?|A-Number|Alien(?: Registration)? Number|NHS Number|National Insurance Number)\s*[:#]?\s*([A-Z0-9][A-Z0-9\- ]{3,20}[A-Z0-9])/gi,
    group: 1,
    validate: (v) => /\d/.test(v),
  },

  // Card numbers (Luhn-validated) and IBANs
  { type: "FINANCIAL", re: /\b(?:\d[ \-]?){12,18}\d\b/g, validate: luhnValid },
  { type: "FINANCIAL", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  // "card ending in 4421" / "account ending with 0193"
  { type: "FINANCIAL", re: /\b(?:card|account|acct)\s+(?:number\s+)?ending\s+(?:in|with)\s+(\d{4})\b/gi, group: 1 },
  {
    type: "FINANCIAL",
    re: /\b(?:Routing(?: Number| No\.?)?|ABA|Bank Account(?: Number| No\.?)?|Sort Code)\s*[:#]?\s*([0-9][0-9\- ]{4,20}[0-9])/gi,
    group: 1,
  },

  // Labeled account-like identifiers: account, member, policy, claim, case, MRN...
  {
    type: "ACCOUNT",
    re: /\b(?:Account|Acct|Member|Policy|Claim|Case|Patient|Customer|Reference|Ref|Invoice|Group|Subscriber|Loan|Lease|Tenant|Docket|File|Notice|Medical Record|MRN|Confirmation|Ticket|Citation|Order|Contract|Plan)\s*(?:No\.?|Number|Num|#|ID|Identifier)?\s*[:#]\s*([A-Z0-9][A-Z0-9\-\/]{3,24})/gi,
    group: 1,
    validate: (v) => /\d/.test(v),
  },
  {
    type: "ACCOUNT",
    re: /\b(?:Account|Acct|Member|Policy|Claim|Case|Patient|Customer|Reference|Ref|Invoice|Subscriber|Loan|Docket|Medical Record|MRN|Confirmation|Citation)\s+(?:No\.?|Number|Num|#|ID)\s*:?\s*([A-Z0-9][A-Z0-9\-\/]{3,24})/gi,
    group: 1,
    validate: (v) => /\d/.test(v),
  },

  // Dates of birth (only when labeled - other dates are substance, not identity)
  {
    type: "DOB",
    re: new RegExp(String.raw`\b(?:DOB|D\.O\.B\.|Date of Birth|Birth ?date|Born(?: on)?)\s*[:\-]?\s*(${DATE})`, "gi"),
    group: 1,
  },

  // Phone numbers: +1 (555) 555-0199, 555.555.0199, +44 20 7946 0958
  {
    type: "PHONE",
    re: /(?:(?<![\w$])\+\d{1,3}[\s.\-]?)?(?<![\w$.])\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g,
  },
  { type: "PHONE", re: /(?<![\w$])\+\d{1,3}(?:[\s.\-]?\d{2,4}){2,4}\b/g },

  // Street addresses and PO boxes
  {
    type: "ADDRESS",
    re: new RegExp(
      String.raw`\b\d{1,6}[ \t]+(?:[NSEW]\.?[ \t]+)?(?:[A-Z0-9][a-zA-Z0-9'.\-]*[ \t]+){0,4}${STREET_SUFFIX}\.?(?:,?[ \t]+(?:Apt|Apartment|Unit|Suite|Ste|Fl|Floor|#)\.?[ \t]*[A-Z0-9\-]+)?\b`,
      "g",
    ),
  },
  { type: "ADDRESS", re: /\b(?:P\.?\s?O\.?\s?Box|Post Office Box)\s+\d+\b/gi },
  // "Springfield, IL 62704" style city/state/ZIP lines
  { type: "ADDRESS", re: /\b[A-Z][a-zA-Z.'\-]+(?:[ \t]+[A-Z][a-zA-Z.'\-]+){0,2},[ \t]*[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?\b/g },
  // Apartment / unit references on their own
  { type: "ADDRESS", re: /\b(?:Apt|Apartment|Unit)\.?\s*#?\s*\d+[A-Z]?\b/g },

  // Labeled names: "Patient Name: Maria L. Delgado", "Tenant: ..."
  {
    type: "PERSON",
    re: new RegExp(
      String.raw`\b(?:Patient|Member|Subscriber|Tenant|Taxpayer|Insured|Beneficiary|Account Holder|Guarantor|Resident|Applicant|Employee|Client|Policyholder|Borrower|Debtor|Claimant|Recipient|Guardian|Parent|Student|Name|Full Name|Patient Name|Member Name|Insured Name|Prepared for|Attention|Attn|To)[ \t]*(?:Name)?[ \t]*:[ \t]*(?:(?:Mr|Ms|Mrs|Mx|Dr)\.?[ \t]+)?(${NAME})`,
      "g",
    ),
    group: 1,
  },
  // Salutations: "Dear Ms. Delgado," / "Dear Maria Delgado,"
  {
    type: "PERSON",
    re: new RegExp(String.raw`\bDear[ \t]+(?:(?:Mr|Ms|Mrs|Mx|Dr)\.?[ \t]+)?(${NAME})(?=[ \t]*[,:])`, "g"),
    group: 1,
  },
  // Honorific mentions: "Mr. James Okafor"
  {
    type: "PERSON",
    re: /\b(?:Mr|Ms|Mrs|Mx|Dr)\.?[ \t]+([A-Z][a-zA-Z'’\-]+(?:[ \t]+[A-Z][a-zA-Z'’\-]+)?)/g,
    group: 1,
  },
];

const NOT_A_NAME = new Set([
  "Customer",
  "Service",
  "Sir",
  "Madam",
  "Valued",
  "Member",
  "Patient",
  "Tenant",
  "Resident",
  "Policyholder",
  "Taxpayer",
  "Applicant",
]);

/** Run every rule and return raw (possibly overlapping) detections. */
export function detectWithRules(text: string): Detection[] {
  const out: Detection[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const g = rule.group ?? 0;
      const raw = m[g];
      if (!raw) continue;
      const value = raw.replace(/[\s,.;:]+$/, "");
      if (!value) continue;
      if (rule.validate && !rule.validate(value)) continue;
      if (rule.type === "PERSON" && value.split(/\s+/).every((w) => NOT_A_NAME.has(w))) continue;
      const offsetInMatch = g === 0 ? 0 : m[0].indexOf(raw);
      const start = (m.index ?? 0) + offsetInMatch;
      out.push({ type: rule.type, start, end: start + value.length, text: value, source: "rule" });
    }
  }
  return out;
}
