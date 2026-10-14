// =============================================================================
// O Supabase (PostgREST) devolve no máximo 1.000 linhas por consulta, mesmo com
// .range(0, 9999) — o resto some sem erro. buscarTodos() pagina em lotes até
// acabar. Passe a consulta já com filtros/ordem; "desempate" garante ordem
// estável entre os lotes (sem ela, linhas podem repetir ou faltar).
// =============================================================================

export async function buscarTodos<T = any>(
  consulta: any,
  desempate: string | null = "id",
  lote = 1000,
): Promise<{ data: T[]; error: any }> {
  const q = desempate ? consulta.order(desempate, { ascending: true }) : consulta;
  const todos: T[] = [];
  for (let de = 0; ; de += lote) {
    const { data, error } = await q.range(de, de + lote - 1);
    if (error) return { data: todos, error };
    todos.push(...((data ?? []) as T[]));
    if (!data || data.length < lote) break;
  }
  return { data: todos, error: null };
}
