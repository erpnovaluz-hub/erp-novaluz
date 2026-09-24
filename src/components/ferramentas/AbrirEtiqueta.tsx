"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Destino do QR da etiqueta (/f/FER-0001): acha a ferramenta pelo código e abre a ficha.
export default function AbrirEtiqueta({ codigo }: { codigo: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [naoAchou, setNaoAchou] = useState(false);

  useEffect(() => {
    supabase.from("ferramentas").select("id").eq("codigo", decodeURIComponent(codigo).toUpperCase()).maybeSingle()
      .then(({ data }) => { if (data) router.replace(`/estoque/ferramentas/${data.id}`); else setNaoAchou(true); });
  }, [supabase, router, codigo]);

  return (
    <div className="mx-auto mt-16 max-w-sm text-center text-sm text-gray-500">
      {naoAchou ? (
        <div className="card p-6">
          <p className="text-3xl">🏷️</p>
          <p className="mt-2">Etiqueta <b>{decodeURIComponent(codigo)}</b> não encontrada (ou seu perfil não vê ferramentas).</p>
          <Link href="/estoque/ferramentas" className="btn-primary mt-4 inline-block">Ver ferramentas</Link>
        </div>
      ) : "Abrindo…"}
    </div>
  );
}
