import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from "firebase/firestore";
import { fetchAndActivate, getRemoteConfig, getValue, type RemoteConfig } from "firebase/remote-config";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: env.VITE_FIREBASE_APP_ID as string,
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/* ------------------------------------------------------------------ */
/* Remote Config: tune models, prompts and routing without a redeploy  */
/* ------------------------------------------------------------------ */

export const RC_DEFAULTS = {
  /** Cloud model for deep analysis and drafting (redacted text only). */
  cloud_model: "gemini-3.8-flash",
  /** Cloud fallback for light, redacted-safe tasks (routing, jargon). */
  fast_cloud_model: "gemini-3.5-flash-lite",
  /** Max characters per on-device shield pass (Nano context is ~9k tokens incl. schema). */
  device_chunk_chars: 2400,
  /** Let deep analysis fall back to Gemini Nano when the cloud is unreachable. */
  offline_device_analysis: true,
  /** Run the Gemini Nano shield pass on top of the rule-based shield. */
  device_shield_enabled: true,
  /** Persist redacted cases to Firestore (vaults always stay local). */
  cloud_history_enabled: true,
  /** Thinking level for cloud_model calls (LOW | MEDIUM | HIGH, "" = model default). */
  thinking_level: "",
  /** Thinking level for fast_cloud_model calls. */
  fast_thinking_level: "",
  prompt_version: "2026-11-17",
};
export type RcKey = keyof typeof RC_DEFAULTS;

let app: FirebaseApp | undefined;
let ai: AI | undefined;
let db: Firestore | undefined;
let rc: RemoteConfig | undefined;

export function firebaseApp(): FirebaseApp {
  if (app) return app;
  if (!isConfigured) throw new Error("Firebase is not configured. Copy .env.example to .env.local and fill it in.");
  app = initializeApp(firebaseConfig);

  // App Check is required by Firebase AI Logic. Local dev uses the debug provider.
  // The debug token is honoured only by the dev server, so it can never ship in a public build.
  // It lives in .env.development.local, which Vite never loads for `vite build`.
  const debugToken = import.meta.env.DEV ? (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined) : undefined;
  if (debugToken) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === "true" ? true : debugToken;
  const enterpriseKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined;
  const v3Key = env.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined;
  if (enterpriseKey || v3Key || debugToken) {
    initializeAppCheck(app, {
      provider: enterpriseKey
        ? new ReCaptchaEnterpriseProvider(enterpriseKey)
        : new ReCaptchaV3Provider(v3Key ?? "debug-only"),
      isTokenAutoRefreshEnabled: true,
    });
  }
  return app;
}

/** The Firebase AI Logic entry point (Gemini Developer API backend). */
export function aiService(): AI {
  return (ai ??= getAI(firebaseApp(), { backend: new GoogleAIBackend() }));
}

export function firestore(): Firestore {
  return (db ??= initializeFirestore(firebaseApp(), {
    // Offline-first: case saves made on a plane sync when you land.
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  }));
}

export function remoteConfig(): RemoteConfig {
  if (rc) return rc;
  rc = getRemoteConfig(firebaseApp());
  rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 3_600_000;
  rc.defaultConfig = RC_DEFAULTS;
  return rc;
}

export async function loadRemoteConfig(): Promise<void> {
  try {
    await fetchAndActivate(remoteConfig());
  } catch {
    // Offline or not yet published: in-app defaults apply.
  }
}

export function rcString(key: RcKey): string {
  if (!isConfigured) return String(RC_DEFAULTS[key]);
  return getValue(remoteConfig(), key).asString() || String(RC_DEFAULTS[key]);
}
export function rcNumber(key: RcKey): number {
  if (!isConfigured) return Number(RC_DEFAULTS[key]);
  return getValue(remoteConfig(), key).asNumber() || Number(RC_DEFAULTS[key]);
}
export function rcBool(key: RcKey): boolean {
  if (!isConfigured) return Boolean(RC_DEFAULTS[key]);
  const v = getValue(remoteConfig(), key);
  return v.getSource() === "static" ? Boolean(RC_DEFAULTS[key]) : v.asBoolean();
}

/** Anonymous auth: every case is private to this browser's user, no sign-up needed. */
export function ensureUser(): Promise<User | null> {
  if (!isConfigured) return Promise.resolve(null);
  const auth = getAuth(firebaseApp());
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, async (user) => {
      if (user) {
        off();
        resolve(user);
        return;
      }
      try {
        await signInAnonymously(auth);
      } catch {
        off();
        resolve(null);
      }
    });
  });
}
