"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useEnvelopeTree, useProfile, useSoldeReel, useTransactions } from "@/hooks/useVisioData";
import { EnvelopeTreeView } from "@/components/EnvelopeTreeView";
import { formatMoney, fromMinorUnits } from "@/lib/domain/currency";
import { flattenSummary } from "@/lib/domain/envelopes";
import { formatCycleRange } from "@/lib/domain/recurrence";
import { computeCycleBuckets } from "@/lib/domain/trends";

export default function DashboardPage() {
  const profile = useProfile();
  const tree = useEnvelopeTree();
  const transactions = useTransactions(5000);
  const soldeReel = useSoldeReel();

  const currency = profile?.defaultCurrency ?? "XOF";

  const topLevelSpending = useMemo(() => {
    if (!tree) return [];
    return tree.children
      .filter((c) => c.subtreeSpent > 0)
      .map((c) => ({ name: c.envelope.name, value: c.subtreeSpent, color: c.envelope.color }));
  }, [tree]);

  const alerts = useMemo(() => {
    if (!tree) return [];
    return flattenSummary(tree).filter((s) => s.isOverBudget || s.isNearThreshold);
  }, [tree]);

  const cycleBuckets = useMemo(() => {
    if (!profile || !transactions) return [];
    return computeCycleBuckets(transactions, tree?.envelope, profile.cycleAnchorDay, 6);
  }, [transactions, tree, profile]);

  if (profile === undefined || tree === undefined) {
    return <p className="text-sm text-neutral-500">Chargement…</p>;
  }

  if (!tree) {
    return <p className="text-sm text-neutral-500">Aucun budget trouvé. Essayez de vous reconnecter.</p>;
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Tableau de bord</h1>
        <p className="text-sm text-neutral-500">
          {tree.cycleStart && tree.cycleEnd ? (
            <>Cycle en cours : <span className="font-medium text-neutral-700">{formatCycleRange(tree.cycleStart, tree.cycleEnd)}</span> — {tree.envelope.name}.</>
          ) : (
            <>Vue d&apos;ensemble de {tree.envelope.name}.</>
          )}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Alloué ce cycle" value={formatMoney(tree.envelope.allocatedAmount, currency)} />
        <StatCard
          label="Dépensé ce cycle"
          value={formatMoney(tree.subtreeSpent, currency)}
          tone={tree.isOverBudget ? "danger" : "default"}
        />
        <StatCard
          label="Disponible (alloué + report)"
          value={formatMoney(tree.remaining, currency)}
          tone={tree.remaining < 0 ? "danger" : "success"}
        />
      </section>

      {tree.carryIn !== 0 && (
        <p className="text-xs text-neutral-500">
          Dont{" "}
          <span className={tree.carryIn < 0 ? "font-medium text-red-600" : "font-medium text-brand-700"}>
            {formatMoney(tree.carryIn, currency)}
          </span>{" "}
          reporté du cycle précédent.
        </p>
      )}

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Solde réel</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Rentrées − (dépenses confirmées − remboursements), hors budget inclus.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-neutral-400">Sur le cycle en cours</p>
            <p
              className={`text-lg font-semibold ${
                soldeReel && soldeReel.period < 0 ? "text-red-600" : "text-brand-700"
              }`}
            >
              {soldeReel ? formatMoney(soldeReel.period, currency) : "…"}
            </p>
          </div>
          <div>
            <p className="text-xs text-neutral-400">Cumulé (depuis le début)</p>
            <p
              className={`text-lg font-semibold ${
                soldeReel && soldeReel.cumulative < 0 ? "text-red-600" : "text-brand-700"
              }`}
            >
              {soldeReel ? formatMoney(soldeReel.cumulative, currency) : "…"}
            </p>
          </div>
        </div>
      </section>

      {alerts.length > 0 && (
        <section className="card border-amber-200 bg-amber-50">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">Enveloppes à surveiller</h2>
          <ul className="space-y-1 text-sm text-amber-800">
            {alerts.map((a) => (
              <li key={a.envelope.id}>
                {a.envelope.name} — {a.percentConsumed.toFixed(0)} % consommé
                {a.isOverBudget ? " (dépassement)" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700">État actuel des enveloppes</h2>
          <EnvelopeTreeView summary={tree} currency={currency} />
        </div>

        <div className="space-y-6">
          <div className="card">
            <h2 className="mb-4 text-sm font-semibold text-neutral-700">Répartition des dépenses (cycle en cours)</h2>
            {topLevelSpending.length === 0 ? (
              <p className="text-sm text-neutral-400">Pas encore de dépenses sur ce cycle.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={topLevelSpending} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}>
                    {topLevelSpending.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatMoney(v, currency)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <h2 className="mb-4 text-sm font-semibold text-neutral-700">Tendances (6 derniers cycles)</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={cycleBuckets}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => fromMinorUnits(v).toLocaleString("fr-FR")} />
                <Tooltip formatter={(v: number) => formatMoney(v, currency)} />
                <Legend />
                <Bar dataKey="income" name="Remboursements" fill="#22a468" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Dépenses" fill="#dc2626" radius={[4, 4, 0, 0]} />
                <Bar dataKey="allocated" name="Alloué (actuel)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
}) {
  const toneClass =
    tone === "danger" ? "text-red-600" : tone === "success" ? "text-brand-700" : "text-neutral-900";
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
