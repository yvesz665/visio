import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { IncomeEntry, Transaction } from "@/types/domain";
import { formatMoney } from "@/lib/domain/currency";
import { downloadBlob } from "./download";

/**
 * Export PDF de l'historique des transactions ET des rentrées d'argent, filtrable par
 * période/enveloppe (8, + section "Rentrées d'argent").
 */
export function exportTransactionsAsPdf(
  transactions: Transaction[],
  envelopeName: (id: string | null) => string,
  currency: string,
  periodLabel: string,
  incomeEntries: IncomeEntry[] = [],
  sourceName: (id: string) => string = () => "?"
): void {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Visio — historique des transactions", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(periodLabel, 14, 25);

  const totalReimbursement = transactions
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const totalIncomeEntries = incomeEntries.reduce((s, i) => s + i.amount, 0);

  autoTable(doc, {
    startY: 32,
    head: [["Date", "Type", "Enveloppe / Source", "Description", "Montant"]],
    body: [
      ...transactions.map((t) => [
        t.occurredAt,
        t.type === "expense" ? "Dépense" : "Remboursement",
        envelopeName(t.envelopeId),
        t.description ?? "",
        formatMoney(t.amount, currency),
      ]),
      ...incomeEntries.map((inc) => [
        inc.occurredAt,
        "Rentrée",
        sourceName(inc.sourceId),
        inc.description ?? "",
        formatMoney(inc.amount, currency),
      ]),
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [21, 132, 84] },
    foot: [
      ["", "", "", "Total rentrées", formatMoney(totalIncomeEntries, currency)],
      ["", "", "", "Total remboursements", formatMoney(totalReimbursement, currency)],
      ["", "", "", "Total dépenses", formatMoney(totalExpense, currency)],
    ],
  });

  const blob = doc.output("blob");
  downloadBlob(blob, `visio-transactions-${new Date().toISOString().slice(0, 10)}.pdf`);
}
