# -*- coding: utf-8 -*-
"""
Import da T4 INDUSTRIAL a partir do ERP_T4 INDUSTRIAL.xlsx.
Direcionado ao tenant 'T4 INDUSTRIAL'. UUIDs com prefixo 't4:' (sem colisão com MSFORT).
Cobre: pessoas->clientes/fornecedores, catálogo->produtos, serviços, peças,
plano de contas->categorias/subcategorias, financeiro->titulos.
Uso: python scripts/gerar_import_t4.py -> supabase/import_t4.sql
"""
import openpyxl, uuid, io, unicodedata, datetime
from collections import defaultdict

XLSX = "ERP_T4 INDUSTRIAL.xlsx"; OUT = "supabase/import_t4.sql"
NS = uuid.UUID("11111111-2222-3333-4444-555555555555")
def uid(e, l): return str(uuid.uuid5(NS, f"t4:{e}:{l}"))
def norm(s): return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().upper().strip()
def q(v):
    if v is None: return "null"
    t = str(v).strip()
    return "null" if t == "" or t.lower() == "none" else "'" + t.replace("'", "''") + "'"
def num(v):
    if v is None: return "null"
    t = str(v).strip().replace("R$", "").replace(" ", "")
    if t == "": return "null"
    if "," in t and "." in t: t = t.replace(".", "").replace(",", ".")
    elif "," in t: t = t.replace(",", ".")
    try: return str(round(float(t), 4))
    except: return "null"
def digits(v):
    if v is None: return "null"
    t = str(v).strip()
    if t.endswith(".0"): t = t[:-2]
    d = "".join(ch for ch in t if ch.isdigit())
    return "'" + d + "'" if d else "null"
def d(v):
    if isinstance(v, (datetime.datetime, datetime.date)): return "'" + v.strftime("%Y-%m-%d") + "'"
    t = str(v or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d/%m/%Y"):
        try: return "'" + datetime.datetime.strptime(t, fmt).strftime("%Y-%m-%d") + "'"
        except: pass
    return "null"

wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
def rows(name):
    ws = wb[name]; data = list(ws.iter_rows(values_only=True)); hdr = None; out = []
    for r in data:
        if any(c is not None and str(c).strip() for c in r):
            if hdr is None: hdr = [str(c).strip() if c is not None else "" for c in r]
            else: out.append(dict(zip(hdr, r)))
    return out

def grupo_dre(cat, tipo):
    c = norm(cat)
    if "RECEITA" in c: return "receita"
    if "DEDUC" in c or "IMPOSTO" in c: return "deducao"
    if "CUSTO" in c: return "custo"
    if "FINANCEIR" in c: return "despesa_financeira"
    if "DESPESA" in c: return "despesa_operacional"
    return "receita" if norm(tipo) == "ENTRADA" else "despesa_operacional"

out = io.StringIO(); w = out.write
w("-- ============================================================================\n")
w("-- IMPORT T4 INDUSTRIAL — direcionado ao tenant 'T4 INDUSTRIAL'. Idempotente.\n")
w("-- ============================================================================\n\n")
w("do $$\ndeclare v_tenant uuid;\nbegin\n")
w("  select id into v_tenant from empresas_consultoras where nome = 'T4 INDUSTRIAL' limit 1;\n")
w("  if v_tenant is null then raise exception 'Empresa T4 INDUSTRIAL nao encontrada'; end if;\n")
w("  perform set_config('app.pular_baixa', 'on', true);  -- histórico: não gera caixa nas baixas\n\n")

# ---- Pessoas -> clientes / fornecedores ----
pessoa_tipo = {}  # id -> 'cliente'/'fornecedor'
ncli = nforn = 0
w("  -- pessoas (clientes e fornecedores)\n")
for r in rows("Pessoas_Clientes_Fornecedores"):
    idp = str(r.get("ID_Pessoa") or "").strip()
    nome = r.get("Nome_Razao")
    if not idp or not nome: continue
    rel = norm(r.get("Tipo_Relacao"))
    if rel == "FORNECEDOR":
        pessoa_tipo[idp] = "fornecedor"
        w(f"  insert into fornecedores (id, empresa_consultora_id, nome, documento, telefone, email) values "
          f"('{uid('fornecedor', idp)}', v_tenant, {q(nome)}, {digits(r.get('CPF_CNPJ'))}, {digits(r.get('Telefone'))}, {q(r.get('Email'))}) on conflict (id) do nothing;\n")
        nforn += 1
    else:
        pessoa_tipo[idp] = "cliente"
        st = "ativo" if norm(r.get("Status")) == "ATIVO" else "inativo"
        w(f"  insert into clientes (id, empresa_consultora_id, nome, cnpj, telefone, email, endereco, status, nivel_relacionamento) values "
          f"('{uid('cliente', idp)}', v_tenant, {q(nome)}, {digits(r.get('CPF_CNPJ'))}, {digits(r.get('Telefone'))}, {q(r.get('Email'))}, {q(r.get('Endereco'))}, '{st}', 'morno') on conflict (id) do nothing;\n")
        ncli += 1

# ---- Catálogo -> produtos ----
np_ = 0
w("\n  -- catálogo (produtos/serviços/insumos)\n")
for r in rows("Catalogo_Produtos_Servicos"):
    idi = str(r.get("ID_Item") or "").strip(); nome = r.get("Nome_Item")
    if not idi or not nome: continue
    ti = norm(r.get("Tipo_Item"))
    tipo = "servico" if "SERVI" in ti else ("insumo" if "INSUMO" in ti or "MATERIA" in ti else "produto")
    uni = (str(r.get("Unidade_Medida") or "un").strip() or "un")[:10]
    w(f"  insert into produtos (id, empresa_consultora_id, codigo, nome, tipo, unidade, custo_medio, preco_lista, estoque_minimo) values "
      f"('{uid('produto', idi)}', v_tenant, {q(r.get('Codigo_Barras') or idi)}, {q(nome)}, '{tipo}', {q(uni)}, "
      f"coalesce({num(r.get('Custo_Calculado'))},0), coalesce({num(r.get('Preco_Venda'))},0), coalesce({num(r.get('Estoque_Minimo'))},0)) on conflict (id) do nothing;\n")
    np_ += 1

# ---- Serviços ----
ns = 0
w("\n  -- serviços\n")
for r in rows("Tabela_Servicos"):
    ids = str(r.get("ID_Servico") or "").strip(); nome = r.get("Nome_Servico")
    if not ids or not nome: continue
    uni = norm(r.get("Unidade")); uni = "UND" if uni.startswith("UN") else ("KG" if uni == "KG" else (str(r.get("Unidade")).strip()[:10] or "UND"))
    w(f"  insert into servicos (id, empresa_consultora_id, nome, unidade, valor) values "
      f"('{uid('servico', ids)}', v_tenant, {q(nome)}, {q(uni)}, coalesce({num(r.get('Valor_Servico'))},0)) on conflict (id) do nothing;\n")
    ns += 1

# ---- Peças ----
npc = 0
w("\n  -- peças\n")
for r in rows("Tabela_Pecas"):
    nome = r.get("Nome_Peca")
    if not nome or not str(nome).strip(): continue
    nome = str(nome).strip()
    w(f"  insert into pecas (id, empresa_consultora_id, nome, peso, valor_kg) values "
      f"('{uid('peca', nome)}', v_tenant, {q(nome)}, coalesce({num(r.get('Peso_Unit'))},0), coalesce({num(r.get('Valor_Kg'))},0)) on conflict (id) do nothing;\n")
    npc += 1

# ---- Plano de contas + financeiro categorias ----
cat_tipo = {}          # cat_nome -> tipo
subs = set()           # (cat_nome, sub_nome)
def coleta(cat, sub, tipo):
    if cat and str(cat).strip():
        cat = str(cat).strip(); cat_tipo.setdefault(cat, tipo)
        if sub and str(sub).strip(): subs.add((cat, str(sub).strip()))
for r in rows("Plano_de_Contas"): coleta(r.get("Categoria"), r.get("Sub_Categoria"), r.get("Tipo"))
fin = rows("Financeiro")
for r in fin: coleta(r.get("Categoria"), r.get("Sub_Categoria"), r.get("Tipo_Lancamento"))

w("\n  -- categorias financeiras\n")
ordem = 10
for cat, tipo in cat_tipo.items():
    g = grupo_dre(cat, tipo); nat = "receita" if g == "receita" else "despesa"
    w(f"  insert into categorias_financeiras (id, empresa_consultora_id, nome, natureza, grupo_dre, ordem) values "
      f"('{uid('categoria', cat)}', v_tenant, {q(cat)}, '{nat}', '{g}', {ordem}) on conflict (id) do nothing;\n")
    ordem += 1
w("\n  -- subcategorias\n")
for cat, sub in subs:
    w(f"  insert into subcategorias_financeiras (id, empresa_consultora_id, categoria_id, nome) values "
      f"('{uid('subcat', cat + '|' + sub)}', v_tenant, '{uid('categoria', cat)}', {q(sub)}) on conflict (id) do nothing;\n")

# ---- Financeiro -> titulos ----
nfin = 0
w("\n  -- financeiro (títulos)\n")
for r in fin:
    idp = str(r.get("ID_Parcela") or "").strip()
    valor = num(r.get("Valor"))
    if not idp or valor == "null": continue
    entrada = norm(r.get("Tipo_Lancamento")) == "ENTRADA"
    tipo = "receber" if entrada else "pagar"
    pessoa = str(r.get("ID_Pessoa") or "").strip()
    cli = "null"; forn = "null"
    if pessoa in pessoa_tipo:
        if pessoa_tipo[pessoa] == "cliente": cli = f"'{uid('cliente', pessoa)}'"
        else: forn = f"'{uid('fornecedor', pessoa)}'"
    cat = str(r.get("Categoria") or "").strip(); sub = str(r.get("Sub_Categoria") or "").strip()
    cat_sql = f"'{uid('categoria', cat)}'" if cat else "null"
    sub_sql = f"'{uid('subcat', cat + '|' + sub)}'" if cat and sub else "null"
    pago = norm(r.get("Status_Pagamento")) == "PAGO"
    desc = str(r.get("Descricao") or "").strip()
    if not desc: desc = (cat + (" / " + sub if sub else "")).strip()
    if not desc: desc = "Recebimento" if entrada else "Pagamento"
    w(f"  insert into titulos_financeiros (id, empresa_consultora_id, tipo, descricao, cliente_id, fornecedor_id, categoria_id, subcategoria_id, valor, vencimento, competencia, status, data_pagamento, origem) values "
      f"('{uid('titulo', idp)}', v_tenant, '{tipo}', {q(desc)}, {cli}, {forn}, {cat_sql}, {sub_sql}, {valor}, "
      f"{d(r.get('Data_Vencimento'))}, {d(r.get('Data_Vencimento'))}, '{'pago' if pago else 'aberto'}', "
      f"{d(r.get('Data_Pagamento')) if pago else 'null'}, 'manual') on conflict (id) do nothing;\n")
    nfin += 1

w("\nend $$;\n")
w(f"\n-- clientes={ncli} fornecedores={nforn} produtos={np_} servicos={ns} pecas={npc} categorias={len(cat_tipo)} subcategorias={len(subs)} titulos={nfin}\n")
with open(OUT, "w", encoding="utf-8") as f: f.write(out.getvalue())
print(f"OK -> {OUT}")
print(f"clientes={ncli} fornecedores={nforn} produtos={np_} servicos={ns} pecas={npc} categorias={len(cat_tipo)} subcategorias={len(subs)} titulos={nfin}")
