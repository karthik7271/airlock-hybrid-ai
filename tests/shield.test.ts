import { describe, expect, it } from "vitest";
import { detectWithRules, luhnValid } from "../src/shield/rules";
import {
  buildEntities,
  leakCheck,
  locate,
  redact,
  redactWithVault,
  rehydrate,
  rehydrateSegments,
  shield,
} from "../src/shield/engine";
import { SAMPLE_LETTERS } from "../src/samples/letters";
import type { Detection } from "../src/shield/types";

const letter = (id: string) => SAMPLE_LETTERS.find((s) => s.id === id)!.text;

describe("rule detectors", () => {
  it("validates card numbers with Luhn", () => {
    expect(luhnValid("4111 1111 1111 1111")).toBe(true);
    expect(luhnValid("4111 1111 1111 1112")).toBe(false);
  });

  it("finds emails, phones, SSNs and labeled IDs", () => {
    const d = detectWithRules(
      "Call (541) 555-0142 or email a.b@x.example. SSN: 123-45-6789. Account No: RRMC-0048213. Member ID: CBH-77310452",
    );
    const by = (t: string) => d.filter((x) => x.type === t).map((x) => x.text);
    expect(by("PHONE")).toContain("(541) 555-0142");
    expect(by("EMAIL")).toContain("a.b@x.example");
    expect(by("GOV_ID")).toContain("123-45-6789");
    expect(by("ACCOUNT")).toEqual(expect.arrayContaining(["RRMC-0048213", "CBH-77310452"]));
  });

  it("does not treat money or plain dates as identity", () => {
    const d = detectWithRules("Balance $2,384.17 due December 9, 2026. Service on 08/22/2026.");
    expect(d).toEqual([]);
  });

  it("only treats dates as DOB when labeled", () => {
    const d = detectWithRules("Date of Birth: 03/14/1979. Visit on 03/14/2026.");
    expect(d.filter((x) => x.type === "DOB").map((x) => x.text)).toEqual(["03/14/1979"]);
  });

  it("finds labeled names, salutations, and street addresses", () => {
    const d = detectWithRules(letter("medical-bill"));
    const names = d.filter((x) => x.type === "PERSON").map((x) => x.text);
    expect(names).toContain("Maria L. Delgado");
    expect(names).toContain("Delgado");
    const addrs = d.filter((x) => x.type === "ADDRESS").map((x) => x.text);
    expect(addrs).toContain("1187 Willow Creek Road, Apt 4B");
    expect(addrs).toContain("Ashford, OR 97401");
  });

  it("ignores generic salutations", () => {
    expect(detectWithRules("Dear Valued Member,").filter((x) => x.type === "PERSON")).toEqual([]);
  });
});

describe("entity building", () => {
  it("locates values case-insensitively and across line breaks", () => {
    expect(locate("Maria\nDelgado said hi to maria delgado", "Maria Delgado")).toHaveLength(1);
    expect(locate("nothing here", "Maria Delgado")).toHaveLength(0);
    expect(locate("MARIA DELGADO", "Maria Delgado")).toHaveLength(1);
  });

  it("dedupes repeated values into one placeholder and numbers by first appearance", () => {
    const text = "Patient Name: Ann Lee. Call 555-123-4567. Ann Lee, call 555-123-4567 again. Member: Bo Chen";
    const entities = buildEntities(text, detectWithRules(text));
    const ann = entities.find((e) => e.value === "Ann Lee")!;
    expect(ann.placeholder).toBe("[PERSON_1]");
    expect(ann.spans).toHaveLength(2);
    expect(entities.find((e) => e.value === "Bo Chen")!.placeholder).toBe("[PERSON_2]");
    expect(entities.find((e) => e.type === "PHONE")!.spans).toHaveLength(2);
  });

  it("maps surname and first-name aliases to the same placeholder", () => {
    const text = "Patient Name: Maria L. Delgado\n\nDear Ms. Delgado, thank you Maria.";
    const entities = buildEntities(text, detectWithRules(text));
    const out = redact(text, entities);
    expect(out).not.toMatch(/Delgado|Maria/);
    expect(out.match(/\[PERSON_1\]/g)).toHaveLength(3);
  });

  it("skips ambiguous shared surnames", () => {
    const text = "Patient Name: Maria Delgado. Guarantor: Luis Delgado. Delgado family.";
    const entities = buildEntities(text, detectWithRules(text));
    const out = redact(text, entities);
    expect(out).toContain("[PERSON_1]");
    expect(out).toContain("[PERSON_2]");
    // "Delgado" alone is ambiguous -> flagged by the leak check rather than mis-assigned
    expect(out).toContain("Delgado family");
  });

  it("merges device-model detections that only carry a value", () => {
    const text = "Thanks to Anita Raman at Coastline Orthopedics for the knee referral.";
    const device: Detection[] = [
      { type: "PERSON", text: "Anita Raman", start: -1, end: -1, source: "device" },
      { type: "ORG", text: "Coastline Orthopedics", start: -1, end: -1, source: "device" },
      { type: "HEALTH", text: "knee", start: -1, end: -1, source: "device" },
    ];
    const entities = buildEntities(text, device);
    expect(entities.map((e) => e.type)).toEqual(["PERSON", "ORG", "HEALTH"]);
    // context types are kept by default, identity types redacted
    expect(entities.map((e) => e.redact)).toEqual([true, false, false]);
    expect(redact(text, entities)).toBe("Thanks to [PERSON_1] at Coastline Orthopedics for the knee referral.");
  });

  it("drops device detections the model hallucinated", () => {
    const text = "Short letter.";
    const entities = buildEntities(text, [{ type: "PERSON", text: "John Smith", start: -1, end: -1, source: "device" }]);
    expect(entities).toEqual([]);
  });

  it("honours user overrides across rebuilds", () => {
    const text = "Patient Name: Ann Lee";
    const first = buildEntities(text, detectWithRules(text));
    const again = buildEntities(text, detectWithRules(text), { overrides: { [first[0].id]: false } });
    expect(again[0].redact).toBe(false);
    expect(redact(text, again)).toBe(text);
  });
});

describe("full shield on sample letters", () => {
  for (const sample of SAMPLE_LETTERS) {
    it(`leaves no rule-detectable identity data in "${sample.id}"`, () => {
      const { outbound, leaks } = shield(sample.text);
      expect(leaks).toEqual([]);
      expect(outbound).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
      expect(outbound).not.toMatch(/@[a-z\-]+\.example/);
      expect(outbound).not.toMatch(/555-01\d\d/);
    });
  }

  it("keeps the substance the cloud needs", () => {
    const { outbound } = shield(letter("medical-bill"));
    expect(outbound).toContain("$2,384.17");
    expect(outbound).toContain("December 9, 2026");
    expect(outbound).toContain("CPT 99284");
    expect(outbound).toContain("Charity Care");
  });

  it("redacts the medical bill's identity fields", () => {
    const { outbound } = shield(letter("medical-bill"));
    for (const secret of ["Maria", "Delgado", "1187 Willow Creek", "03/14/1979", "RRMC-0048213", "CBH-77310452", "(541) 555-0142"]) {
      expect(outbound).not.toContain(secret);
    }
  });

  it("redacts the scam letter's partial SSN and case number", () => {
    const { outbound } = shield(letter("tax-scam"));
    expect(outbound).not.toContain("6619");
    expect(outbound).not.toContain("FTRB-88-104455");
    expect(outbound).not.toContain("Lindqvist");
  });
});

describe("leak check", () => {
  it("flags redacted values and unredacted identity data", () => {
    const text = "Patient Name: Ann Lee";
    const entities = buildEntities(text, detectWithRules(text));
    const leaks = leakCheck("Hi Ann Lee, call 555-222-3333", entities);
    expect(leaks.map((l) => l.text)).toEqual(expect.arrayContaining(["Ann Lee", "555-222-3333"]));
  });

  it("respects values the user deliberately kept", () => {
    const text = "Call 555-222-3333";
    const entities = buildEntities(text, detectWithRules(text)).map((e) => ({ ...e, redact: false }));
    expect(leakCheck(redact(text, entities), entities)).toEqual([]);
  });
});

describe("rehydration", () => {
  const text = "Patient Name: Maria Delgado\nAccount No: RRMC-0048213";
  const entities = buildEntities(text, detectWithRules(text));

  it("restores placeholders, including sloppy model variants", () => {
    const reply = "Dear [PERSON_1], about account [ ACCOUNT 1 ] and {PERSON_1} / PERSON_1.";
    expect(rehydrate(reply, entities)).toBe(
      "Dear Maria Delgado, about account RRMC-0048213 and Maria Delgado / Maria Delgado.",
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(rehydrate("Hello [PERSON_9]", entities)).toBe("Hello [PERSON_9]");
  });

  it("marks restored segments so the UI can highlight them", () => {
    const segs = rehydrateSegments("Hi [PERSON_1]!", entities);
    expect(segs.map((s) => [s.text, s.entity?.type])).toEqual([
      ["Hi ", undefined],
      ["Maria Delgado", "PERSON"],
      ["!", undefined],
    ]);
  });

  it("round-trips exactly when a letter uses each name one way", () => {
    for (const id of ["medical-bill", "rent-notice"]) {
      const { entities: ents, outbound } = shield(letter(id));
      expect(rehydrate(outbound, ents)).toBe(letter(id));
    }
  });

  it("restores short name forms as the full name, or the surname after an honorific", () => {
    const { entities: ents, outbound } = shield(letter("tax-scam"));
    const back = rehydrate(outbound, ents);
    expect(back).toContain("Dear Robert E. Lindqvist,");
    expect(back).not.toMatch(/\[[A-Z_]+_\d+\]/);
    expect(rehydrate("Dear Mr. [PERSON_1],", ents)).toBe("Dear Mr. Lindqvist,");
  });
});

describe("follow-up questions", () => {
  it("catches name forms that never appeared in the letter", () => {
    const { entities } = shield(letter("medical-bill"));
    const { text: q } = redactWithVault("Can Maria Delgado negotiate? Ask for maria.", entities);
    expect(q).toBe("Can [PERSON_1] negotiate? Ask for [PERSON_1].");
  });

  it("redacts known vault values and fresh identity data in questions", () => {
    const text = "Patient Name: Maria Delgado";
    const entities = buildEntities(text, detectWithRules(text));
    const { text: q, newFindings } = redactWithVault("Can maria delgado pay by card 4111 1111 1111 1111?", entities);
    expect(q).toBe("Can [PERSON_1] pay by card [FINANCIAL]?");
    expect(newFindings).toHaveLength(1);
  });
});
