# -*- coding: utf-8 -*-
"""
Gera SQL de importação (fase 2: financeiro) a partir do xlsx da MSFORT.
Pagamentos -> titulos_financeiros (receber); Despesas -> (pagar).
Preserva histórico: usa app.pular_baixa='on' para NÃO gerar caixa nos 'pago'.
Requer: migration 0011 aplicada, e Fase 1 já importada (clientes/fornecedores).
Uso: python scripts/gerar_import_fase2.py  ->  supabase/import_msfort_fase2.sql
"""
import openpyxl, uuid, io, datetime

XLSX = "MSFORT_GESTÃO (1).xlsx"
OUT  = "supabase/import_msfort_fase2.sql"
NS   = uuid.UUID("11111111-2222-3333-4444-555555555555")

def uid(entidade, legado): return str(uuid.uuid5(NS, f"{entidade}:{legado}"))

def s(v):
    if v is None: return "null"
    t = str(v).strip()
    if t == "" or t.lower() == "none": return "null"
    return "'" + t.replace("'", "''") + "'"

def num(v):
    if v is None or str(v).strip() == "": return "null"
    try: return str(round(float(v), 2))
    except: return "null"

def d(v):
    """data -> 'YYYY-MM-DD' ou null"""
    if v is None: return "null"
    if isinstance(v, (datetime.datetime, datetime.date)):
        return "'" + v.strftime("%Y-%m-%d") + "'"
    t = str(v).strip()
    if not t: return "null"
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y"):
        try: return "'" + datetime.datetime.strptime(t, fmt).strftime("%Y-%m-%d") + "'"
        except: pass
    return "null"

wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
def rows(sheet):
    ws = wb[sheet]; data = list(ws.iter_rows(values_only=True)); hdr = None; start = 0
    for i, r in enumerate(data):
        if any(c is not None and str(c).strip() for c in r):
            hdr = [str(c).strip() if c is not None else "" for c in r]; start = i + 1; break
    for r in data[start:]:
        if any(c is not None and str(c).strip() for c in r): yield dict(zip(hdr, r))

# conjuntos de referência da Fase 1
clientes_validos = {str(r.get("ID_Cliente")).strip() for r in rows("Clientes") if r.get("ID_Cliente")}
forn_por_nome = {}
for r in rows("Fornecedores"):
    nm = str(r.get("Nome") or "").strip().upper()
    if nm and r.get("ID_Fornecedor"): forn_por_nome[nm] = uid("fornecedor", str(r.get("ID_Fornecedor")).strip())

out = io.StringIO(); w = out.write
w("-- ============================================================================\n")
w("-- IMPORT MSFORT — FASE 2: financeiro (Pagamentos->receber, Despesas->pagar)\n")
w("-- Requer migration 0011 e Fase 1. Idempotente. Rode no SQL Editor.\n")
w("-- ============================================================================\n\n")
w("do $$\ndeclare v_tenant uuid;\nbegin\n")
w("  select id into v_tenant from empresas_consultoras limit 1;\n")
w("  if v_tenant is null then raise exception 'Nenhuma empresa_consultora'; end if;\n")
w("  perform set_config('app.pular_baixa', 'on', true);  -- histórico sem mexer no caixa\n\n")

def titulo(tid, tipo, desc, cli, forn, valor, venc, comp, status, pgto):
    return (f"  insert into titulos_financeiros (id, empresa_consultora_id, tipo, descricao, "
            f"cliente_id, fornecedor_id, valor, vencimento, competencia, status, data_pagamento, origem) values "
            f"('{tid}', v_tenant, '{tipo}', {desc}, {cli}, {forn}, {valor}, {venc}, {comp}, '{status}', {pgto}, 'manual') "
            f"on conflict (id) do nothing;\n")

# ---- Pagamentos (receber) ----
nr = 0
for r in rows("Pagamentos"):
    idp = r.get("ID_Pagamento")
    valor = num(r.get("Valor"))
    if valor == "null": continue
    tid = uid("pagamento", str(idp).strip()) if idp else uid("pagamento", f"{r.get('Data')}|{valor}|{r.get('Servico_Produto')}")
    idc = str(r.get("ID_Cliente")).strip() if r.get("ID_Cliente") else None
    cli = f"'{uid('cliente', idc)}'" if idc in clientes_validos else "null"
    desc = r.get("Servico_Produto") or r.get("Observacoes") or "Recebimento"
    nf = r.get("NF")
    if nf and str(nf).strip(): desc = f"{desc} (NF {str(nf).strip().rstrip('.0')})"
    pago = str(r.get("Status_Pagamento","")).strip().upper() == "PAGO"
    w(titulo(tid, "receber", s(desc), cli, "null", valor,
             d(r.get("Data_Vencimento")), d(r.get("Data")),
             "pago" if pago else "aberto", d(r.get("Data")) if pago else "null"))
    nr += 1
w("\n")

# ---- Despesas (pagar) ----
npg = 0
for r in rows("Despesas"):
    idd = r.get("ID_Despesa")
    valor = num(r.get("Valor"))
    if valor == "null": continue
    tid = uid("despesa", str(idd).strip()) if idd else uid("despesa", f"{r.get('Data_Despesa')}|{valor}|{r.get('Descrição')}")
    forn_nome = str(r.get("Forncedor") or "").strip()
    forn = f"'{forn_por_nome[forn_nome.upper()]}'" if forn_nome.upper() in forn_por_nome else "null"
    desc = r.get("Descrição") or "Despesa"
    if forn_nome and forn == "null": desc = f"{desc} — {forn_nome}"
    nf = r.get("NumeroNF")
    if nf and str(nf).strip(): desc = f"{desc} (NF {str(nf).strip().rstrip('.0')})"
    status_raw = str(r.get("Status","")).strip().upper()
    pago = status_raw == "PAGO"
    w(titulo(tid, "pagar", s(desc), "null", forn, valor,
             d(r.get("Data_Vencimento")), d(r.get("Data_Despesa")),
             "pago" if pago else "aberto", d(r.get("Data_Despesa")) if pago else "null"))
    npg += 1

w("\nend $$;\n")
w(f"\n-- Resumo: {nr} títulos a receber (Pagamentos), {npg} títulos a pagar (Despesas)\n")

with open(OUT, "w", encoding="utf-8") as f: f.write(out.getvalue())
print(f"OK -> {OUT}")
print(f"receber={nr} pagar={npg}")
