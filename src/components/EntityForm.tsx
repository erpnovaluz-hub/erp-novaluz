"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EntityDef, FieldDef } from "@/lib/entities";

type RefMap = Record<string, { value: string; label: string }[]>;

export default function EntityForm({
  entity,
  registro,
  refOptions,
  fixedValues,
  onClose,
  onSaved,
}: {
  entity: EntityDef;
  registro: Record<string, any> | null;
  refOptions: RefMap;
  fixedValues?: Record<string, any>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const editando = !!registro?.id;
  const fixedKeys = fixedValues ? Object.keys(fixedValues) : [];
  const campos = entity.fields.filter((f) => !f.hideInForm && !fixedKeys.includes(f.key));
  const [form, setForm] = useState<Record<string, any>>(() => {
    const base: Record<string, any> = {};
    for (const f of campos) base[f.key] = registro?.[f.key] ?? "";
    return base;
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function set(key: string, val: any) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);

    // monta payload limpando vazios (não inventa dado: manda null, não zero)
    const payload: Record<string, any> = { ...(fixedValues ?? {}) };
    for (const f of campos) {
      let v = form[f.key];
      if (v === "" || v === undefined) v = null;
      if ((f.type === "number" || f.type === "currency" || f.type === "percent") && v !== null) {
        v = Number(v);
        if (isNaN(v)) v = null;
      }
      if (f.type === "boolean") v = !!form[f.key];
      payload[f.key] = v;
    }

    let error;
    if (editando) {
      ({ error } = await supabase.from(entity.key).update(payload).eq("id", registro!.id));
    } else {
      ({ error } = await supabase.from(entity.key).insert(payload));
    }

    setSalvando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-gray-900">
            {editando ? "Editar" : "Novo"} {entity.label.toLowerCase()}
          </h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={salvar} className="flex-1 space-y-4 overflow-y-auto p-5">
          {campos.map((f) => (
            <Field key={f.key} field={f} value={form[f.key]} refOptions={refOptions} onChange={(v) => set(f.key, v)} />
          ))}
          {erro && <p className="text-sm text-red-600">{erro}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button className="btn-ghost" onClick={onClose} type="button">Cancelar</button>
          <button className="btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  field,
  value,
  refOptions,
  onChange,
}: {
  field: FieldDef;
  value: any;
  refOptions: RefMap;
  onChange: (v: any) => void;
}) {
  const req = field.required;

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
        {field.label}
      </label>
    );
  }

  return (
    <div>
      <label className="lbl">
        {field.label} {req && <span className="text-red-500">*</span>}
      </label>

      {field.type === "textarea" && (
        <textarea className="inp min-h-[80px]" value={value ?? ""} required={req} onChange={(e) => onChange(e.target.value)} />
      )}

      {field.type === "select" && (
        <select className="inp" value={value ?? ""} required={req} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {field.type === "ref" && (
        <select className="inp" value={value ?? ""} required={req} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(refOptions[field.key] ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {["text", "number", "currency", "percent", "date", "datetime"].includes(field.type) && (
        <input
          className="inp"
          type={
            field.type === "date" ? "date"
            : field.type === "datetime" ? "datetime-local"
            : field.type === "text" ? "text"
            : "number"
          }
          step={field.type === "currency" ? "0.01" : field.type === "number" || field.type === "percent" ? "any" : undefined}
          value={formatInputValue(field.type, value)}
          required={req}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function formatInputValue(type: string, value: any): string {
  if (value === null || value === undefined) return "";
  if (type === "datetime" && typeof value === "string" && value.length > 16) {
    // ISO -> yyyy-MM-ddThh:mm para input datetime-local
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      return tz.toISOString().slice(0, 16);
    }
  }
  if (type === "date" && typeof value === "string" && value.length > 10) return value.slice(0, 10);
  return String(value);
}
