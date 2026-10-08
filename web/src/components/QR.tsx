"use client";
import { create } from "qrcode";
import { useMemo } from "react";

/** Renders a QR code as inline SVG rects, so no markup is injected and no image is fetched. */
export function QR({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = create(value, { errorCorrectionLevel: "M" });
    const n = code.modules.size;
    const d = code.modules.data;
    let p = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (d[y * n + x]) p += `M${x} ${y}h1v1h-1z`;
    return { size: n, path: p };
  }, [value]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <path d={path} fill="#14110E" />
    </svg>
  );
}
