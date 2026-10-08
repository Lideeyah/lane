"use client";
import { useEffect, useState } from "react";

const FRAMES = [
  { title: "Fingerprint", body: "Open Lane and touch the sensor. That is the whole sign up." },
  { title: "12.50", body: "Type the amount on the pad.", num: true },
  { title: "Code", body: "Turn the phone round. The customer scans and pays." },
  { title: "Paid", body: "Both screens confirm in about a second.", paid: true },
];

/** Silent, looping, no network. The first frame stands on its own if scripts never run. */
export function ProofLoop() {
  const [i, setI] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % FRAMES.length), 1800);
    return () => window.clearInterval(t);
  }, []);
  const f = FRAMES[i];
  return (
    <div className="frame" aria-live="off">
      <div className="steps" style={{ width: "100%" }} aria-hidden>
        {FRAMES.map((_, n) => (
          <span key={n} className={n <= i ? "on" : ""} />
        ))}
      </div>
      {f.title === "Fingerprint" && <FingerprintGlyph />}
      {f.title === "Code" && <CodeGlyph />}
      <p className={f.num ? "amount-display amount-lg" : "paid-word"} style={f.paid ? undefined : f.num ? undefined : { color: "var(--ink)", fontSize: 26 }}>
        {f.title}
      </p>
      <p className="muted">{f.body}</p>
      {reduced && (
        <ol className="small muted" style={{ textAlign: "left" }}>
          {FRAMES.map((x) => (
            <li key={x.title}>{x.body}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FingerprintGlyph() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M12 11v3a6 6 0 0 1-1 3.5" />
      <path d="M8.5 9.5A4 4 0 0 1 16 11v2a10 10 0 0 1-.7 3.6" />
      <path d="M5.5 8A7 7 0 0 1 19 11v1" />
      <path d="M8 12v1.5a8 8 0 0 1-1.5 4.6" />
      <path d="M4 12.5V11" />
    </svg>
  );
}

function CodeGlyph() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14v2" />
    </svg>
  );
}
