import type { JournalEvent } from "@/types/domain";

/** Libellé lisible d'un événement du journal, pour l'écran "Activité récente" (5). */
export function describeJournalEvent(event: JournalEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.eventType) {
    case "envelope.create":
      return `Création de l'enveloppe « ${p.name ?? ""} »`;
    case "envelope.update":
      return "Modification d'une enveloppe";
    case "envelope.archive":
      return "Archivage d'une enveloppe";
    case "envelope.delete":
      return "Suppression définitive d'une enveloppe";
    case "transaction.create":
      return `Ajout d'une transaction${p.description ? ` : ${p.description}` : ""}`;
    case "transaction.update":
      return "Modification d'une transaction";
    case "transaction.delete":
      return "Suppression d'une transaction";
    case "transfer.create":
      return "Transfert entre deux enveloppes";
    case "recurrence.create":
      return "Création d'une transaction récurrente";
    case "recurrence.update":
      return "Modification d'une récurrence";
    case "recurrence.delete":
      return "Arrêt d'une récurrence";
    case "pending_recurrence.confirm":
      return "Confirmation d'une échéance récurrente";
    case "pending_recurrence.dismiss":
      return "Échéance récurrente ignorée";
    case "profile.currency_change":
      return `Changement de devise (${p.fromCurrency ?? "?"} → ${p.toCurrency ?? "?"})`;
    case "profile.update":
      return "Modification des réglages du compte";
    case "income_entry.create":
      return "Ajout d'une rentrée d'argent";
    case "income_entry.update":
      return "Modification d'une rentrée d'argent";
    case "income_entry.delete":
      return "Suppression d'une rentrée d'argent";
    case "income_source.create":
      return `Création de la source « ${p.name ?? ""} »`;
    case "income_source.update":
      return "Modification d'une source de rentrée";
    case "income_source.delete":
      return "Suppression d'une source de rentrée";
    default:
      return event.eventType;
  }
}
