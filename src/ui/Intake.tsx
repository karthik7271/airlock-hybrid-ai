import { useRef, useState } from "react";
import { SAMPLE_LETTERS } from "../samples/letters";
import type { CloudCase } from "../state/cases";

export interface IntakeProps {
  busy: string | null;
  transcript: string | null;
  onText: (text: string, title: string) => void;
  onImage: (file: File) => void;
  history: Array<CloudCase & { hasVault: boolean }>;
  onOpenCase: (c: CloudCase) => void;
  onDeleteCase: (id: string) => void;
}

export function Intake({ busy, transcript, onText, onImage, history, onOpenCase, onDeleteCase }: IntakeProps) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (f?: File | null) => {
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) {
      alertInline("Airlock reads PNG or JPEG photos. For a PDF, copy its text and paste it here.");
      return;
    }
    onImage(f);
  };
  const [inlineMsg, setInlineMsg] = useState<string>();
  const alertInline = (m: string) => setInlineMsg(m);

  return (
    <>
      <section className="intake">
        <div>
          <h1>Get help with a scary letter without giving away who you are.</h1>
          <p className="lede">
            Medical bills, insurance denials, eviction notices, tax letters. Airlock strips your personal details on this
            computer, asks a powerful cloud AI what the letter means and what to do, then puts your details back. The cloud only
            ever sees placeholders.
          </p>
          <ol className="flow" aria-label="How Airlock works">
            <li>
              <div>
                <b>Gemini Nano reads it on your device</b>
                <span>Names, addresses, account and ID numbers are found locally, by AI and by rules.</span>
              </div>
            </li>
            <li>
              <div>
                <b>You check what will leave</b>
                <span>See the original and the redacted copy side by side. Hide or keep anything.</span>
              </div>
            </li>
            <li className="cloud">
              <div>
                <b>Gemini in the cloud explains it</b>
                <span>Deadlines, money, your rights, a reply letter, all written against placeholders.</span>
              </div>
            </li>
            <li>
              <div>
                <b>Your details come back, on your device</b>
                <span>Placeholders are swapped back locally. The receipt shows every byte that left.</span>
              </div>
            </li>
          </ol>
        </div>

        <div>
          <div
            className={`envelope${dragging ? " dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            <h2>Your letter</h2>
            <p className="hint">Paste the text, or add a photo. Nothing is sent until you approve it.</p>
            <label className="sr-only" htmlFor="letter">
              Letter text
            </label>
            <textarea
              id="letter"
              placeholder="Paste the letter here…"
              value={transcript ?? text}
              readOnly={transcript !== null}
              onChange={(e) => setText(e.target.value)}
            />
            {inlineMsg && (
              <p className="hint" role="alert" style={{ color: "var(--alert)" }}>
                {inlineMsg}
              </p>
            )}
            <div className="row">
              <label className="btn ghost small file-btn">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" capture="environment" onChange={(e) => pickFile(e.target.files?.[0])} />
                Add a photo
              </label>
              <span className="spacer" />
              {busy && (
                <span className="scan-state" role="status">
                  <span className="spinner" /> {busy}
                </span>
              )}
              <button className="btn primary" disabled={!text.trim() || !!busy} onClick={() => onText(text, "Pasted letter")}>
                Check this letter
              </button>
            </div>
          </div>

          <div className="samples">
            <h3>No letter handy? Try a sample (all fictional)</h3>
            <div className="sample-grid">
              {SAMPLE_LETTERS.map((s) => (
                <button key={s.id} className="sample" disabled={!!busy} onClick={() => onText(s.text, s.title)}>
                  <span className="ic" aria-hidden="true">
                    {s.icon}
                  </span>
                  <b>{s.title}</b>
                  <span>{s.blurb}</span>
                </button>
              ))}
            </div>
            <p className="hint" style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 10 }}>
              Want to test photo reading?{" "}
              <a href="/samples/medical-bill.png" download>
                Download the sample bill as a photo
              </a>{" "}
              and add it above.
            </p>
          </div>
        </div>
      </section>

      {history.length > 0 && (
        <section className="history" aria-labelledby="hist">
          <h2 id="hist">Your saved cases</h2>
          <p className="hint">
            Stored in the cloud with placeholders only. Your details are restored from the encrypted vault on this device.
          </p>
          <ul>
            {history.map((c) => (
              <li key={c.id}>
                <div className="grow">
                  <div className="t">{c.title}</div>
                  <div className="s">
                    {c.docType} · {c.protectedCount} details protected ·{" "}
                    {c.hasVault ? "vault on this device" : "vault not on this device, placeholders only"}
                  </div>
                </div>
                <button className="btn ghost small" onClick={() => onOpenCase(c)}>
                  Open
                </button>
                <button className="btn ghost small" onClick={() => onDeleteCase(c.id)} aria-label={`Delete ${c.title}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
