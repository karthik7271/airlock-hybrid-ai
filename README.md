# Airlock

**Get help with a scary letter without giving away who you are.**

Medical bills, insurance denials, eviction notices and tax letters are full of names, addresses and account numbers, and the people who most need help reading them are the ones least able to hand that data to a cloud AI. Airlock uses Firebase AI Logic hybrid inference to split the job:

1. **Gemini Nano, on your device,** reads the letter and finds your personal details (with a rule-based pass as backup).
2. You **review** the original and the redacted copy side by side, and hide or keep anything.
3. **Gemini in the cloud** analyzes only the redacted text: deadlines, money, your options, red flags, a reply letter.
4. Placeholders are **swapped back on your device**. The Privacy Receipt shows every call, where it ran, and the exact text that left.

Live demo: https://airlock-hybrid-ai-22a1c.web.app (Chrome 139+ on desktop for on-device features)

## Inference mode as a privacy policy

Each task uses the hybrid mode that matches how sensitive its input is:

| Tier | Mode | Sees | Used for |
| --- | --- | --- | --- |
| Never leaves device | `ONLY_ON_DEVICE` | your unredacted letter | shield scan, instant gist, private Q&A, reading photos |
| Redacted-safe | `PREFER_ON_DEVICE` | redacted text only | question routing, jargon lookup |
| Cloud strength | `PREFER_IN_CLOUD` | redacted text only | analysis, expert answers, reply drafts (falls back to Gemini Nano offline) |
| Consented cloud | `ONLY_IN_CLOUD` | only what you approved | reading a photo when no on-device image model exists |

If Gemini Nano is missing, device-only steps are skipped rather than sent to the cloud. The SDK's `inferenceSource` on every response feeds the Privacy Receipt, so the UI reports where each call actually ran.

Code: [`src/ai/tasks.ts`](src/ai/tasks.ts) (all `getGenerativeModel` calls and modes), [`src/ai/ledger.ts`](src/ai/ledger.ts).

## Firebase products

- **Firebase AI Logic**: hybrid inference (Web SDK, `firebase/ai`), structured output on both on-device (`responseConstraint`) and cloud (`responseSchema`).
- **App Check**: enforced for AI Logic, Firestore and Auth; reCAPTCHA Enterprise in production, debug provider in dev only.
- **Remote Config**: cloud models, thinking level, chunk size, feature switches; changeable without a redeploy.
- **Firestore**: redacted cases only, offline persistent cache, rules reject writes that still contain an email, SSN or card number.
- **Authentication**: anonymous sign-in scopes saved cases per user (optional; the app works without it).
- **Hosting**.

Saved cases are split by design: the redacted letter and analysis go to Firestore, while the vault that maps placeholders back to real values stays in IndexedDB, AES-GCM encrypted with a non-extractable key. Opening a case on another device shows placeholders only.

## The shield

`src/shield/` is a pure, tested TypeScript engine: rule detectors (emails, phones, SSNs, Luhn-checked cards, labeled IDs, addresses, names) plus Gemini Nano detections, merged into entities with stable placeholders, a name-alias resolver, an outbound leak check, and tolerant rehydration of model output. `npm test` runs 29 tests including round-trips on four fictional sample letters.

## Run it

```bash
npm install
cp .env.example .env.local        # fill in your Firebase web config
npm run dev                       # http://localhost:5173
npm test && npm run build
```

Local development needs an App Check debug token: put it in `.env.development.local` as `VITE_APPCHECK_DEBUG_TOKEN` (it is only read by the dev server and never bundled). For Gemini Nano in Chrome, see the [Firebase hybrid docs](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started); photo reading needs `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`.

## What was built during the hackathon

Everything in this repository was written for #BuildHybridAI 2026 (Nov 2026), with Claude Code as the coding assistant. All sample letters are fictional.

Airlock is not legal, medical or financial advice.

## License

Apache-2.0
