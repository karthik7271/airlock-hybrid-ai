import { useEffect, useRef, useState } from "react";
import { DEVICE_COPY } from "../ai/device";
import { ledger, type LedgerEntry } from "../ai/ledger";
import { Logo } from "./Restored";
import type { DeviceInfo } from "./useDevice";

export function useLedger(): LedgerEntry[] {
  const [entries, setEntries] = useState<LedgerEntry[]>(ledger.all());
  useEffect(() => ledger.subscribe(setEntries), []);
  return entries;
}

export function TopBar({ device, online, onHome, onReceipt }: { device: DeviceInfo; online: boolean; onHome: () => void; onReceipt: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const entries = useLedger();
  const stats = ledger.stats();
  void entries;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const s = device.state;
  const copy = DEVICE_COPY[s];
  const dotClass = s === "available" ? "device" : s === "downloading" || s === "checking" ? "warn pulse" : "warn";
  const short =
    s === "available" ? "Gemini Nano on" : s === "downloading" ? "Downloading Nano" : s === "downloadable" ? "Turn on Gemini Nano" : s === "checking" ? "Checking…" : "Rules-only shield";

  return (
    <header className="topbar">
      <button className="wordmark" onClick={onHome} aria-label="Airlock home">
        <Logo />
        Airlock
      </button>
      <div className="spacer" />
      {!online && (
        <span className="pill" role="status">
          <span className="dot warn" /> <span className="lbl">Offline: on-device only</span>
        </span>
      )}
      <div style={{ position: "relative" }} ref={ref}>
        <button className="pill" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className={`dot ${dotClass}`} />
          <span className="lbl">{short}</span>
        </button>
        {open && (
          <div className="device-pop" role="dialog" aria-label="On-device model">
            <h3>{copy.title}</h3>
            <p>{copy.detail}</p>
            {s === "available" && (
              <p>
                Reading photos on-device: <b>{device.images ? "on" : "off"}</b>
                {!device.images && (
                  <>
                    {" "}
                    (enable <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>)
                  </>
                )}
              </p>
            )}
            {(s === "downloadable" || s === "downloading") && (
              <>
                {device.progress !== null && (
                  <div className="progress" aria-label="Download progress">
                    <i style={{ width: `${Math.round(device.progress * 100)}%` }} />
                  </div>
                )}
                <button className="btn primary small" onClick={() => void device.enable()} disabled={device.progress !== null}>
                  {device.progress !== null ? `Downloading ${Math.round(device.progress * 100)}%` : "Download Gemini Nano"}
                </button>
              </>
            )}
            {(s === "unsupported" || s === "unavailable") && (
              <p>
                <a href="https://developer.chrome.com/docs/ai/get-started" target="_blank" rel="noreferrer">
                  Gemini Nano requirements
                </a>
              </p>
            )}
            {device.error && <p style={{ color: "var(--alert)" }}>{device.error}</p>}
          </div>
        )}
      </div>
      <button className="pill" onClick={onReceipt} aria-label={`Privacy receipt: ${stats.device} on device, ${stats.cloud} in cloud`}>
        <span className="dot device" />
        <span>{stats.device}</span>
        <span className="dot cloud" />
        <span>{stats.cloud}</span>
        <span className="lbl">Privacy receipt</span>
      </button>
    </header>
  );
}
