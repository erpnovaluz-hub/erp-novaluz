import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { EMISSORA } from "@/lib/empresa";
import { formatDate } from "@/lib/format";
import { STATUS_OS, motivoPausaLabel, statusOSLabel } from "@/lib/os";
import { getEntity } from "@/lib/entities";
import Badge from "@/components/Badge";

export const dynamic = "force-dynamic";

const STATUS_ATIV = getEntity("atividades_os")!.fields.find((f) => f.key === "status")!.options!;
const ETAPAS = [
  { value: "antes", label: "Antes" },
  { value: "durante", label: "Durante" },
  { value: "depois", label: "Depois" },
];

// Acompanhamento da OS pelo QR code da OS impressa. Sem login, só leitura e
// SEM valores (venda/custo nunca saem para o campo nem para o cliente).
export default async function AcompanhamentoOSPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const supabase = createAdminClient();

  // resolve a OS pelo token opaco — não expõe o id na URL
  const { data: os } = await supabase
    .from("ordens_servico")
    .select("id, numero, titulo, local, prazo, data_realizado, status, motivo_pausa, status_desde, cliente_id, empresa_consultora_id")
    .eq("acompanhamento_token", params.token)
    .maybeSingle();
  if (!os) notFound();

  const [{ data: atividades }, { data: historico }, { data: fotos }, { data: cliente }, { data: empresa }] = await Promise.all([
    supabase.from("atividades_os").select("id, descricao, data_fim, status, conclusao_pct")
      .eq("os_id", os.id).order("data_inicio", { ascending: true, nullsFirst: false }),
    supabase.from("os_historico").select("id, de, para, motivo, data").eq("os_id", os.id).order("data", { ascending: false }).limit(50),
    supabase.from("os_fotos").select("id, etapa, caminho, legenda").eq("os_id", os.id).eq("no_relatorio", true).order("criado_em"),
    os.cliente_id ? supabase.from("clientes").select("nome").eq("id", os.cliente_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("empresas_consultoras").select("nome, logo").eq("id", os.empresa_consultora_id).maybeSingle(),
  ]);

  const urls: Record<string, string> = {};
  if (fotos?.length) {
    const { data: assinadas } = await supabase.storage.from("anexos").createSignedUrls(fotos.map((f) => f.caminho), 3600);
    (assinadas ?? []).forEach((s, i) => { if (s.signedUrl) urls[fotos[i].id] = s.signedUrl; });
  }

  // quem tem login ganha o atalho para abrir a OS no sistema
  const { data: { user } } = await (await createClient()).auth.getUser();

  const ativs = atividades ?? [];
  const progresso = ativs.length ? Math.round(ativs.reduce((s, a) => s + Number(a.conclusao_pct || 0), 0) / ativs.length) : 0;
  const empresaNome = (empresa as any)?.nome || EMISSORA.nome;
  const logo = (empresa as any)?.logo || EMISSORA.logo;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 text-gray-800">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" className="h-10 object-contain" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-400">Acompanhamento da OS</p>
            <p className="truncate text-sm text-gray-500">{empresaNome}</p>
          </div>
        </header>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-400">OS {os.numero ?? ""}</p>
              <h1 className="text-lg font-bold leading-snug">{os.titulo}</h1>
              {(cliente as any)?.nome && <p className="text-sm text-gray-500">{(cliente as any).nome}</p>}
              {os.local && <p className="text-sm text-gray-500">Local: {os.local}</p>}
            </div>
            <Badge value={os.status} options={STATUS_OS} />
          </div>
          {os.status === "pausada" && os.motivo_pausa && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Pausada: {motivoPausaLabel(os.motivo_pausa)}</p>
          )}
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm"><span className="text-gray-500">Progresso</span><span className="font-semibold tabular-nums">{progresso}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${progresso}%` }} /></div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <Campo rot="Prazo" val={formatDate(os.prazo)} />
            <Campo rot="Status desde" val={dataHora(os.status_desde).slice(0, 10)} />
            <Campo rot="Realizado em" val={formatDate(os.data_realizado)} />
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">Atividades</h2>
          {ativs.length === 0 ? <p className="text-sm text-gray-400">Sem atividades.</p> : (
            <ul className="divide-y divide-gray-100">
              {ativs.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm">{a.descricao}</p>
                    <Badge value={a.status} options={STATUS_ATIV} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-brand-600" style={{ width: `${Number(a.conclusao_pct || 0)}%` }} /></div>
                    <span className="tabular-nums">{Number(a.conclusao_pct || 0)}%</span>
                    {a.data_fim && <span>· prazo {formatDate(a.data_fim)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {(fotos?.length ?? 0) > 0 && (
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">Fotos</h2>
            {ETAPAS.map((et) => {
              const lista = (fotos ?? []).filter((f) => f.etapa === et.value && urls[f.id]);
              if (!lista.length) return null;
              return (
                <div key={et.value} className="mb-3">
                  <p className="mb-1 text-xs uppercase text-gray-400">{et.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {lista.map((f) => (
                      <a key={f.id} href={urls[f.id]} target="_blank" rel="noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={urls[f.id]} alt={f.legenda ?? ""} className="aspect-square w-full rounded-lg object-cover" />
                        {f.legenda && <p className="mt-0.5 truncate text-xs text-gray-500">{f.legenda}</p>}
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {(historico?.length ?? 0) > 0 && (
          <section className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">Histórico</h2>
            <ul className="space-y-1 text-sm">
              {(historico ?? []).map((h) => (
                <li key={h.id} className="flex justify-between gap-3">
                  <span>{statusOSLabel(h.para)}{h.motivo ? ` (${motivoPausaLabel(h.motivo)})` : ""}</span>
                  <span className="shrink-0 text-xs text-gray-400">{dataHora(h.data)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {user && (
          <Link href={`/os/${os.id}`} className="block rounded-xl bg-brand-600 px-4 py-3 text-center text-sm font-semibold text-white">
            Abrir no sistema para atualizar
          </Link>
        )}

        <p className="pt-2 text-center text-xs text-gray-400">Atualizado em {dataHora(new Date().toISOString())}</p>
      </div>
    </main>
  );
}

// renderiza no servidor (UTC): fixa o horário de Brasília
const dataHora = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "—";

function Campo({ rot, val }: { rot: string; val: string }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{rot}</p><p className="font-medium">{val || "—"}</p></div>;
}
