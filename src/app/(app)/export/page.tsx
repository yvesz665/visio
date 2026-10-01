"use client";

import { useMemo, useState } from "react";
import { FileText, FileSpreadsheet, Database } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllEnvelopes, useIncomeEntries, useIncomeSources, useProfile, useTransactions } from "@/hooks/useVisioData";
import { exportTransactionsAsCsv } from "@/lib/export/csv";
import { exportTransactionsAsPdf } from "@/lib/export/pdf";
import { exportAllDataAsJson } from "@/lib/export/data-export";

export default function ExportPage() {
  const { user } = useAuth();
  const profile = useProfile();
  const envelopes = useAllEnvelopes();
  const transactions = useTransactions(100000);
  const incomeEntries = useIncomeEntries(100000);
  const incomeSources = useIncomeSources();

  const [envelopeFilter, setEnvelopeFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const currency = profile?.defaultCurrency ?? "XOF";

  const envelopeName = useMemo(() => {
    const map = new Map((envelopes ?? []).map((e) => [e.id, e.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "?") : "Hors budget");
  }, [envelopes]);

  const sourceName = useMemo(() => {
    const map = new Map((incomeSources ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? "?";
  }, [incomeSources]);

  const filtered = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((t) => {
      if (envelopeFilter === "out_of_budget" && t.envelopeId !== null) return false;
      if (envelopeFilter !== "all" && envelopeFilter !== "out_of_budget" && t.envelopeId !== envelopeFilter) {
        return false;
      }
      if (startDate && t.occurredAt < startDate) return false;
      if (endDate && t.occurredAt > endDate) return false;
      return true;
    });
  }, [transactions, envelopeFilter, startDate, endDate]);

  // Les rentrées n'ont pas d'enveloppe : le filtre par enveloppe ne s'applique qu'aux
  // transactions, mais la période reste commune aux deux exports (8 + section rentrées).
  const filteredIncomeEntries = useMemo(() => {
    if (!incomeEntries) return [];
    if (envelopeFilter !== "all") return [];
    return incomeEntries.filter((inc) => {
      if (startDate && inc.occurredAt < startDate) return false;
      if (endDate && inc.occurredAt > endDate) return false;
      return true;
    });
  }, [incomeEntries, envelopeFilter, startDate, endDate]);

  const periodLabel = startDate || endDate ? `Du ${startDate || "…"} au ${endDate || "…"}` : "Toutes périodes";
  const totalCount = filtered.length + filteredIncomeEntries.length;

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Export des données</h1>
        <p className="text-sm text-neutral-500">
          Exportez l&apos;historique de vos transactions et rentrées, filtré par période et/ou enveloppe (8).
        </p>
      </header>

      <section className="card space-y-4">
        <div>
          <label className="label" htmlFor="envelopeFilter">
            Enveloppe
          </label>
          <select
            id="envelopeFilter"
            className="input"
            value={envelopeFilter}
            onChange={(e) => setEnvelopeFilter(e.target.value)}
          >
            <option value="all">Toutes les enveloppes (+ rentrées)</option>
            <option value="out_of_budget">Hors budget uniquement</option>
            {(envelopes ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="startDate">
              Du
            </label>
            <input
              id="startDate"
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="endDate">
              Au
            </label>
            <input
              id="endDate"
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500">{totalCount} ligne(s) correspondante(s).</p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="btn-secondary flex-1"
            onClick={() =>
              exportTransactionsAsCsv(filtered, envelopeName, currency, filteredIncomeEntries, sourceName)
            }
            disabled={totalCount === 0}
          >
            <FileSpreadsheet className="h-4 w-4" /> Export CSV
          </button>
          <button
            className="btn-secondary flex-1"
            onClick={() =>
              exportTransactionsAsPdf(
                filtered,
                envelopeName,
                currency,
                periodLabel,
                filteredIncomeEntries,
                sourceName
              )
            }
            disabled={totalCount === 0}
          >
            <FileText className="h-4 w-4" /> Export PDF
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Sauvegarde complète</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Toutes vos données (enveloppes, transactions, rentrées, journal d&apos;activité) au format JSON.
        </p>
        <button className="btn-secondary w-full" onClick={() => user && exportAllDataAsJson(user.id)}>
          <Database className="h-4 w-4" /> Exporter tout (JSON)
        </button>
      </section>
    </div>
  );
}
