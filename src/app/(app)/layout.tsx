"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Wallet,
  Receipt,
  History,
  Settings,
  Download,
  WifiOff,
  LogOut,
  PiggyBank,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProfile, usePendingRecurrences } from "@/hooks/useVisioData";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { scheduleSync } from "@/lib/sync/engine";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/envelopes", label: "Enveloppes", icon: Wallet },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/incomes", label: "Rentrées", icon: PiggyBank },
  { href: "/activity", label: "Activité", icon: History },
  { href: "/export", label: "Export", icon: Download },
  { href: "/settings", label: "Réglages", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnlineStatus();
  const profile = useProfile();
  const pending = usePendingRecurrences();

  useEffect(() => {
    if (loading || !user || profile !== undefined) return;

    // Le profil est absent localement : soit ce compte n'a jamais terminé
    // l'onboarding, soit c'est un appareil/navigateur qui n'a pas encore rapatrié ses
    // données. On demande directement au serveur "cet utilisateur a-t-il déjà terminé
    // l'onboarding ?" (voir /api/profile/status) plutôt que de déduire la réponse d'une
    // synchronisation en tâche de fond, qui peut échouer silencieusement (réseau,
    // session en cours de rafraîchissement...) et renvoyer à tort un compte déjà
    // configuré vers l'assistant d'accueil — avec le risque de recréer un second
    // budget général et de violer la contrainte d'unicité en base.
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await getSupabaseBrowserClient().auth.getSession();
        const token = session?.access_token;
        if (!token) return; // pas de session exploitable : rien à faire ici

        const res = await fetch("/api/profile/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return; // échec réseau : on ne redirige surtout pas vers l'onboarding par défaut

        const data: { onboardingCompleted: boolean } = await res.json();
        if (cancelled) return;

        if (!data.onboardingCompleted) {
          router.replace("/onboarding");
        } else {
          // Le compte est déjà prêt côté serveur mais absent localement : on
          // synchronise pour rapatrier ses données (nouvel appareil, navigation
          // privée, stockage local effacé...).
          await scheduleSync();
        }
      } catch {
        // Silencieux et volontaire : une simple erreur réseau ne doit jamais
        // provoquer une redirection vers l'onboarding.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, profile, router]);

  return (
    <div className="min-h-screen bg-neutral-50 pb-20 md:flex md:pb-0">
      <aside className="hidden w-64 shrink-0 border-r border-neutral-200 bg-white md:flex md:flex-col">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-4">
          <div className="h-8 w-8 rounded-lg bg-brand-600" aria-hidden />
          <span className="text-lg font-semibold">Visio</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>
        {pending && pending.length > 0 && (
          <Link
            href="/transactions?tab=pending"
            className="mx-3 mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"
          >
            {pending.length} échéance{pending.length > 1 ? "s" : ""} en attente de confirmation
          </Link>
        )}
        <button onClick={() => signOut().then(() => router.push("/login"))} className="m-3 btn-secondary">
          <LogOut className="h-4 w-4" /> Se déconnecter
        </button>
      </aside>

      {!online && (
        <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-amber-500 py-1.5 text-xs font-medium text-white md:left-64">
          <WifiOff className="h-3.5 w-3.5" /> Hors-ligne — vos actions seront synchronisées au retour du réseau
        </div>
      )}

      <main className={`flex-1 ${!online ? "pt-8" : ""}`}>
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-neutral-200 bg-white md:hidden">
        {NAV_ITEMS.map((item) => (
          <MobileNavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
        ))}
      </nav>
    </div>
  );
}

function NavLink({
  item,
  active,
}: {
  item: { href: string; label: string; icon: typeof LayoutDashboard };
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
        active ? "bg-brand-50 text-brand-700" : "text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

function MobileNavLink({
  item,
  active,
}: {
  item: { href: string; label: string; icon: typeof LayoutDashboard };
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
        active ? "text-brand-700" : "text-neutral-500"
      }`}
    >
      <Icon className="h-5 w-5" />
      {item.label}
    </Link>
  );
}
