import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGES } from "../ai/tasks";
import { PLACEHOLDER_RE, type Leak } from "../shield/engine";
import { CONTEXT_TYPES, TYPE_LABELS, type Entity, type EntityType } from "../shield/types";
import { ChipIcon, CloudIcon, DoorIcon, LockIcon } from "./Restored";

export type ScanState = "idle" | "scanning" | "done" | "unavailable" | "error";

interface Props {
  title: string;
  original: string;
  entities: Entity[];
  outbound: string;
  leaks: Leak[];
  gist?: string;
  scan: ScanState;
  scanProgress?: string;
  lang: string;
  online: boolean;
  sending: boolean;
  onLang: (l: string) => void;
  onToggle: (e: Entity) => void;
  onAdd: (text: string, type: EntityType) => void;
  onSend: () => void;
  onBack: () => void;
}

function OriginalSheet({ original, entities, onToggle }: { original: string; entities: Entity[]; onToggle: (e: Entity) => void }) {
  const segs = useMemo(() => {
    const spans = entities
      .flatMap((e) => e.spans.map((s) => ({ ...s, e })))
      .sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; e?: Entity }> = [];
    let last = 0;
    for (const s of spans) {
      if (s.start < last) continue;
      if (s.start > last) out.push({ text: original.slice(last, s.start) });
      out.push({ text: original.slice(s.start, s.end), e: s.e });
      last = s.end;
    }
    out.push({ text: original.slice(last) });
    return out;
  }, [original, entities]);

  return (
    <>
      {segs.map((s, i) =>
        s.e ? (
          <mark
            key={i}
            className={`ent ${s.e.type}${s.e.redact ? "" : " kept"}`}
            title={`${TYPE_LABELS[s.e.type]}: ${s.e.redact ? `replaced with ${s.e.placeholder}` : "kept for context"}. Click to ${s.e.redact ? "keep" : "hide"}.`}
            onClick={() => onToggle(s.e!)}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function OutboundSheet({ outbound }: { outbound: string }) {
  const seen = useRef(new Set<string>());
  const parts = useMemo(() => {
    const out: Array<{ text: string; ph?: boolean; fresh?: boolean }> = [];
    let last = 0;
    for (const m of outbound.matchAll(PLACEHOLDER_RE)) {
      if (m.index! > last) out.push({ text: outbound.slice(last, m.index!) });
      out.push({ text: m[0], ph: true, fresh: !seen.current.has(m[0]) });
      last = m.index! + m[0].length;
    }
    out.push({ text: outbound.slice(last) });
    return out;
  }, [outbound]);
  useEffect(() => {
    for (const p of parts) if (p.ph) seen.current.add(p.text);
  }, [parts]);
  return (
    <>
      {parts.map((p, i) =>
        p.ph ? (
          <span key={i} className={`ph${p.fresh ? " fresh" : ""}`}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const GROUPS: Array<{ label: string; types: EntityType[] }> = [
  { label: "People", types: ["PERSON"] },
  { label: "Where you live and how to reach you", types: ["ADDRESS", "EMAIL", "PHONE"] },
  { label: "Numbers that identify you", types: ["GOV_ID", "ACCOUNT", "FINANCIAL", "DOB"] },
  { label: "Context (kept unless you hide it)", types: ["ORG", "HEALTH"] },
];

export function Review(p: Props) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const hidden = p.entities.filter((e) => e.redact);
  const kept = p.entities.filter((e) => !e.redact);

  useEffect(() => {
    const onUp = () => {
      const s = window.getSelection();
      const t = s?.toString().trim() ?? "";
      if (!s || !t || t.length < 2 || t.length > 120 || !localRef.current?.contains(s.anchorNode)) {
        setSel(null);
        return;
      }
      const r = s.getRangeAt(0).getBoundingClientRect();
      setSel({ text: t, x: Math.min(r.left, window.innerWidth - 300), y: Math.max(8, r.top - 50) });
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
    };
  }, []);

  const add = (type: EntityType) => {
    if (!sel) return;
    p.onAdd(sel.text, type);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <>
      <div className="stage-head">
        <div className="grow">
          <h1>Check what leaves your device</h1>
          <p>
            Left is your letter, which stays here. Right is the only thing the cloud will see. Click a highlight to hide or keep
            it, or select any text on the left to hide it.
          </p>
        </div>
        <button className="btn ghost small" onClick={p.onBack}>
          Start over
        </button>
      </div>

      {p.gist && (
        <div className="gist" role="status">
          <ChipIcon />
          <div>
            <small>Private first read by Gemini Nano, on this device</small>
            <p>{p.gist}</p>
          </div>
        </div>
      )}
      {p.scan === "unavailable" && (
        <div className="banner warn" role="status">
          <LockIcon />
          <div>
            <strong>Rule-based shield only.</strong>
            <p>
              Gemini Nano isn't available in this browser, so unlabeled names or health details may be missed. Read the right
              side carefully, and select anything that should be hidden.
            </p>
          </div>
        </div>
      )}

      <div className="airlock">
        <div className="chamber local">
          <div className="chamber-label">
            <span className="dot device" /> On this device <span className="sub">your letter, never uploaded</span>
          </div>
          <div className="sheet" ref={localRef} aria-label="Original letter">
            <OriginalSheet original={p.original} entities={p.entities} onToggle={p.onToggle} />
          </div>
        </div>
        <div className="seam" aria-hidden="true">
          <div className="door">
            <DoorIcon />
          </div>
        </div>
        <div className="chamber outbound">
          <div className="chamber-label">
            <span className="dot cloud" /> What the cloud will see <span className="sub">placeholders instead of you</span>
          </div>
          <div className="sheet" aria-label="Redacted letter that will be sent">
            <OutboundSheet outbound={p.outbound} />
          </div>
        </div>
      </div>

      <div className="inspector">
        <div className="ent-list">
          {GROUPS.map((g) => {
            const items = p.entities.filter((e) => g.types.includes(e.type));
            if (!items.length) return null;
            return (
              <div className="ent-group" key={g.label}>
                <h3>{g.label}</h3>
                <ul>
                  {items.map((e) => (
                    <li key={e.id} className={`chip${e.redact ? "" : " off"}`}>
                      <span className="v" title={e.value}>
                        {e.value}
                      </span>
                      <span className="src">{e.redact ? e.placeholder : "kept"}</span>
                      <button
                        className={`toggle${e.redact ? "" : " keep"}`}
                        onClick={() => p.onToggle(e)}
                        aria-label={`${e.redact ? "Keep" : "Hide"} ${TYPE_LABELS[e.type]} ${e.value}`}
                      >
                        {e.redact ? "Hidden" : "Visible"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!p.entities.length && <p style={{ color: "var(--ink-3)" }}>No personal details found yet.</p>}
        </div>

        <div className="sendbox">
          <h3>Ready to send</h3>
          <div className="meter">
            <div>
              <b>{hidden.length}</b> details hidden
            </div>
            <div>
              <b>{kept.filter((e) => !CONTEXT_TYPES.has(e.type)).length}</b> you chose to show
            </div>
          </div>
          <div className="scan-state" role="status">
            {p.scan === "scanning" && (
              <>
                <span className="spinner" style={{ color: "var(--device)" }} /> {p.scanProgress ?? "Gemini Nano is scanning for more…"}
              </>
            )}
            {p.scan === "done" && (
              <>
                <ChipIcon /> Scanned by rules and Gemini Nano
              </>
            )}
            {p.scan === "unavailable" && (
              <>
                <LockIcon /> Scanned by rules on this device
              </>
            )}
            {p.scan === "error" && (
              <>
                <LockIcon /> Gemini Nano scan failed, rules applied
              </>
            )}
          </div>
          {p.leaks.length > 0 && (
            <div className="leaks" role="alert">
              <b>Outbound check found possible personal data:</b>
              <ul>
                {p.leaks.map((l) => (
                  <li key={l.text}>
                    {l.text}{" "}
                    <button className="btn link" onClick={() => p.onAdd(l.text, l.type === "VALUE" ? "ACCOUNT" : l.type)}>
                      Hide it
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label>
            Explain it in
            <select value={p.lang} onChange={(e) => p.onLang(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn cloud" disabled={p.sending || p.scan === "scanning"} onClick={p.onSend}>
            {p.sending ? (
              <>
                <span className="spinner" /> Asking Gemini…
              </>
            ) : (
              <>
                <CloudIcon /> {p.online ? "Send redacted copy for analysis" : "Analyze on this device (offline)"}
              </>
            )}
          </button>
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "10px 0 0" }}>
            {p.scan === "scanning" ? "Waiting for Gemini Nano to finish. " : ""}
            Only the right-hand text is sent. You can see it again in the privacy receipt.
          </p>
        </div>
      </div>

      {sel && (
        <div className="selection-pop" style={{ left: sel.x, top: sel.y }} role="toolbar" aria-label="Hide selected text">
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => add("PERSON")}>
            Hide as name
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => add("ADDRESS")}>
            Address
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => add("ACCOUNT")}>
            Number
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => add("HEALTH")}>
            Health
          </button>
        </div>
      )}
    </>
  );
}
