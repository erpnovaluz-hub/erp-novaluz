# -*- coding: utf-8 -*-
"""
Cria subcategorias a partir da planilha (Categoria_Despesa / TipoReceita) e
preenche titulos_financeiros.subcategoria_id nos títulos já importados.
Categoria = grupo DRE amplo (já classificado); subcategoria = detalhe da origem.
Requer: 0013 aplicada + seed_categorias_dre + import fase2. Idempotente.
Uso: python scripts/gerar_subcategorias.py -> supabase/import_msfort_subcategorias.sql
"""
import openpyxl, uuid, io, unicodedata
from collections import defaultdict

XLSX = "MSFORT_GESTÃO (1).xlsx"
OUT  = "supabase/import_msfort_subcategorias.sql"
NS   = uuid.UUID("11111111-2222-3333-4444-555555555555")

def uid(entidade, legado): return str(uuid.uuid5(NS, f"{entidade}:{legado}"))
def num(v):
    if v is None or str(v).strip() == "": return "null"
    try: return str(round(float(v), 2))
    except: return "null"
def norm(v):
    return unicodedata.normalize("NFKD", str(v or "")).encode("ascii", "ignore").decode().strip().upper()
def q(v): return "'" + str(v).replace("'", "''") + "'"

# mesmo de-para da classificação DRE (categoria amplo)
MAP_DESP = {
    "VARIAVEL": "Custo de material / insumos", "FORNECEDORES": "Custo de material / insumos",
    "COMPRA DE MATERIAL": "Custo de material / insumos", "MATERIAL DA OBRA": "Custo de material / insumos",
    "COMPRA DE E.P.I": "Custo de material / insumos", "MAO DE OBRA": "Custo de mão de obra direta",
    "FOLHA DE PAGAMENTO": "Despesas com pessoal (folha/encargos)", "PRO-LABORE": "Despesas com pessoal (folha/encargos)",
    "PROLABORE": "Despesas com pessoal (folha/encargos)", "ADIANTAMENTO": "Despesas com pessoal (folha/encargos)",
    "RECISAO DE CONTRATO": "Despesas com pessoal (folha/encargos)", "RECISAO AVULSO": "Despesas com pessoal (folha/encargos)",
    "DESPESAS MEDICAS": "Despesas com pessoal (folha/encargos)", "COMISSOES": "Despesas comerciais / marketing",
    "ADMINISTRATIVAS": "Despesas administrativas", "DESPESA MARLEY": "Despesas administrativas",
    "ALIMENTACAO": "Despesas administrativas", "TELEFONIA": "Despesas administrativas", "FIXA": "Despesas administrativas",
    "TAXAS": "Impostos e taxas", "CARTAO DE CREDITO": "Juros e tarifas bancárias",
    "TRANSPORTE": "Manutenção e frota", "FRETES": "Manutenção e frota", "LOCACAO DE AUTOMOVEL": "Manutenção e frota",
    "ATIVO CIRCULANTE": "Investimentos / imobilizado", "EMPRESTIMO": "Outras despesas",
    "FINANCIAMENTO": "Outras despesas", "OUTROS": "Outras despesas",
}
DESP_DEFAULT = "Outras despesas"

wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
def rows(sheet):
    ws = wb[sheet]; data = list(ws.iter_rows(values_only=True)); hdr = None; start = 0
    for i, r in enumerate(data):
        if any(c is not None and str(c).strip() for c in r):
            hdr = [str(c).strip() if c is not None else "" for c in r]; start = i + 1; break
    for r in data[start:]:
        if any(c is not None and str(c).strip() for c in r): yield dict(zip(hdr, r))

# (categoria, subcategoria) -> uuid da subcategoria ; e título -> subcat uuid
subcats = {}                       # (cat_nome, sub_nome) -> sub_uuid
por_sub = defaultdict(list)        # sub_uuid -> [titulo_ids]
su_cat = {}                        # sub_uuid -> cat_nome

def registra(cat_nome, sub_nome_raw, tid):
    sub_nome = str(sub_nome_raw).strip().title() if sub_nome_raw and str(sub_nome_raw).strip() else "Geral"
    su = uid("subcat", f"{cat_nome}|{sub_nome.upper()}")
    subcats[(cat_nome, sub_nome)] = su
    su_cat[su] = cat_nome
    por_sub[su].append(tid)

# Despesas
for r in rows("Despesas"):
    valor = num(r.get("Valor"))
    if valor == "null": continue
    idd = r.get("ID_Despesa")
    tid = uid("despesa", str(idd).strip()) if idd else uid("despesa", f"{r.get('Data_Despesa')}|{valor}|{r.get('Descrição')}")
    cat = MAP_DESP.get(norm(r.get("Categoria_Despesa")), DESP_DEFAULT)
    registra(cat, r.get("Categoria_Despesa"), tid)

# Pagamentos
for r in rows("Pagamentos"):
    valor = num(r.get("Valor"))
    if valor == "null": continue
    idp = r.get("ID_Pagamento")
    tid = uid("pagamento", str(idp).strip()) if idp else uid("pagamento", f"{r.get('Data')}|{valor}|{r.get('Servico_Produto')}")
    if norm(r.get("TipoReceita")) == "EMPRESTIMO":
        registra("Outras receitas", "Empréstimo", tid)
    else:
        registra("Receita de serviços", r.get("TipoReceita") or "Serviços", tid)

out = io.StringIO(); w = out.write
w("-- ============================================================================\n")
w("-- IMPORT MSFORT — subcategorias + preenchimento nos títulos. Idempotente.\n")
w("-- Requer: 0013, seed_categorias_dre, import fase2, classificação DRE.\n")
w("-- ============================================================================\n\n")
w("do $$\ndeclare v_tenant uuid;\nbegin\n")
w("  select id into v_tenant from empresas_consultoras limit 1;\n")
w("  perform seed_categorias_dre(v_tenant);   -- garante as categorias (idempotente)\n\n")

w("  -- 1) cria as subcategorias (ligadas à categoria pelo nome)\n")
for (cat_nome, sub_nome), su in sorted(subcats.items()):
    w(f"  insert into subcategorias_financeiras (id, empresa_consultora_id, categoria_id, nome) "
      f"select '{su}', v_tenant, c.id, {q(sub_nome)} from categorias_financeiras c "
      f"where c.empresa_consultora_id = v_tenant and c.nome = {q(cat_nome)} on conflict (id) do nothing;\n")
w("\n  -- 2) preenche categoria_id + subcategoria_id nos títulos\n")
for su, ids in por_sub.items():
    cat_nome = su_cat[su]
    for i in range(0, len(ids), 300):
        lista = ",".join(f"'{x}'" for x in ids[i:i+300])
        w(f"  update titulos_financeiros set subcategoria_id = '{su}', "
          f"categoria_id = (select id from categorias_financeiras where empresa_consultora_id = v_tenant and nome = {q(cat_nome)}) "
          f"where empresa_consultora_id = v_tenant and id in ({lista});\n")

w("\nend $$;\n")
w(f"\n-- {len(subcats)} subcategorias criadas\n")
with open(OUT, "w", encoding="utf-8") as f: f.write(out.getvalue())
print(f"OK -> {OUT}  ({len(subcats)} subcategorias)")
for (cat, sub) in sorted(subcats):
    print(f"  {cat}  ›  {sub}  ({len(por_sub[subcats[(cat,sub)]])})")
