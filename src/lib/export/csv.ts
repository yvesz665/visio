import type { IncomeEntry, Transaction } from "@/types/domain";
import { fromMinorUnits } from "@/lib/domain/currency";
import { downloadBlob } from "./download";

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export CSV de l'historique des transactions ET des rentrées d'argent, filtrable par
 * période/enveloppe (8, + section "Rentrées d'argent"). Les rentrées n'ont pas
 * d'enveloppe : leur colonne "Enveloppe" affiche leur source.
 */
export function exportTransactionsAsCsv(
  transactions: Transaction[],
  envelopeName: (id: string | null) => string,
  currency: string,
  incomeEntries: IncomeEntry[] = [],
  sourceName: (id: string) => string = () => "?"
): void {
  const header = ["Date", "Type", "Enveloppe / Source", "Montant", "Devise", "Description"];
  const rows = [
    ...transactions.map((t) => [
      t.occurredAt,
      t.type === "expense" ? "Dépense" : "Remboursement",
      envelopeName(t.envelopeId),
      fromMinorUnits(t.amount).toFixed(2),
      currency,
      t.description ?? "",
    ]),
    ...incomeEntries.map((inc) => [
      inc.occurredAt,
      "Rentrée",
      sourceName(inc.sourceId),
      fromMinorUnits(inc.amount).toFixed(2),
      currency,
      inc.description ?? "",
    ]),
  ];

  const csv = [header, ...rows].map((row) => row.map((cell) => csvEscape(String(cell))).join(";")).join("\n");
  // BOM UTF-8 pour qu'Excel affiche correctement les accents français.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `visio-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
}
