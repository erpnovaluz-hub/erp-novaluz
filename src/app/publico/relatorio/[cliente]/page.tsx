import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import RelatorioPublicoView from "@/components/RelatorioPublicoView";

export const dynamic = "force-dynamic";

type SP = { de?: string; ate?: string; servico?: string; peca?: string };

export default async function RelatorioPublicoPage({
  params,
  searchParams,
}: {
  params: { cliente: string };
  searchParams: SP;
}) {
  const supabase = createAdminClient();
  const clienteId = params.cliente;

  const { data: cliente } = await supabase
    .from("clientes")
    .select("id, nome, empresa_consultora_id")
    .eq("id", clienteId)
    .maybeSingle();

  if (!cliente) notFound();

  const empresaId = (cliente as any).empresa_consultora_id;

  let q = supabase
    .from("producao")
    .select("data, peca_nome, servico_id, quantidade, peso_total, colaborador_id, valor_unit, valor_total")
    .eq("cliente_id", clienteId)
    .eq("empresa_consultora_id", empresaId);
  if (searchParams.de) q = q.gte("data", searchParams.de);
  if (searchParams.ate) q = q.lte("data", searchParams.ate);
  if (searchParams.servico) q = q.eq("servico_id", searchParams.servico);
  if (searchParams.peca?.trim()) q = q.ilike("peca_nome", `%${searchParams.peca.trim()}%`);

  const [{ data: rows }, { data: servicos }, { data: colaboradores }, { data: empresa }] = await Promise.all([
    q.order("data", { ascending: false }).range(0, 9999),
    supabase.from("servicos").select("id, nome").eq("empresa_consultora_id", empresaId),
    supabase.from("colaboradores").select("id, nome").eq("empresa_consultora_id", empresaId),
    supabase.from("empresas_consultoras").select("nome").eq("id", empresaId).maybeSingle(),
  ]);

  const servNome = Object.fromEntries((servicos ?? []).map((s) => [s.id, s.nome]));
  const colNome = Object.fromEntries((colaboradores ?? []).map((c) => [c.id, c.nome]));

  const linhas = (rows ?? []).map((r) => ({
    data: r.data,
    peca_nome: r.peca_nome,
    servico: servNome[r.servico_id] ?? "—",
    quantidade: Number(r.quantidade || 0),
    peso_total: Number(r.peso_total || 0),
    colaborador: colNome[r.colaborador_id] ?? "—",
    valor_unit: r.valor_unit,
    valor_total: r.valor_total,
  }));

  return (
    <RelatorioPublicoView
      empresaNome={(empresa as any)?.nome ?? ""}
      clienteNome={(cliente as any).nome}
      de={searchParams.de ?? ""}
      ate={searchParams.ate ?? ""}
      rows={linhas}
    />
  );
}
