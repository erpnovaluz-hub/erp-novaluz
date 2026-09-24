import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import SupportBanner from "@/components/SupportBanner";
import AcessoProvider from "@/components/AcessoProvider";
import BottomNav from "@/components/BottomNav";
import { carregarAcesso } from "@/lib/acessoServidor";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { perfil, ...acesso } = await carregarAcesso();

  const isSuper = (perfil as any)?.papel === "super";
  let empresaNome = perfil ? "Sem empresa vinculada" : "⚠ Perfil não configurado";
  let modoSuporte = false;
  let empresaId: string | null = (perfil as any)?.empresa_consultora_id ?? null;

  if (perfil) {
    // empresa em uso: a ativa (modo suporte) tem prioridade, senão a do perfil
    if (isSuper) {
      const { data: pa } = await supabase.from("perfis").select("empresa_ativa").eq("id", user.id).maybeSingle();
      if ((pa as any)?.empresa_ativa) { empresaId = (pa as any).empresa_ativa; modoSuporte = true; }
    }
    if (empresaId) {
      const { data: emp } = await supabase.from("empresas_consultoras").select("nome").eq("id", empresaId).maybeSingle();
      if (emp) empresaNome = emp.nome;
    }
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar empresaNome={empresaNome} email={user.email ?? ""} isSuper={isSuper} acesso={acesso} />
      <div className="flex min-w-0 flex-1 flex-col">
        {modoSuporte && <SupportBanner empresaNome={empresaNome} />}
        {!perfil && (
          <div className="m-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
              Seu usuário ainda não tem <b>perfil</b> vinculado a uma empresa. Rode no Supabase:
              <pre className="mt-2 overflow-x-auto rounded bg-amber-100 p-2 text-xs">
{`insert into empresas_consultoras (nome) values ('MSFORT') returning id;
insert into perfis (id, empresa_consultora_id, nome, papel)
values ('${user.id}', '<ID_DA_EMPRESA>', 'Fernando', 'admin');`}
              </pre>
            </div>
          </div>
        )}
        {perfil && (perfil as any).ativo === false && (
          <div className="m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            Seu usuário está <b>desativado</b>. Fale com a gerência.
          </div>
        )}
        <main className="min-w-0 flex-1 p-3 pb-24 sm:p-4 sm:pb-24 md:p-6"><AcessoProvider acesso={{ ...acesso, userId: user.id, empresaId }}>{children}</AcessoProvider></main>
      </div>
      <BottomNav />
    </div>
  );
}
