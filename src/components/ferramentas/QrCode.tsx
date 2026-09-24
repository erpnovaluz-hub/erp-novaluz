"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// QR em SVG (nítido na impressão). margin 0: a etiqueta já tem respiro.
export default function QrCode({ texto, tamanho = 96 }: { texto: string; tamanho?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let vivo = true;
    QRCode.toString(texto, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
      .then((s) => { if (vivo) setSvg(s); })
      .catch(() => setSvg(""));
    return () => { vivo = false; };
  }, [texto]);
  return (
    <div role="img" aria-label={`QR code: ${texto}`} style={{ width: tamanho, height: tamanho }}
      className="[&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
