"use client";

// Abre o WhatsApp com uma mensagem pronta. phone opcional (formato BR).
export default function WhatsAppButton({ text, phone, label = "WhatsApp" }: { text: string; phone?: string; label?: string }) {
  let num = "";
  if (phone) {
    const d = phone.replace(/\D/g, "");
    num = d.length === 10 || d.length === 11 ? "55" + d : d; // prepende DDI Brasil se faltar
  }
  const href = `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="no-print inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-green-700 ring-1 ring-green-300 hover:bg-green-50">
      🟢 {label}
    </a>
  );
}
