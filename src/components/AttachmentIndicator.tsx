"use client";

import { useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";
import { useAttachmentForTransaction } from "@/hooks/useVisioData";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Indicateur de pièce jointe (4.1) sur une ligne de transaction. Le fichier lui-même
 * n'est jamais mis en cache hors-ligne (ce serait coûteux en espace pour des photos) :
 * l'ouverture nécessite donc une connexion, via une URL signée à durée limitée.
 */
export function AttachmentIndicator({ transactionId }: { transactionId: string }) {
  const attachment = useAttachmentForTransaction(transactionId);
  const [loading, setLoading] = useState(false);

  if (!attachment) return null;

  async function handleOpen() {
    if (attachment?.syncStatus !== "synced") {
      alert("Cette pièce jointe sera consultable une fois la synchronisation terminée.");
      return;
    }
    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.storage
        .from("attachments")
        .createSignedUrl(attachment.storagePath, 60);
      if (error || !data) throw error ?? new Error("URL introuvable");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      alert("Impossible d'ouvrir la pièce jointe pour le moment (hors-ligne ?).");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="shrink-0 text-neutral-400 hover:text-brand-700"
      aria-label="Voir la pièce justificative"
      title={attachment.syncStatus === "synced" ? "Voir la pièce justificative" : "En attente de synchronisation"}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
    </button>
  );
}
