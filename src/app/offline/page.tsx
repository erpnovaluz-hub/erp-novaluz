// Mostrada pelo service worker quando não há conexão (fica em cache).
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="Novaluz" className="h-16 w-16 rounded-2xl" />
      <h1 className="text-lg font-semibold text-gray-900">Sem conexão</h1>
      <p className="max-w-xs text-sm text-gray-500">
        O Novaluz precisa de internet para mostrar os dados atualizados. Confira o Wi-Fi ou os dados móveis e tente de novo.
      </p>
      <a href="/" className="btn-primary mt-2">Tentar de novo</a>
    </div>
  );
}
