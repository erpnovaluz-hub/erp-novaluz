# -*- coding: utf-8 -*-
"""
Gera SQL de importação (fase 1: cadastros) a partir do xlsx da MSFORT.
UUID determinístico por ID da planilha (uuid5) -> preserva relacionamentos
entre fases e permite reexecução idempotente (ON CONFLICT DO NOTHING).
Uso: python scripts/gerar_import.py
Saída: supabase/import_msfort_fase1.sql  (rodar no SQL Editor do Supabase)
"""
import openpyxl, uuid, sys, io

XLSX = "MSFORT_GESTÃO (1).xlsx"
OUT  = "supabase/import_msfort_fase1.sql"
NS   = uuid.UUID("11111111-2222-3333-4444-555555555555")  # namespace fixo do projeto

def uid(entidade, legado):
    return str(uuid.uuid5(NS, f"{entidade}:{legado}"))

def s(v):
    """string SQL-safe ou NULL"""
    if v is None: return "null"
    t = str(v).strip()
    if t == "" or t.lower() == "none": return "null"
    return "'" + t.replace("'", "''") + "'"

def digits(v):
    """mantém só dígitos (CNPJ/telefone que vieram como float)"""
    if v is None: return "null"
    t = str(v).strip()
    if t.endswith(".0"): t = t[:-2]
    d = "".join(ch for ch in t if ch.isdigit())
    return "'" + d + "'" if d else "null"

def num(v):
    if v is None or str(v).strip() == "": return "null"
    try: return str(float(v))
    except: return "null"

wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)

def rows(sheet):
    ws = wb[sheet]
    data = list(ws.iter_rows(values_only=True))
    hdr = None
    for i, r in enumerate(data):
        if any(c is not None and str(c).strip() for c in r):
            hdr = [str(c).strip() if c is not None else "" for c in r]
            start = i + 1
            break
    for r in data[start:]:
        if not any(c is not None and str(c).strip() for c in r): continue
        yield dict(zip(hdr, r))

out = io.StringIO()
w = out.write
w("-- ============================================================================\n")
w("-- IMPORT MSFORT — FASE 1: cadastros (clientes, contatos, fornecedores,\n")
w("-- produtos, colaboradores). Idempotente. Rode no SQL Editor do Supabase.\n")
w("-- ============================================================================\n\n")
w("do $$\ndeclare v_tenant uuid;\nbegin\n")
w("  select id into v_tenant from empresas_consultoras limit 1;\n")
w("  if v_tenant is null then raise exception 'Nenhuma empresa_consultora cadastrada'; end if;\n\n")

# ---- Clientes + contatos ----
nc = ncont = 0
for r in rows("Clientes"):
    idc = r.get("ID_Cliente")
    nome = r.get("Nome_Cliente")
    if not idc or not nome: continue
    cid = uid("cliente", idc)
    st = "ativo" if str(r.get("Status_Cliente","")).strip().upper() == "ATIVO" else "inativo"
    w(f"  insert into clientes (id, empresa_consultora_id, nome, segmento, status, nivel_relacionamento) "
      f"values ('{cid}', v_tenant, {s(nome)}, {s(r.get('Segmento'))}, '{st}', 'morno') on conflict (id) do nothing;\n")
    nc += 1
    nomec, tel = r.get("NomeContato"), r.get("Contato")
    if (nomec and str(nomec).strip()) or (tel and str(tel).strip()):
        ctid = uid("contato", idc)
        w(f"  insert into contatos (id, empresa_consultora_id, cliente_id, nome, telefone) "
          f"values ('{ctid}', v_tenant, '{cid}', {s(nomec) if nomec else s('Contato')}, {digits(tel)}) on conflict (id) do nothing;\n")
        ncont += 1
w("\n")

# ---- Fornecedores ----
nf = 0
for r in rows("Fornecedores"):
    idf, nome = r.get("ID_Fornecedor"), r.get("Nome")
    if not idf or not nome: continue
    w(f"  insert into fornecedores (id, empresa_consultora_id, nome, documento) "
      f"values ('{uid('fornecedor', idf)}', v_tenant, {s(nome)}, {digits(r.get('CNPJ'))}) on conflict (id) do nothing;\n")
    nf += 1
w("\n")

# ---- Produtos/Serviços ----
np_ = 0
for r in rows("ProdutosServicos"):
    idp, nome = r.get("ID_Prod"), r.get("Nome")
    if not idp or not nome: continue
    unid = (str(r.get("Unid") or "un").strip() or "un")[:10]
    cat = str(r.get("Categoria") or "").upper()
    tipo = "servico" if ("SERVI" in cat or "PESSOAL" in cat or "PRODU" in cat) else ("insumo" if "MATERIAL" in cat else "produto")
    custo = num(r.get("CustoDireto_persist"))
    w(f"  insert into produtos (id, empresa_consultora_id, codigo, nome, tipo, unidade, custo_medio) "
      f"values ('{uid('produto', idp)}', v_tenant, {s(idp)}, {s(nome)}, '{tipo}', {s(unid)}, coalesce({custo},0)) on conflict (id) do nothing;\n")
    np_ += 1
w("\n")

# ---- Funcionarios -> colaboradores ----
nfu = 0
for r in rows("Funcionarios"):
    idfu, nome = r.get("ID_Funcionario"), r.get("Nome")
    if not idfu or not nome: continue
    ativo = "true" if str(r.get("STATUS","")).strip().upper() == "ATIVO" else "false"
    w(f"  insert into colaboradores (id, empresa_consultora_id, nome, funcao_padrao, ativo) "
      f"values ('{uid('colab', idfu)}', v_tenant, {s(nome)}, {s(r.get('Cargo_Funcao'))}, {ativo}) on conflict (id) do nothing;\n")
    nfu += 1

w("\nend $$;\n")
w(f"\n-- Resumo: {nc} clientes, {ncont} contatos, {nf} fornecedores, {np_} produtos, {nfu} colaboradores\n")

with open(OUT, "w", encoding="utf-8") as f:
    f.write(out.getvalue())

print(f"OK -> {OUT}")
print(f"clientes={nc} contatos={ncont} fornecedores={nf} produtos={np_} colaboradores={nfu}")
