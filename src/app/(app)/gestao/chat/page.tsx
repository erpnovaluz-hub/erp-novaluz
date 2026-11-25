import Link from "next/link";
import ChatAssistente from "@/components/ChatAssistente";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ATALHOS = [
  "Como estamos nas metas este mês?",
  "Quem está com encaminhamento atrasado?",
  "Monte a pauta da próxima reunião",
  "O que ficou pendente da última semanal?",
  "Anotar na ata aberta…",
];

// Chat de gestão (Ritmo de Gestão · Bloco 3). ?sobre=texto pré-preenche o campo
// (vem do botão "Pedir ajuda" da tela da reunião).
export default async function GestaoChatPage(props: { searchParams: Promise<{ sobre?: string }> }) {
  const { sobre } = await props.searchParams;
  const sb = await createClient();
  const { data: prem } = await sb.from("premissas_agente").select("valor").eq("chave", "nome_assistente").maybeSingle();
  const nome = prem?.valor || "Assistente";
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col px-3 py-4">
      <Link href="/gestao" className="text-xs text-brand-700 hover:underline">← Ritmo de Gestão</Link>
      <h1 className="mb-1 text-lg font-semibold">💬 Conversa de gestão</h1>
      <p className="mb-3 text-xs text-gray-500">
        Reuniões, atas, encaminhamentos e indicadores. Analisa com você, monta pauta e anota na ata aberta — com as suas permissões.
      </p>
      <ChatAssistente nome={nome} modo="gestao" atalhos={ATALHOS} inicial={sobre ? `${sobre} ` : ""}
        vazio="Pergunte sobre metas, reuniões e encaminhamentos, peça a pauta da próxima reunião ou dite o que anotar na ata. Criar reunião e lançar valor de indicador viram cartão para você confirmar; fechar a ata é sempre na tela." />
    </div>
  );
}
