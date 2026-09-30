import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Transaction } from "@/types/domain";
import { formatMoney } from "@/lib/domain/currency";
import { downloadBlob } from "./download";

/** Export PDF de l'historique des transactions, filtrable par période/enveloppe (8). */
export function exportTransactionsAsPdf(
  transactions: Transaction[],
  envelopeName: (id: string) => string,
  currency: string,
  periodLabel: string
): void {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Visio — historique des transactions", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(periodLabel, 14, 25);

  const totalIncome = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  autoTable(doc, {
    startY: 32,
    head: [["Date", "Type", "Enveloppe", "Description", "Montant"]],
    body: transactions.map((t) => [
      t.occurredAt,
      t.type === "expense" ? "Dépense" : "Revenu",
      envelopeName(t.envelopeId),
      t.description ?? "",
      formatMoney(t.amount, currency),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [21, 132, 84] },
    foot: [
      ["", "", "", "Total revenus", formatMoney(totalIncome, currency)],
      ["", "", "", "Total dépenses", formatMoney(totalExpense, currency)],
    ],
  });

  const blob = doc.output("blob");
  downloadBlob(blob, `visio-transactions-${new Date().toISOString().slice(0, 10)}.pdf`);
}
