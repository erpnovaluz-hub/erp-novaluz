"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SupportBanner({ empresaNome }: { empresaNome: string }) {
  const router = useRouter();
  async function sair() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from("perfis").update({ empresa_ativa: null }).eq("id", user.id);
    router.refresh();
    router.push("/admin");
  }
  return (
    <div className="no-print flex items-center justify-between bg-purple-700 px-4 py-2 text-sm text-white">
      <span>🛟 <b>Modo suporte</b> — você está operando na empresa <b>{empresaNome}</b></span>
      <button onClick={sair} className="rounded-lg bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30">Sair do modo suporte</button>
    </div>
  );
}
