"use client";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const;

export function nextAmountText(current: string, key: string): string {
  if (key === "⌫") return current.slice(0, -1);
  if (key === ".") return current.includes(".") ? current : current === "" ? "0." : current + ".";
  const [, frac] = current.split(".");
  if (frac !== undefined && frac.length >= 2) return current;
  if (current === "0") return key;
  if (current.replace(".", "").length >= 9) return current;
  return current + key;
}

export function Pad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="pad" role="group" aria-label="Number pad">
      {KEYS.map((k) => (
        <button key={k} type="button" onClick={() => onKey(k)} aria-label={k === "⌫" ? "Delete" : k}>
          {k}
        </button>
      ))}
    </div>
  );
}
