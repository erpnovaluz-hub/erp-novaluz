import { createClient } from "@/lib/supabase/server";
import AdminPanel from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase.from("perfis").select("papel").eq("id", user?.id ?? "").maybeSingle();

  if (perfil?.papel !== "super") {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900">🔒 Área restrita</h1>
        <p className="mt-2 text-sm text-gray-500">Esta área é exclusiva do administrador central.</p>
      </div>
    );
  }
  return <AdminPanel />;
}
