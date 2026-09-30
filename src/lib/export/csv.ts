import type { Transaction } from "@/types/domain";
import { downloadBlob } from "./download";

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Export CSV de l'historique des transactions, filtrable par période/enveloppe (8). */
export function exportTransactionsAsCsv(
  transactions: Transaction[],
  envelopeName: (id: string) => string,
  currency: string
): void {
  const header = ["Date", "Type", "Enveloppe", "Montant", "Devise", "Description"];
  const rows = transactions.map((t) => [
    t.occurredAt,
    t.type === "expense" ? "Dépense" : "Revenu",
    envelopeName(t.envelopeId),
    t.amount.toFixed(2),
    currency,
    t.description ?? "",
  ]);

  const csv = [header, ...rows].map((row) => row.map((cell) => csvEscape(String(cell))).join(";")).join("\n");
  // BOM UTF-8 pour qu'Excel affiche correctement les accents français.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `visio-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
}
