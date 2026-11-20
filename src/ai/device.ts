/**
 * Gemini Nano availability in this browser (Chrome Prompt API via Firebase AI Logic).
 * We probe it directly only to drive the UI; all inference goes through the Firebase SDK.
 */

export type DeviceState = "checking" | "unsupported" | "unavailable" | "downloadable" | "downloading" | "available";

interface LanguageModelStatic {
  availability(opts?: unknown): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
}

const lm = (): LanguageModelStatic | undefined => (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;

export const TEXT_IO = {
  expectedInputs: [{ type: "text" as const, languages: ["en"] }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
};

export const IMAGE_IO = {
  expectedInputs: [{ type: "text" as const, languages: ["en"] }, { type: "image" as const }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
};

export async function probeDevice(opts: unknown = TEXT_IO): Promise<DeviceState> {
  const LM = lm();
  if (!LM) return "unsupported";
  try {
    return await LM.availability(opts);
  } catch {
    return "unavailable";
  }
}

/** Gemini Nano can read images only with Chrome's multimodal flag enabled. */
export async function probeImageInput(): Promise<boolean> {
  return (await probeDevice(IMAGE_IO)) === "available";
}

export const DEVICE_COPY: Record<DeviceState, { title: string; detail: string }> = {
  checking: { title: "Checking for Gemini Nano…", detail: "" },
  unsupported: {
    title: "No on-device model in this browser",
    detail: "Use Chrome 139+ on desktop for full protection. Airlock's rule-based shield still runs locally.",
  },
  unavailable: {
    title: "Gemini Nano unavailable on this device",
    detail: "Your hardware or Chrome settings don't support it. The rule-based shield still runs locally.",
  },
  downloadable: {
    title: "Gemini Nano ready to download",
    detail: "One-time download, then your letters are scanned by AI without leaving this computer.",
  },
  downloading: { title: "Downloading Gemini Nano…", detail: "You can keep working; protection upgrades when it's done." },
  available: { title: "Gemini Nano active", detail: "Sensitive steps run on this device." },
};
