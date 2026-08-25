"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) {
      setErro(error.message);
      return;
    }
    router.refresh();
    router.replace("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-white px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-novaluz.png" alt="Novaluz" className="mx-auto h-auto w-52" />
          <p className="mt-2 text-sm text-gray-500">Acesse o sistema</p>
        </div>
        <form onSubmit={entrar} className="space-y-4">
          <div>
            <label className="lbl">E-mail</label>
            <input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="lbl">Senha</label>
            <input className="inp" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <button className="btn-primary w-full" disabled={carregando}>
            {carregando ? "Entrando…" : "Entrar"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-gray-400">
          Crie o usuário no Supabase Auth e o perfil ligado ao tenant.
        </p>
      </div>
    </div>
  );
}
