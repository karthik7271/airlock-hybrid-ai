import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { Where } from "./ai/ledger";
import { analyzeLetter, deviceShieldScan, DeviceUnavailableError, privateGist, transcribeImage, type Analysis } from "./ai/tasks";
import { ensureUser, isConfigured, loadRemoteConfig } from "./firebase/app";
import { buildEntities, leakCheck, normalizeKey, redact } from "./shield/engine";
import { detectWithRules } from "./shield/rules";
import type { Detection, Entity, EntityType } from "./shield/types";
import { deleteCase, listCases, loadVault, newCaseId, saveCase, type CloudCase } from "./state/cases";
import { Intake } from "./ui/Intake";
import { Receipt } from "./ui/Receipt";
import { Results } from "./ui/Results";
import { Review, type ScanState } from "./ui/Review";
import { TopBar } from "./ui/TopBar";
import { useDevice, useOnline } from "./ui/useDevice";

type Stage = "intake" | "review" | "results";

interface CaseState {
  id: string;
  title: string;
  original: string;
  device: Detection[];
  user: Detection[];
  overrides: Record<string, boolean>;
  gist?: string;
  analysis?: Analysis;
  where?: Where;
  /** For cases opened without their vault: entities can't be rebuilt, outbound is fixed. */
  frozen?: { outbound: string; entities: Entity[] };
}

export default function App() {
  const device = useDevice();
  const online = useOnline();
  const [stage, setStage] = useState<Stage>("intake");
  const [c, setC] = useState<CaseState | null>(null);
  const [scan, setScan] = useState<ScanState>("idle");
  const [scanProgress, setScanProgress] = useState<string>();
  const [lang, setLang] = useState(() => (navigator.language || "en").slice(0, 2));
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState(false);
  const [consent, setConsent] = useState<File | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<Array<CloudCase & { hasVault: boolean }>>([]);
  const runId = useRef(0);

  // Boot: Remote Config + anonymous auth + saved cases.
  useEffect(() => {
    if (!isConfigured) return;
    void loadRemoteConfig();
    void ensureUser().then(setUser);
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const cases = await listCases(user?.uid);
      const withVault = await Promise.all(cases.map(async (k) => ({ ...k, hasVault: !!(await loadVault(k.id)) })));
      setHistory(withVault);
    } catch {
      setHistory([]);
    }
  }, [user]);
  useEffect(() => {
    if (stage === "intake") void refreshHistory();
  }, [stage, refreshHistory]);

  // The shield, recomputed on every change. Pure and synchronous: rules + Nano + your edits.
  const shielded = useMemo(() => {
    if (!c) return null;
    if (c.frozen) return { entities: c.frozen.entities, outbound: c.frozen.outbound, leaks: [] };
    const entities = buildEntities(c.original, [...detectWithRules(c.original), ...c.device, ...c.user], { overrides: c.overrides });
    const outbound = redact(c.original, entities);
    return { entities, outbound, leaks: leakCheck(outbound, entities) };
  }, [c]);

  const start = useCallback(
    async (text: string, title: string) => {
      const id = ++runId.current;
      setError(undefined);
      setC({ id: newCaseId(), title, original: text.trim(), device: [], user: [], overrides: {} });
      setStage("review");
      window.scrollTo({ top: 0 });

      // Starting a Nano download needs a user gesture: this runs inside the click.
      const state = device.state === "downloadable" ? (void device.enable(), "downloading") : device.state;
      if (!isConfigured || (state !== "available" && state !== "downloading")) {
        setScan("unavailable");
        return;
      }
      setScan("scanning");
      try {
        const found = await deviceShieldScan(text, (i, n) => setScanProgress(n > 1 ? `Gemini Nano is reading part ${i + 1} of ${n}…` : "Gemini Nano is reading your letter…"));
        if (runId.current !== id) return;
        setC((prev) => (prev ? { ...prev, device: found } : prev));
        setScan("done");
        const gist = await privateGist(text);
        if (runId.current !== id) return;
        setC((prev) => (prev ? { ...prev, gist } : prev));
      } catch (e) {
        if (runId.current !== id) return;
        setScan(e instanceof DeviceUnavailableError ? "unavailable" : "error");
      }
    },
    [device],
  );

  const readImage = useCallback(
    async (file: File, cloudOk: boolean) => {
      setConsent(null);
      setError(undefined);
      setBusy(cloudOk ? "Reading the photo in the cloud…" : "Gemini Nano is reading your photo…");
      setTranscript("");
      try {
        const data = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1]);
          r.onerror = () => rej(r.error);
          r.readAsDataURL(file);
        });
        let acc = "";
        for await (const t of transcribeImage({ data, mimeType: file.type }, cloudOk)) {
          acc += t;
          setTranscript(acc);
        }
        setBusy(null);
        setTranscript(null);
        await start(acc, "Photo of a letter");
      } catch (e) {
        setBusy(null);
        setTranscript(null);
        setError(`Couldn't read that photo: ${(e as Error).message}`);
      }
    },
    [start],
  );

  const onImage = useCallback(
    (file: File) => {
      if (isConfigured && device.state === "available" && device.images) void readImage(file, false);
      else setConsent(file);
    },
    [device, readImage],
  );

  const toggle = (e: Entity) =>
    setC((prev) => (prev ? { ...prev, overrides: { ...prev.overrides, [e.id]: !e.redact } } : prev));

  const addUser = (text: string, type: EntityType) =>
    setC((prev) =>
      prev
        ? {
            ...prev,
            user: [...prev.user, { type, text, start: -1, end: -1, source: "user" }],
            overrides: { ...prev.overrides, [normalizeKey(text)]: true },
          }
        : prev,
    );

  const send = async () => {
    if (!c || !shielded) return;
    setSending(true);
    setError(undefined);
    try {
      const { analysis, where } = await analyzeLetter(shielded.outbound, lang);
      const next = { ...c, analysis, where };
      setC(next);
      setStage("results");
      window.scrollTo({ top: 0 });
      void saveCase(
        user?.uid,
        {
          id: c.id,
          title: c.title,
          docType: analysis.docType,
          urgency: analysis.urgency,
          redactedText: shielded.outbound,
          analysis,
          lang,
          protectedCount: shielded.entities.filter((e) => e.redact).length,
        },
        { original: c.original, entities: shielded.entities },
      ).catch(() => {});
    } catch (e) {
      setError(
        !online
          ? "You're offline and Gemini Nano isn't available, so the analysis can't run. Your letter is still only on this device."
          : `The analysis didn't finish: ${(e as Error).message}`,
      );
    } finally {
      setSending(false);
    }
  };

  const openCase = async (k: CloudCase) => {
    const vault = await loadVault(k.id);
    runId.current++;
    setScan("done");
    setLang(k.lang);
    if (vault) {
      setC({ id: k.id, title: k.title, original: vault.original, device: [], user: [], overrides: {}, analysis: k.analysis, where: "in_cloud", frozen: { outbound: k.redactedText, entities: vault.entities } });
    } else {
      setC({ id: k.id, title: k.title, original: k.redactedText, device: [], user: [], overrides: {}, analysis: k.analysis, where: "in_cloud", frozen: { outbound: k.redactedText, entities: [] } });
    }
    setStage(k.analysis ? "results" : "review");
  };

  const home = () => {
    runId.current++;
    setStage("intake");
    setC(null);
    setScan("idle");
    setError(undefined);
  };

  return (
    <div className="shell">
      <TopBar device={device} online={online} onHome={home} onReceipt={() => setReceipt(true)} />

      {!isConfigured && (
        <div className="banner warn">
          <div>
            <strong>Firebase isn't configured in this build.</strong>
            <p>The on-device rule shield works, but AI features need the Firebase config in <code>.env.local</code>. See the README.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="banner alert" role="alert">
          <div>
            <strong>{error}</strong>
          </div>
        </div>
      )}

      {stage === "intake" && (
        <Intake
          busy={busy}
          transcript={transcript}
          onText={(t, title) => void start(t, title)}
          onImage={onImage}
          history={history}
          onOpenCase={(k) => void openCase(k)}
          onDeleteCase={(id) => void deleteCase(user?.uid, id).then(refreshHistory)}
        />
      )}

      {stage === "review" && c && shielded && (
        <Review
          title={c.title}
          original={c.original}
          entities={shielded.entities}
          outbound={shielded.outbound}
          leaks={shielded.leaks}
          gist={c.gist}
          scan={scan}
          scanProgress={scanProgress}
          lang={lang}
          online={online}
          sending={sending}
          onLang={setLang}
          onToggle={toggle}
          onAdd={addUser}
          onSend={() => void send()}
          onBack={home}
        />
      )}

      {stage === "results" && c?.analysis && shielded && (
        <Results
          analysis={c.analysis}
          where={c.where ?? "in_cloud"}
          entities={shielded.entities}
          original={c.original}
          outbound={shielded.outbound}
          lang={lang}
          deviceReady={device.state === "available"}
          online={online}
          onBack={home}
          onReview={() => setStage("review")}
        />
      )}

      {consent && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-h">
          <div className="box">
            <h2 id="consent-h">Read this photo in the cloud?</h2>
            <p>
              Reading photos privately needs Gemini Nano with image input, which this browser doesn't have. If the cloud reads
              it, Google's model will see everything in the photo, including your name and numbers.
            </p>
            <p>The safer option is to type or paste the letter's text. Airlock will then redact it on this device before anything is sent.</p>
            <div className="actions">
              <button className="btn ghost" onClick={() => void readImage(consent, true)}>
                Send the photo to the cloud
              </button>
              <button className="btn primary" onClick={() => setConsent(null)}>
                I'll paste the text instead
              </button>
            </div>
          </div>
        </div>
      )}

      {receipt && <Receipt onClose={() => setReceipt(false)} protectedCount={shielded?.entities.filter((e) => e.redact).length ?? 0} />}

      <footer className="footer">
        <span>Airlock is not legal, medical or financial advice. Check important decisions with a professional or legal aid.</span>
        <span>Built with Firebase AI Logic hybrid inference.</span>
      </footer>
    </div>
  );
}
