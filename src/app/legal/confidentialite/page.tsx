export const metadata = { title: "Politique de confidentialité — Visio" };

export default function ConfidentialitePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed text-neutral-700">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">Politique de confidentialité</h1>
      <p className="mb-4 text-xs text-neutral-400">Dernière mise à jour : à compléter avant mise en public.</p>

      <Section title="1. Données collectées">
        Visio traite les données suivantes : votre adresse email et mot de passe (haché, jamais stocké
        en clair) pour l&apos;authentification ; les enveloppes budgétaires, transactions, règles de
        récurrence et transferts que vous saisissez ; les pièces justificatives (photos de reçus) que
        vous choisissez de joindre ; vos préférences (devise, seuils de notification) ; et un journal
        technique de vos actions, nécessaire au fonctionnement de l&apos;annulation et de la
        synchronisation hors-ligne.
      </Section>

      <Section title="2. Usage des données">
        Ces données ne sont utilisées que pour faire fonctionner l&apos;application : afficher votre
        budget, calculer vos totaux, générer vos exports, et vous envoyer les notifications de
        dépassement de budget que vous avez configurées. Elles ne sont ni vendues, ni partagées avec
        des tiers, ni utilisées à des fins publicitaires.
      </Section>

      <Section title="3. Stockage et sécurité">
        Les données sont stockées chez Supabase (base de données Postgres hébergée), avec chiffrement
        systématique des communications (HTTPS). Une copie locale est conservée sur votre appareil
        (stockage du navigateur) pour permettre l&apos;utilisation hors-ligne ; elle n&apos;est
        accessible qu&apos;à ce navigateur.
      </Section>

      <Section title="4. Durée de conservation">
        Vos données sont conservées tant que votre compte existe. En cas de suppression de compte,
        elles sont effacées immédiatement et définitivement, sans période de rétention.
      </Section>

      <Section title="5. Vos droits">
        Vous pouvez à tout moment : consulter l&apos;ensemble de vos données depuis
        l&apos;application ; les exporter (CSV, PDF ou export complet JSON) ; les corriger en modifiant
        vos enveloppes et transactions ; et supprimer définitivement votre compte et toutes les données
        associées depuis les réglages.
      </Section>

      <Section title="6. Notifications push">
        Si vous activez les notifications, votre navigateur génère un identifiant d&apos;abonnement
        push (propre à cet appareil) que nous stockons pour pouvoir vous envoyer des alertes de
        dépassement de budget. Vous pouvez désactiver les notifications à tout moment dans les
        réglages de votre navigateur ou de votre appareil.
      </Section>

      <Section title="7. Contact">
        Pour toute question relative à vos données, contactez le porteur du projet, Yves Charlemagne
        Zombré.
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
