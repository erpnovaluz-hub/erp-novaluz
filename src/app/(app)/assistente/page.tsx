import ChatAssistente from "@/components/ChatAssistente";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sb = await createClient();
  const { data: prem } = await sb
    .from("premissas_agente")
    .select("valor")
    .eq("chave", "nome_assistente")
    .maybeSingle();
  const nome = prem?.valor || "Assistente";

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-3 py-4">
      <h1 className="mb-1 text-lg font-semibold">🤖 {nome}</h1>
      <p className="mb-3 text-xs text-gray-500">
        Preenche e mantém tarefas a seu pedido. Age com as suas permissões e mostra o que fez.
      </p>
      <ChatAssistente nome={nome} />
    </div>
  );
}
