import { useEffect } from "react";
import { ledger, TIER_INFO, type Tier } from "../ai/ledger";
import { useLedger } from "./TopBar";

const WHERE_LABEL = { on_device: "On device", in_cloud: "Cloud", blocked: "Skipped", failed: "Failed" } as const;

export function Receipt({ onClose, protectedCount }: { onClose: () => void; protectedCount: number }) {
  const entries = useLedger();
  const stats = ledger.stats();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const download = () => {
    const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), stats, protectedCount, calls: entries }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "airlock-privacy-receipt.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <header>
          <div style={{ flex: 1 }}>
            <h2 id="receipt-title">Privacy receipt</h2>
            <p>Every AI call this session: where it ran, and the exact text that left your device. Kept only in this tab.</p>
          </div>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="body">
          <div className="stats">
            <div className="stat">
              <b style={{ color: "var(--device)" }}>{stats.device}</b>
              <span>calls on this device</span>
            </div>
            <div className="stat">
              <b style={{ color: "var(--cloud)" }}>{stats.cloud}</b>
              <span>calls to the cloud ({(stats.bytesOut / 1024).toFixed(1)} KB, redacted)</span>
            </div>
            <div className="stat">
              <b>{protectedCount}</b>
              <span>personal details that never left</span>
            </div>
          </div>

          <div className="tiers">
            {(Object.keys(TIER_INFO) as Tier[]).map((t) => (
              <div className="tier" key={t}>
                <div>
                  <b>{TIER_INFO[t].label}</b>
                  <br />
                  <code>{TIER_INFO[t].mode}</code>
                </div>
                <div>{TIER_INFO[t].why}</div>
              </div>
            ))}
          </div>

          {entries.length === 0 ? (
            <p style={{ color: "var(--ink-3)" }}>No AI calls yet. Open a letter to start.</p>
          ) : (
            <ul className="entries">
              {[...entries].reverse().map((e) => (
                <li className="entry" key={e.id}>
                  <div className="top">
                    <span className="grow">{e.task}</span>
                    <span className={`where ${e.where}`}>{WHERE_LABEL[e.where]}</span>
                    <span className="ms">{e.ms} ms</span>
                  </div>
                  <div className="note">
                    {TIER_INFO[e.tier].label} at {new Date(e.at).toLocaleTimeString()}, mode <code>{e.mode}</code>
                  </div>
                  {e.note && <div className="note">{e.note}</div>}
                  {e.outbound && (
                    <details>
                      <summary>Show exactly what was sent</summary>
                      <pre>{e.outbound}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn ghost small" onClick={download} disabled={!entries.length}>
              Download receipt (JSON)
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
