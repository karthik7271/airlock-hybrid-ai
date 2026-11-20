# Devpost submission kit (copy/paste)

**Name:** Airlock
**Tagline:** Get AI help with a scary letter without giving away who you are.
**Platform:** Web (Chrome), Gemini Nano via Firebase AI Logic hybrid inference
**Live:** https://airlock-hybrid-ai-22a1c.web.app  **Repo:** https://github.com/karthik7271/airlock-hybrid-ai

## Text description

People who most need help with a medical bill, insurance denial or eviction notice are the least able to paste their name, address and account numbers into a cloud AI. Airlock splits the job with Firebase AI Logic hybrid inference.

Gemini Nano runs on the device (`ONLY_ON_DEVICE`) to read the letter and find personal details, backed by a rule-based detector, so protection works even without Nano. The user sees the original and the redacted copy side by side and can hide or keep anything. Gemini in the cloud (`PREFER_IN_CLOUD`) analyzes only the redacted text: deadlines with countdowns, money, rights and options, red flags and scam risk, jargon, and a reply letter. Placeholders are swapped back on the device.

How we use Firebase AI Logic: each task gets the inference mode that matches how sensitive its input is. Unredacted letters only ever touch `ONLY_ON_DEVICE` (and are skipped, never sent, if Nano is missing). Question routing and jargon use `PREFER_ON_DEVICE`. Analysis, expert answers and drafts use `PREFER_IN_CLOUD`, falling back to Nano offline. Photos use `ONLY_ON_DEVICE`, or `ONLY_IN_CLOUD` only after explicit consent. Structured output is configured for both on-device (`responseConstraint`) and cloud (`responseSchema`). The SDK's `inferenceSource` feeds a Privacy Receipt that lists every call, where it ran, and the exact text that left the device.

Other Firebase products: App Check (enforced, reCAPTCHA Enterprise), Remote Config (models, thinking level, switches), Firestore (redacted cases only; rules reject emails/SSNs/cards), Authentication, Hosting.

Value: a private way to understand a high-stakes letter, useful for individuals and for caseworkers and legal-aid volunteers handling clients' documents.

## Demo video (under 3:00)

1. 0:00 Hook: "This is a hospital bill with my name, address and account number. I don't want a cloud AI to see them."
2. 0:15 Open the live app, click the hospital-bill sample. Show the Gemini Nano status pill.
3. 0:30 Review screen: original left, placeholders right; Nano's scan finishes; show the private first read. Click one highlight to hide/keep.
4. 1:00 Send. Show the verdict, deadline countdown, money table, next steps.
5. 1:20 Ask "What is my account number?" (answered on-device) then "Can I negotiate this down?" (cloud, shows "Sent as" with placeholders).
6. 1:50 Write a reply; your name and numbers are filled in locally.
7. 2:10 Open the Privacy Receipt: tiers and modes, calls on-device vs cloud, "Show exactly what was sent".
8. 2:30 Try the scam sample, or go offline and re-run to show the Nano fallback.
9. 2:50 Close: repo, Apache-2.0, built with Firebase AI Logic hybrid inference.
