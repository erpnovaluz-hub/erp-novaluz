"use client";

import Badge from "@/components/Badge";
import { PRIORIDADES, corPrazo, rotuloPrazo, vinculoDef, type Pessoa, type Tarefa } from "@/lib/tarefas";
import { Avatar, Check } from "@/components/tarefas/comum";

// Linha de tarefa usada em Minhas tarefas, Lista do projeto e tarefas vinculadas.
export default function TarefaLinha({ t, pessoa, projetoNome, onAbrir, onToggle }: {
  t: Tarefa; pessoa?: Pessoa | null; projetoNome?: string | null;
  onAbrir: () => void; onToggle: () => void;
}) {
  const vinc = vinculoDef(t.vinculo_tipo);
  return (
    <div onClick={onAbrir}
      className="group flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-0 hover:bg-gray-50">
      <Check feito={t.concluida} onClick={onToggle} />
      <div className="min-w-0 flex-1">
        <p className={`truncate ${t.concluida ? "text-gray-400 line-through" : "text-gray-800"}`}>{t.titulo}</p>
        {(projetoNome || vinc || (t.n_sub ?? 0) > 0) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
            {projetoNome && <span>📁 {projetoNome}</span>}
            {vinc && <span className="truncate">{vinc.icon} {t.vinculo_rotulo || vinc.label}</span>}
            {(t.n_sub ?? 0) > 0 && <span>☑ {t.n_sub_ok}/{t.n_sub}</span>}
          </p>
        )}
      </div>
      {t.prioridade !== "media" && <span className="hidden sm:inline"><Badge value={t.prioridade} options={PRIORIDADES} /></span>}
      <span className={`w-20 shrink-0 text-right text-xs ${corPrazo(t.prazo, t.concluida)}`}>{rotuloPrazo(t.prazo)}</span>
      <Avatar pessoa={pessoa ?? null} />
    </div>
  );
}
