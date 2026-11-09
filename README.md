# People

Suivi de tes contacts : qui tu n'as pas vu depuis longtemps, anniversaires, cadeaux (Noël / anniversaires, groupés, reçus), synchro Google Agenda & Contacts.

## Lancer

```bash
npm start            # http://localhost:3000   (Node ≥ 22.5, aucune dépendance à installer)
npm run demo         # même chose avec des données fictives, sur http://localhost:3100
```

Les données sont dans `data/` (SQLite + photos) : copie ce dossier pour sauvegarder.

## Fonctionnement

- **Groupes** : Famille proche, Amis proches, Famille, Amis, Connaissances. Le seuil (en jours) de chaque groupe se règle dans **Admin**.
- **Override** : sur une fiche, « Fréquence perso » remplace le seuil du groupe pour cette personne.
- **À revoir** (dashboard) : contacts dont la dernière visite dépasse le seuil, triés par retard relatif.
- **Cadeaux** : par fiche, on indique si on offre un cadeau d'anniversaire et/ou de Noël. Chaque cadeau a un statut (idée → acheté → offert), peut être **groupé** (co-donateurs + ma part), et on garde aussi ce qu'on a **reçu**.
- **Dashboard** : anniversaires des 30 prochains jours avec l'état du cadeau ; en novembre/décembre, une zone **Noël** (`/?noel=1` pour la forcer le reste de l'année).

## Google (Admin → Google Agenda & Contacts)

Il faut créer ton propre client OAuth (gratuit) : les étapes sont détaillées dans la page Admin.

| Sens | Quoi |
|---|---|
| Google → ici | Contacts (nom, email, tél., anniversaire, photo) ; événements passés dont un invité a l'email d'une fiche (ou dont le titre contient son nom complet) → visites |
| Ici → Google | rien : l'accès à l'agenda est en lecture seule |


`node --test`-free : la logique de synchro est vérifiée par `DATA_DIR=/tmp/p node test-google-mock.mjs` (faux Google).
