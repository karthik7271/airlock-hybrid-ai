import { useMemo } from "react";
import { rehydrateSegments } from "../shield/engine";
import { TYPE_LABELS, type Entity } from "../shield/types";

/**
 * Render model output with placeholders swapped back to real values, on-device.
 * Restored values get a highlighter mark so you can see what the cloud never saw.
 */
export function Restored({ text, entities }: { text: string; entities: Entity[] }) {
  // Models occasionally slip into markdown; strip emphasis markers rather than render them raw.
  const segs = useMemo(() => rehydrateSegments((text ?? "").replace(/\*\*(.+?)\*\*/g, "$1"), entities), [text, entities]);
  return (
    <>
      {segs.map((s, i) =>
        s.entity ? (
          <span key={i} className="restored" title={`${TYPE_LABELS[s.entity.type]}: restored on your device. The cloud saw ${s.entity.placeholder}.`}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export const CloudIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 12.5h7a2.75 2.75 0 0 0 .4-5.47A4 4 0 0 0 4.2 7.6 2.5 2.5 0 0 0 4.5 12.5Z" fill="currentColor" />
  </svg>
);

export const ChipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const DoorIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M3 9h12M11 5l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <pattern id="lt" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="4" fill="#9fb3cf" />
        </pattern>
      </defs>
      <rect className="body" x="2" y="6" width="28" height="20" rx="3" fill="#14213d" />
      <rect className="page" x="5" y="9" width="10" height="14" rx="1.5" fill="#f4f6f8" />
      <rect x="17" y="9" width="10" height="14" rx="1.5" fill="url(#lt)" />
      <rect className="body" x="7" y="12" width="6" height="1.6" rx=".8" fill="#14213d" />
      <rect x="7" y="15.5" width="4" height="1.6" rx=".8" fill="#1e7a55" />
    </svg>
  );
}

export function WhereBadge({ where }: { where?: string }) {
  if (where === "on_device")
    return (
      <span className="tag device">
        <ChipIcon /> On this device
      </span>
    );
  if (where === "in_cloud")
    return (
      <span className="tag cloud">
        <CloudIcon /> Cloud, redacted
      </span>
    );
  return null;
}
