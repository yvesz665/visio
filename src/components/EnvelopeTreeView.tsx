"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { EnvelopeSummary } from "@/types/domain";
import { EnvelopeIcon } from "./IconPicker";
import { formatMoney } from "@/lib/domain/currency";

/** Vue arborescente de l'état actuel du budget (7.1) : consommé/restant, alertes. */
export function EnvelopeTreeView({
  summary,
  currency,
  depth = 0,
}: {
  summary: EnvelopeSummary;
  currency: string;
  depth?: number;
}) {
  const { envelope, percentConsumed, remaining, isOverBudget, isNearThreshold } = summary;
  const barColor = isOverBudget ? "#dc2626" : isNearThreshold ? "#d97706" : envelope.color;

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      <Link
        href={`/envelopes/${envelope.id}`}
        className={`mb-2 flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-neutral-50 ${
          isOverBudget ? "border-red-200 bg-red-50/50" : "border-neutral-200 bg-white"
        }`}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${envelope.color}22`, color: envelope.color }}
        >
          <EnvelopeIcon icon={envelope.icon} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-neutral-900">{envelope.name}</span>
            <div className="flex items-center gap-1 text-xs">
              {(isOverBudget || isNearThreshold) && (
                <AlertTriangle className={`h-3.5 w-3.5 ${isOverBudget ? "text-red-600" : "text-amber-600"}`} />
              )}
              <span className={isOverBudget ? "font-semibold text-red-600" : "text-neutral-500"}>
                {formatMoney(remaining, currency)} restant
              </span>
            </div>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, Math.max(0, percentConsumed))}%`, backgroundColor: barColor }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
            <span>{formatMoney(summary.subtreeSpent, currency)} dépensé</span>
            <span>{formatMoney(envelope.allocatedAmount, currency)} alloué</span>
          </div>
        </div>
      </Link>
      {summary.children.map((child) => (
        <EnvelopeTreeView key={child.envelope.id} summary={child} currency={currency} depth={depth + 1} />
      ))}
    </div>
  );
}
