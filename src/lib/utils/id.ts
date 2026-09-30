/**
 * Génère un identifiant UUID côté client.
 *
 * `crypto.randomUUID()` n'est disponible que dans un « contexte sécurisé » (HTTPS ou
 * localhost) — ce qui exclut typiquement l'accès à un serveur de développement depuis
 * un téléphone via l'IP locale en HTTP simple (ex: http://192.168.x.x:3000). En
 * production, la PWA est nécessairement servie en HTTPS (exigence de toute façon requise
 * pour les service workers), donc `randomUUID` y est utilisé directement quand
 * disponible ; ce repli ne sert qu'au confort de test en développement.
 *
 * `crypto.getRandomValues()`, contrairement à `randomUUID()`, n'a pas cette restriction
 * de contexte sécurisé et est utilisé ici pour construire un UUID v4 manuellement.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
