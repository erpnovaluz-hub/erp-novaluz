# -*- coding: utf-8 -*-
"""
Classifica os títulos financeiros importados nos grupos de DRE, usando
Categoria_Despesa (Despesas) e TipoReceita (Pagamentos) da planilha.
Casa pelos MESMOS uuids da Fase 2. Requer: seed_categorias_dre já rodado.
Uso: python scripts/gerar_dre_classificacao.py -> supabase/import_msfort_dre.sql
"""
import openpyxl, uuid, io, unicodedata
from collections import defaultdict

XLSX = "MSFORT_GESTÃO (1).xlsx"
OUT  = "supabase/import_msfort_dre.sql"
NS   = uuid.UUID("11111111-2222-3333-4444-555555555555")

def uid(entidade, legado): return str(uuid.uuid5(NS, f"{entidade}:{legado}"))
def num(v):
    if v is None or str(v).strip() == "": return "null"
    try: return str(round(float(v), 2))
    except: return "null"
def norm(v):
    t = unicodedata.normalize("NFKD", str(v or "")).encode("ascii", "ignore").decode().strip().upper()
    return t

# de-para: Categoria_Despesa (normalizada) -> nome exato da categoria DRE
MAP_DESP = {
    "VARIAVEL": "Custo de material / insumos",
    "FORNECEDORES": "Custo de material / insumos",
    "COMPRA DE MATERIAL": "Custo de material / insumos",
    "MATERIAL DA OBRA": "Custo de material / insumos",
    "COMPRA DE E.P.I": "Custo de material / insumos",
    "MAO DE OBRA": "Custo de mão de obra direta",
    "FOLHA DE PAGAMENTO": "Despesas com pessoal (folha/encargos)",
    "PRO-LABORE": "Despesas com pessoal (folha/encargos)",
    "PROLABORE": "Despesas com pessoal (folha/encargos)",
    "ADIANTAMENTO": "Despesas com pessoal (folha/encargos)",
    "RECISAO DE CONTRATO": "Despesas com pessoal (folha/encargos)",
    "RECISAO AVULSO": "Despesas com pessoal (folha/encargos)",
    "DESPESAS MEDICAS": "Despesas com pessoal (folha/encargos)",
    "COMISSOES": "Despesas comerciais / marketing",
    "ADMINISTRATIVAS": "Despesas administrativas",
    "DESPESA MARLEY": "Despesas administrativas",
    "ALIMENTACAO": "Despesas administrativas",
    "TELEFONIA": "Despesas administrativas",
    "FIXA": "Despesas administrativas",
    "TAXAS": "Impostos e taxas",
    "CARTAO DE CREDITO": "Juros e tarifas bancárias",
    "TRANSPORTE": "Manutenção e frota",
    "FRETES": "Manutenção e frota",
    "LOCACAO DE AUTOMOVEL": "Manutenção e frota",
    "ATIVO CIRCULANTE": "Investimentos / imobilizado",
    "EMPRESTIMO": "Outras despesas",
    "FINANCIAMENTO": "Outras despesas",
    "OUTROS": "Outras despesas",
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

# id -> categoria (agrupa por categoria pra emitir UPDATEs em lote)
por_categoria = defaultdict(list)

# Pagamentos (receber)
for r in rows("Pagamentos"):
    valor = num(r.get("Valor"))
    if valor == "null": continue
    idp = r.get("ID_Pagamento")
    tid = uid("pagamento", str(idp).strip()) if idp else uid("pagamento", f"{r.get('Data')}|{valor}|{r.get('Servico_Produto')}")
    cat = "Outras receitas" if norm(r.get("TipoReceita")) == "EMPRESTIMO" else "Receita de serviços"
    por_categoria[cat].append(tid)

# Despesas (pagar)
for r in rows("Despesas"):
    valor = num(r.get("Valor"))
    if valor == "null": continue
    idd = r.get("ID_Despesa")
    tid = uid("despesa", str(idd).strip()) if idd else uid("despesa", f"{r.get('Data_Despesa')}|{valor}|{r.get('Descrição')}")
    cat = MAP_DESP.get(norm(r.get("Categoria_Despesa")), DESP_DEFAULT)
    por_categoria[cat].append(tid)

out = io.StringIO(); w = out.write
w("-- ============================================================================\n")
w("-- IMPORT MSFORT — CLASSIFICAÇÃO DRE dos títulos importados\n")
w("-- Requer: seed_categorias_dre('<tenant>') já executado. Idempotente.\n")
w("-- ============================================================================\n\n")
w("do $$\ndeclare v_tenant uuid; v_cat uuid;\nbegin\n")
w("  select id into v_tenant from empresas_consultoras limit 1;\n\n")

total = 0
for cat, ids in sorted(por_categoria.items(), key=lambda kv: -len(kv[1])):
    w(f"  -- {cat}: {len(ids)} título(s)\n")
    w(f"  select id into v_cat from categorias_financeiras where empresa_consultora_id = v_tenant and nome = {chr(39)}{cat}{chr(39)};\n")
    w(f"  if v_cat is null then raise notice 'Categoria nao encontrada: {cat} (rodou seed_categorias_dre?)'; end if;\n")
    # quebra em lotes de 300 ids por UPDATE
    for i in range(0, len(ids), 300):
        lote = ids[i:i+300]
        lista = ",".join(f"'{x}'" for x in lote)
        w(f"  update titulos_financeiros set categoria_id = v_cat where empresa_consultora_id = v_tenant and id in ({lista});\n")
    w("\n")
    total += len(ids)

w("end $$;\n")
w(f"\n-- Total classificado: {total} títulos em {len(por_categoria)} categorias\n")

with open(OUT, "w", encoding="utf-8") as f: f.write(out.getvalue())
print(f"OK -> {OUT}  ({total} títulos)")
for cat, ids in sorted(por_categoria.items(), key=lambda kv: -len(kv[1])):
    print(f"  {len(ids):>5}  {cat}")
