export const metadata = { title: "Conditions générales d'utilisation — Visio" };

export default function CguPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-neutral-700">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">
        Conditions générales d&apos;utilisation
      </h1>
      <p className="mb-4 text-xs text-neutral-400">Dernière mise à jour : à compléter avant mise en public.</p>

      <Section title="1. Objet">
        Visio est une application personnelle de gestion budgétaire, développée et mise à disposition
        gratuitement par Yves Charlemagne Zombré. Elle permet à chaque utilisateur de structurer son
        budget en enveloppes emboîdées, de suivre ses transactions et de consulter des tableaux de bord.
      </Section>

      <Section title="2. Gratuité et absence de monétisation">
        L&apos;utilisation de Visio est entièrement gratuite. Aucune fonctionnalité payante, abonnement
        ou publicité n&apos;est proposée dans cette version.
      </Section>

      <Section title="3. Compte utilisateur">
        L&apos;inscription se fait par email et mot de passe. Chaque compte est strictement individuel :
        les données budgétaires ne sont accessibles qu&apos;à leur propriétaire.
      </Section>

      <Section title="4. Responsabilité">
        Visio est fourni « en l&apos;état », sans garantie d&apos;absence d&apos;erreur ou
        d&apos;interruption de service. L&apos;utilisateur reste seul responsable de l&apos;exactitude des
        montants qu&apos;il saisit et des décisions financières qu&apos;il prend sur cette base.
      </Section>

      <Section title="5. Suppression de compte">
        Chaque utilisateur peut supprimer son compte à tout moment depuis les réglages de
        l&apos;application. Cette suppression est définitive et immédiate : aucune donnée n&apos;est
        conservée au-delà de cette action. Un export de toutes les données est proposé avant
        confirmation.
      </Section>

      <Section title="6. Évolution du service">
        Ces conditions peuvent évoluer. Les utilisateurs seront informés de toute modification
        substantielle via l&apos;application.
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-base font-semibold text-neutral-900">{title}</h2>
      <p>{children}</p>
    </section>
  );
}
