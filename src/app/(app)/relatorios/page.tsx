import Link from "next/link";

const RELATORIOS = [
  { href: "/relatorios/gerencial", icon: "📈", titulo: "Gerencial", desc: "Visão executiva: indicadores, DRE resumido, produção e OS.", tag: "gerencial" },
  { href: "/financeiro/dre", icon: "📊", titulo: "DRE", desc: "Demonstrativo de resultado por competência.", tag: "gerencial" },
  { href: "/financeiro/fluxo", icon: "💵", titulo: "Fluxo de caixa", desc: "Saldos, entradas e saídas, a pagar e a receber.", tag: "gerencial" },
  { href: "/impacto/relatorio", icon: "📄", titulo: "Produção detalhada", desc: "Data, peça, serviço, qtd, peso, funcionário e valores — ordenável, com intervalo de datas.", tag: "operacional" },
  { href: "/impacto/resumo", icon: "🏭", titulo: "Produção (resumo)", desc: "Peso e valor por peça, serviço, tipo e produtividade por colaborador.", tag: "operacional" },
  { href: "/financeiro/pagar", icon: "🔴", titulo: "Contas a Pagar", desc: "Títulos a pagar com filtros e totais.", tag: "operacional" },
  { href: "/financeiro/receber", icon: "🟢", titulo: "Contas a Receber", desc: "Títulos a receber com filtros e totais.", tag: "operacional" },
  { href: "/estoque/saldos", icon: "📦", titulo: "Saldos de estoque", desc: "Saldo por depósito, custo médio e valor total.", tag: "operacional" },
  { href: "/os", icon: "📋", titulo: "Ordens de Serviço", desc: "OS com atividades, progresso e insumos.", tag: "operacional" },
];

export default function CentralRelatorios() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">📄 Central de relatórios</h1>
        <p className="text-sm text-gray-500">Cada relatório tem o botão “Imprimir / Salvar PDF”.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {RELATORIOS.map((r) => (
          <Link key={r.href} href={r.href} className="card block p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-2xl">{r.icon}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${r.tag === "gerencial" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{r.tag}</span>
            </div>
            <h2 className="mt-3 font-semibold text-gray-900">{r.titulo}</h2>
            <p className="mt-1 text-sm text-gray-500">{r.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
