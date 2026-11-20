/**
 * The privacy ledger: an append-only, on-device record of every model call Airlock makes,
 * where it actually ran (the SDK's `inferenceSource`), and the exact text that left the device.
 * It powers the "Privacy receipt" drawer. Nothing in it is ever uploaded.
 */

export type Tier = "device-only" | "redacted-safe" | "cloud-strength" | "consented-cloud";
export type Where = "on_device" | "in_cloud" | "blocked" | "failed";

export interface LedgerEntry {
  id: number;
  at: number;
  task: string;
  tier: Tier;
  mode: string;
  where: Where;
  ms: number;
  /** Exact text that left the device (only for in-cloud calls). */
  outbound?: string;
  note?: string;
}

type Listener = (entries: LedgerEntry[]) => void;

let entries: LedgerEntry[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

export const ledger = {
  add(e: Omit<LedgerEntry, "id" | "at">): LedgerEntry {
    const entry = { ...e, id: nextId++, at: Date.now() };
    entries = [...entries, entry];
    listeners.forEach((l) => l(entries));
    return entry;
  },
  all(): LedgerEntry[] {
    return entries;
  },
  clear(): void {
    entries = [];
    listeners.forEach((l) => l(entries));
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    l(entries);
    return () => listeners.delete(l);
  },
  stats() {
    const device = entries.filter((e) => e.where === "on_device").length;
    const cloud = entries.filter((e) => e.where === "in_cloud").length;
    const blocked = entries.filter((e) => e.where === "blocked").length;
    const bytesOut = entries.reduce((n, e) => n + (e.outbound ? new TextEncoder().encode(e.outbound).length : 0), 0);
    return { device, cloud, blocked, bytesOut, total: entries.length };
  },
};

export const TIER_INFO: Record<Tier, { label: string; mode: string; why: string }> = {
  "device-only": {
    label: "Never leaves device",
    mode: "ONLY_ON_DEVICE",
    why: "Sees your unredacted letter, so it must run on Gemini Nano or not at all.",
  },
  "redacted-safe": {
    label: "Redacted-safe",
    mode: "PREFER_ON_DEVICE",
    why: "Only sees redacted text: free and instant on-device, safe to fall back to the cloud.",
  },
  "cloud-strength": {
    label: "Cloud strength",
    mode: "PREFER_IN_CLOUD",
    why: "Needs a frontier model; sees only redacted text. Falls back to Gemini Nano when offline.",
  },
  "consented-cloud": {
    label: "Cloud, with your consent",
    mode: "ONLY_IN_CLOUD",
    why: "No on-device model, and you explicitly chose to send this to the cloud.",
  },
};
