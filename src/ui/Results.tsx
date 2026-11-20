import { useMemo, useRef, useState } from "react";
import type { Where } from "../ai/ledger";
import {
  answerInCloud,
  answerPrivately,
  DeviceUnavailableError,
  draftReply,
  explainTerm,
  routeQuestion,
  type Analysis,
} from "../ai/tasks";
import { redactWithVault, rehydrate } from "../shield/engine";
import type { Entity } from "../shield/types";
import { ChipIcon, CloudIcon, Restored, WhereBadge } from "./Restored";

interface Props {
  analysis: Analysis;
  where: Where;
  entities: Entity[];
  original: string;
  outbound: string;
  lang: string;
  deviceReady: boolean;
  online: boolean;
  onBack: () => void;
  onReview: () => void;
}

function daysUntil(iso?: string): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function Results(p: Props) {
  const a = p.analysis;
  const R = (t?: string) => <Restored text={t ?? ""} entities={p.entities} />;
  const [done, setDone] = useState<Set<number>>(new Set());
  const scam = a.scamRisk === "high" || (a.scamRisk === "medium" && a.redFlags.length > 0);
  const deadlines = useMemo(
    () => [...a.deadlines].sort((x, y) => (daysUntil(x.isoDate) ?? 1e9) - (daysUntil(y.isoDate) ?? 1e9)),
    [a.deadlines],
  );

  return (
    <div className="results">
      <main>
        <div className="verdict">
          <div className="meta">
            <span className={`tag u-${a.urgency}`}>{a.urgency === "critical" ? "Act now" : `${a.urgency[0].toUpperCase()}${a.urgency.slice(1)} urgency`}</span>
            <span className="tag">{a.docType}</span>
            <WhereBadge where={p.where} />
            <span className="tag device">{p.entities.filter((e) => e.redact).length} details never left</span>
          </div>
          <h1>{R(a.headline)}</h1>
          <p>{R(a.summary)}</p>
          {p.where === "on_device" && (
            <div className="banner device">
              <ChipIcon />
              <div>
                <strong>Analyzed by Gemini Nano because the cloud was unreachable.</strong>
                <p>This is a lighter model. When you're back online, re-run the analysis for a fuller answer.</p>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn ghost small" onClick={p.onReview}>
              Review what was sent
            </button>
            <button className="btn ghost small" onClick={p.onBack}>
              Check another letter
            </button>
          </div>
        </div>

        {scam && (
          <div className="scam" role="alert">
            <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
              <path d="M14 3 26 24H2L14 3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M14 11v6M14 20.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <div>
              <h2>This letter shows signs of a scam</h2>
              <ul>
                {a.redFlags.map((f, i) => (
                  <li key={i}>{R(f)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {deadlines.length > 0 && (
          <section className="section">
            <h2>Deadlines</h2>
            <ul className="deadlines">
              {deadlines.map((d, i) => {
                const n = daysUntil(d.isoDate);
                return (
                  <li className="deadline" key={i}>
                    <div className={`countdown${n !== null && n <= 14 ? " soon" : ""}`}>
                      {n === null ? (
                        <>
                          <b>–</b>
                          <span>see date</span>
                        </>
                      ) : n < 0 ? (
                        <>
                          <b>{-n}</b>
                          <span>days ago</span>
                        </>
                      ) : (
                        <>
                          <b>{n}</b>
                          <span>{n === 1 ? "day left" : "days left"}</span>
                        </>
                      )}
                    </div>
                    <div>
                      <div className="what">{R(d.what)}</div>
                      <div className="when">{R(d.date)}</div>
                      {d.ifMissed && <div className="miss">If missed: {R(d.ifMissed)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {a.money.length > 0 && (
          <section className="section">
            <h2>The money</h2>
            <table className="money">
              <tbody>
                {a.money.map((m, i) => (
                  <tr key={i}>
                    <td>
                      {R(m.label)}
                      {m.note && <span className="note">{R(m.note)}</span>}
                    </td>
                    <td className="amt">{R(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {a.actions.length > 0 && (
          <section className="section">
            <h2>What to do next</h2>
            <ol className="steps">
              {a.actions.map((s, i) => (
                <li key={i} className={done.has(i) ? "done" : ""}>
                  <input
                    type="checkbox"
                    aria-label={`Mark step ${i + 1} done`}
                    checked={done.has(i)}
                    onChange={() =>
                      setDone((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  />
                  <div>
                    <span className="s">{R(s.step)}</span>
                    {s.why && <span className="why">{R(s.why)}</span>}
                  </div>
                  <span className={`when-tag${s.when === "now" ? " now" : ""}`}>{s.when}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="section two-col">
          {a.options.length > 0 && (
            <div>
              <h2 style={{ fontSize: 19, margin: "0 0 12px" }}>Your rights and options</h2>
              <ul className="bullets">
                {a.options.map((o, i) => (
                  <li key={i}>{R(o)}</li>
                ))}
              </ul>
            </div>
          )}
          {a.questions.length > 0 && (
            <div>
              <h2 style={{ fontSize: 19, margin: "0 0 12px" }}>Questions to ask them</h2>
              <ul className="bullets">
                {a.questions.map((o, i) => (
                  <li key={i}>{R(o)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {!scam && a.redFlags.length > 0 && (
          <section className="section">
            <h2>Worth double-checking</h2>
            <ul className="bullets">
              {a.redFlags.map((f, i) => (
                <li key={i}>{R(f)}</li>
              ))}
            </ul>
          </section>
        )}

        <Jargon analysis={a} lang={p.lang} />
      </main>

      <aside className="rail">
        <Ask {...p} />
        <Reply {...p} />
      </aside>
    </div>
  );
}

function Jargon({ analysis, lang }: { analysis: Analysis; lang: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [def, setDef] = useState<{ term: string; text: string; where: Where } | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (term: string) => {
    if (!term.trim()) return;
    setBusy(true);
    try {
      const r = await explainTerm(term.trim(), analysis.docType, lang);
      setDef({ term, text: r.text.trim(), where: r.where });
    } catch (e) {
      setDef({ term, text: (e as Error).message, where: "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <h2>Words in this letter</h2>
      <div className="jargon">
        {analysis.jargon.map((j, i) => (
          <button key={i} aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            {j.term}
          </button>
        ))}
      </div>
      {open !== null && analysis.jargon[open] && (
        <div className="term-def">
          <p>
            <b>{analysis.jargon[open].term}:</b> {analysis.jargon[open].meaning}
          </p>
        </div>
      )}
      <form
        className="ask-form"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(custom);
        }}
      >
        <label className="sr-only" htmlFor="term">
          Look up another word
        </label>
        <input id="term" placeholder="Look up any other word or phrase" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn ghost small" disabled={busy || !custom.trim()}>
          {busy ? <span className="spinner" /> : "Explain"}
        </button>
      </form>
      {def && (
        <div className="term-def" role="status">
          <p>
            <b>{def.term}:</b> {def.text}
          </p>
          <WhereBadge where={def.where} />
        </div>
      )}
    </section>
  );
}

interface Msg {
  q: string;
  sentAs?: string;
  a: string;
  where?: Where;
  route?: string;
  pending?: boolean;
}

function Ask(p: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const busy = msgs.some((m) => m.pending);
  const endRef = useRef<HTMLDivElement>(null);

  const update = (i: number, patch: Partial<Msg>) => setMsgs((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ("");
    const idx = msgs.length;
    const { text: redactedQ } = redactWithVault(question, p.entities);
    setMsgs((m) => [...m, { q: question, a: "", pending: true }]);
    try {
      // Tier 2: the router only ever sees the redacted question.
      let route: "letter_lookup" | "needs_expertise" = "needs_expertise";
      try {
        route = (await routeQuestion(redactedQ)).route;
      } catch {
        /* router unavailable: default to cloud with redacted context */
      }
      const history = msgs
        .slice(-3)
        .map((m) => `Q: ${m.sentAs ?? redactWithVault(m.q, p.entities).text}\nA: ${m.a}`)
        .join("\n");

      let acc = "";
      if (route === "letter_lookup" && p.deviceReady) {
        update(idx, { route: "Answered from your letter, privately" });
        try {
          for await (const c of answerPrivately(p.original, question)) {
            acc += c.delta;
            update(idx, { a: acc, where: c.where });
          }
          update(idx, { pending: false });
          return;
        } catch (e) {
          if (!(e instanceof DeviceUnavailableError)) throw e;
          acc = "";
        }
      }
      update(idx, { route: "Needs expertise, asked Gemini with placeholders", sentAs: redactedQ });
      for await (const c of answerInCloud(p.outbound, p.analysis, redactedQ, history, p.lang)) {
        acc += c.delta;
        update(idx, { a: acc, where: c.where });
      }
      update(idx, { pending: false });
    } catch (e) {
      update(idx, { a: `Couldn't answer: ${(e as Error).message}`, pending: false });
    } finally {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  };

  const suggestions = ["What is my account number?", "Can I negotiate this down?", "What happens if I ignore it?", "Is this legit?"];

  return (
    <section className="panel" aria-labelledby="ask-h">
      <h2 id="ask-h">Ask about this letter</h2>
      <p className="hint">Simple lookups are answered by Gemini Nano from your real letter. Harder questions go to the cloud with your details swapped out.</p>
      {msgs.length > 0 && (
        <div className="chat" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} style={{ display: "grid", gap: 8 }}>
              <div className="msg q">{m.q}</div>
              <div className="msg a">
                {m.a ? <Restored text={m.a} entities={p.entities} /> : <span className="spinner" />}
                <div className="badge">
                  {m.where === "on_device" ? <ChipIcon /> : m.where === "in_cloud" ? <CloudIcon /> : null}
                  {m.route ?? "Routing…"}
                </div>
                {m.sentAs && m.sentAs !== m.q && <div className="sent-as">Sent as: {m.sentAs}</div>}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      {msgs.length === 0 && (
        <div className="suggest">
          {suggestions.map((s) => (
            <button key={s} onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(q);
        }}
      >
        <label className="sr-only" htmlFor="askq">
          Your question
        </label>
        <input id="askq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" />
        <button className="btn primary small" disabled={busy || !q.trim()}>
          Ask
        </button>
      </form>
    </section>
  );
}

function Reply(p: Props) {
  const goals = p.analysis.replyGoals.length ? p.analysis.replyGoals : ["Ask for more information"];
  const [goal, setGoal] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string>();

  const write = async (g: string) => {
    setGoal(g);
    setDraft("");
    setErr(undefined);
    setBusy(true);
    try {
      let acc = "";
      for await (const c of draftReply(p.outbound, p.analysis, g, p.lang)) {
        acc += c.delta;
        setDraft(acc);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restored = rehydrate(draft, p.entities);

  return (
    <section className="panel" aria-labelledby="reply-h">
      <h2 id="reply-h">Write a reply</h2>
      <p className="hint">Drafted in the cloud with placeholders. Your name and numbers are filled in here.</p>
      <div className="goals">
        {goals.map((g) => (
          <button key={g} className={goal === g ? "on" : ""} disabled={busy} onClick={() => void write(g)}>
            {g}
          </button>
        ))}
      </div>
      {err && <p style={{ color: "var(--alert)", fontSize: 14 }}>{err}</p>}
      {(draft || busy) && (
        <>
          <div className="draft" aria-live="polite">
            {draft ? <Restored text={draft} entities={p.entities} /> : <span className="spinner" />}
          </div>
          <div className="actions">
            <button
              className="btn ghost small"
              disabled={!draft || busy}
              onClick={async () => {
                await navigator.clipboard.writeText(restored);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? "Copied" : "Copy letter"}
            </button>
            <button
              className="btn ghost small"
              disabled={!draft || busy}
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([restored], { type: "text/plain" }));
                a.download = "reply-letter.txt";
                a.click();
              }}
            >
              Download .txt
            </button>
          </div>
        </>
      )}
    </section>
  );
}
