# AGOA DGD

Application Windows de suivi financier des chantiers en exécution : lots, actes d'engagement,
avenants, moins-values, factures d'avancement, honoraires d'architecte et décompte général
(SELARL Rémi Thollet Architecte).

## Installer

Télécharger `AGOA-DGD-Setup-x.y.z.exe` dans la dernière
[Release](https://github.com/agence-rt/agoa-dgd/releases/latest) et le lancer.
L'assistant (en français) s'ouvre sur une page d'accueil qui annonce les étapes, puis demande :
- pour qui installer : l'utilisateur courant (sans droits administrateur) ou tous les utilisateurs du poste ;
- le **dossier d'installation** (modifiable).

Windows peut afficher « Windows a protégé votre ordinateur » (installateur non signé) :
**Informations complémentaires**, puis **Exécuter quand même**.

Les mises à jour automatiques s'installent dans le même dossier, sans repasser par l'assistant.
Une installation de l'ancienne version « Suivi financier des chantiers » est remplacée.

## Mises à jour

Au lancement, pendant l'écran de démarrage « AGOA DGD », l'application interroge
les Releases de ce dépôt (6 s au plus ; hors connexion, elle démarre normalement).
Si une version plus récente existe, l'écran l'indique, la télécharge (progression affichée),
l'installe puis relance AGOA DGD, sans intervention. En cours d'utilisation,
**Aide › Rechercher une mise à jour** propose la mise à jour.

## Accueil

Au lancement, l'accueil affiche le logo, **Créer un nouveau DGD**, **Ouvrir un fichier** et la liste
des fichiers récents (un clic pour rouvrir, « × » pour retirer de la liste). **Fichier › Fermer le dossier**
(Ctrl+W) ou le bouton « ← Accueil » y ramène. Un double-clic sur un `.dgd` ouvre directement le dossier.

## Données

- **Dossier AGOA DGD** : un seul fichier **`.dgd`** par dossier, à placer dans
  Dropbox pour que les collègues puissent le reprendre. Un double-clic sur un `.dgd` l'ouvre dans
  AGOA DGD. **Fichier › Enregistrer sous** (Ctrl+Maj+S) en fait une copie `.dgd`, PDF compris ;
  les anciens fichiers `.json` restent lisibles et se convertissent ainsi. Un fichier `.lock` voisin signale le poste
  qui l'a ouvert ; les autres passent en lecture seule.
- **PDF joints** (un par ligne d'engagement, de facture ou de note d'honoraires) : dossier
  `<nom du fichier> - PDF` à côté du fichier de données, synchronisé par Dropbox lui aussi.
- **Sauvegardes** : une copie du fichier de données par session (30 dernières) dans
  `%APPDATA%\AGOA DGD\sauvegardes` (menu **Fichier › Ouvrir le dossier des sauvegardes**).

Les données de la version en ligne (claude.ai) se reprennent avec son bouton
« Exporter les données » : ouvrir le `.json` obtenu dans l'application, puis l'enregistrer au format `.dgd`.

## Publier un déploiement

```
npm run deploy -- "Description de la mise à jour"
git push
```

Le script incrémente le numéro de déploiement, aligne la version (`1.<n>.0`), met à jour
`DEPLOIEMENTS.md` et les notes de version, puis crée le commit. Dès que la nouvelle version
arrive sur `main`, GitHub Actions fabrique l'installateur et publie la Release
(étiquette `vX.Y.Z` comprise). Les postes installés se mettent ensuite à jour seuls.

## Développement

```
npm install
npm start
```

L'interface est un fichier unique, `app/index.html`, dérivé de la version utilisable dans claude.ai
(stockage dans un fichier local au lieu de la base claude.ai, impression PDF native).
