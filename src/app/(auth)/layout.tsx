export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded-xl bg-brand-600" aria-hidden />
          <h1 className="text-2xl font-semibold text-neutral-900">Visio</h1>
          <p className="text-sm text-neutral-500">Votre budget, en enveloppes, à votre façon.</p>
        </div>
        <div className="card">{children}</div>
        <p className="mt-4 text-center text-xs text-neutral-400">
          <a href="/legal/cgu" className="hover:underline">
            Conditions d&apos;utilisation
          </a>{" "}
          ·{" "}
          <a href="/legal/confidentialite" className="hover:underline">
            Confidentialité
          </a>
        </p>
      </div>
    </div>
  );
}
