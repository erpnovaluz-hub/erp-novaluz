import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehDonoDoAgente, listaEmails } from "@/lib/agente/donos";
import { empresaEmUso, pessoasDaEmpresa } from "@/lib/agente/acessos";
import AcessosLancamento from "@/components/agente/AcessosLancamento";

export const dynamic = "force-dynamic";

// Quem pode lançar no financeiro pelo chat do Assistente (0075). Só o dono.
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = await sb.from("perfis").select("*").eq("id", user?.id ?? "").maybeSingle();
  if (!(await ehDonoDoAgente(sb, user?.email, perfil?.papel))) {
    return <div className="p-6 text-sm text-gray-500">Área restrita ao administrador do assistente.</div>;
  }
  const empresaId = empresaEmUso(perfil);
  if (!empresaId) return <div className="p-6 text-sm text-gray-500">Usuário sem empresa.</div>;

  const admin = createAdminClient();
  const [pessoas, emp, prem] = await Promise.all([
    pessoasDaEmpresa(admin, empresaId),
    sb.from("empresas_consultoras").select("nome").eq("id", empresaId).maybeSingle(),
    sb.from("premissas_agente").select("chave,valor").in("chave", ["agente_lancadores", "agente_donos"]),
  ]);
  const val = (k: string) => (prem.data ?? []).find((x) => x.chave === k)?.valor;
  const donos = listaEmails(val("agente_donos"));

  return (
    <div className="mx-auto max-w-2xl px-3 py-4">
      <h1 className="mb-1 text-lg font-semibold">🔑 Quem lança pelo chat</h1>
      <p className="mb-4 text-xs text-gray-500">
        Empresa: <b>{emp.data?.nome ?? "—"}</b>. Quem estiver marcado pode, no Assistente, anexar comprovante/boleto/NF ou pedir por texto
        e confirmar os próprios cartões de lançamento (criar título, dar baixa, lançar pago). Precisa também ter o módulo Financeiro
        com edição no perfil. Para outra empresa, troque a empresa em uso e marque lá.
      </p>
      <AcessosLancamento
        pessoas={pessoas.map((p) => ({ ...p, dono: !!p.email && donos.includes(p.email.toLowerCase()) }))}
        marcados={listaEmails(val("agente_lancadores"))}
        euId={user?.id ?? ""}
      />
    </div>
  );
}
