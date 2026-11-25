# Nimba IA — Agent IA autonome

Nimba IA est une application web d'agent IA **autonome**, en français, prête à l'emploi. Vous donnez un objectif, et l'agent le découpe en étapes, utilise des outils (recherche, calcul, code, météo, lecture de pages web), mémorise ce qui compte et produit des fichiers téléchargeables, jusqu'à ce que la mission soit terminée.

Aucun serveur, aucune installation : l'application tourne entièrement dans le navigateur. Elle fonctionne avec la clé API du fournisseur d'IA de votre choix.

## Fonctionnalités

| Domaine | Détail |
|---|---|
| Mode autonome | Boucle réflexion → action → observation, avec plan d'action visible, suivi de progression et nombre d'étapes réglable (1 à 50) |
| Mode assistant | Discussion classique avec réponses en streaming et accès aux outils |
| Outils | Recherche web (Wikipédia), lecture de pages web, exécution de JavaScript en bac à sable, calculatrice, météo, date/heure, mémoire, création de fichiers |
| Sécurité | Validation humaine (optionnelle) avant les actions sensibles ; code exécuté dans un Web Worker isolé avec délai maximal de 8 s |
| Mémoire long terme | Faits sur l'utilisateur partagés entre toutes les conversations, modifiables à la main |
| Fichiers | Rapports `.md`, tableaux `.csv`, pages `.html`, scripts… avec aperçu, copie et téléchargement |
| Fournisseurs | OpenAI, Google Gemini, OpenRouter (Claude, Llama, etc.), Groq, Mistral, DeepSeek, Ollama (local et gratuit) ou toute API compatible OpenAI |
| Voix | Dictée vocale (fr-FR) et lecture des réponses à voix haute |
| Organisation | Historique des conversations, recherche, groupement par date, export/import JSON |
| Interface | Thème clair/sombre, responsive mobile, installable (PWA), fonctionne hors ligne pour l'interface |

## Démarrage rapide

### Option 1 : en ligne (GitHub Pages)
L'application est publiée sur **https://diallooumar224.github.io/nimba-ia/**.
Chaque `push` sur la branche `main` met le site à jour automatiquement (Settings → Pages → Deploy from a branch → `main` / racine).
Ouvrez le lien, cliquez sur **Paramètres** et ajoutez votre clé API.

### Option 2 : en local
```bash
git clone <url-du-depot> nimba-ia
cd nimba-ia
python3 -m http.server 8080
# puis ouvrez http://localhost:8080
```

### Obtenir une clé API
- **Google Gemini** : offre gratuite sur [aistudio.google.com](https://aistudio.google.com/apikey)
- **Groq** : offre gratuite sur [console.groq.com](https://console.groq.com/keys)
- **OpenAI** : [platform.openai.com](https://platform.openai.com/api-keys)
- **OpenRouter** : accès à des centaines de modèles sur [openrouter.ai](https://openrouter.ai/keys)
- **Ollama** : 100 % local et gratuit, sans clé ([ollama.com](https://ollama.com)). Lancez `OLLAMA_ORIGINS=* ollama serve`.

Choisissez un modèle qui prend en charge les **appels d'outils** (function calling), par exemple `gpt-4o-mini`, `gemini-2.5-flash`, `llama-3.3-70b-versatile` ou `mistral-small-latest`.

## Confidentialité
- La clé API, les conversations, la mémoire et les fichiers restent dans le `localStorage` de votre navigateur.
- Les messages sont envoyés uniquement au fournisseur d'IA que vous avez choisi.
- Les outils web appellent Wikipédia, Open-Meteo et r.jina.ai (lecture de pages) ; vous pouvez désactiver chaque outil dans les paramètres.
- L'export exclut la clé API.

## Architecture
```
index.html            Interface (barre latérale, conversation, panneau Plan/Mémoire/Fichiers)
css/style.css         Design system (thèmes clair et sombre, responsive)
js/app.js             Interface, état, rendu, paramètres, voix
js/agent.js           Boucle de l'agent autonome et prompt système
js/llm.js             Client compatible OpenAI (streaming + appels d'outils)
js/tools.js           Définition et exécution des outils
js/storage.js         Persistance locale
sw.js                 Cache hors ligne (PWA)
.nojekyll             Publication GitHub Pages sans traitement Jekyll
dev/mock-server.py    Faux serveur d'IA pour tester sans clé
```

### Ajouter un outil
Dans `js/tools.js`, ajoutez une entrée à `TOOLS` :
```js
mon_outil: {
  label: 'Mon outil',
  def: fn('mon_outil', "Description pour l'IA", { param: { type: 'string' } }, ['param']),
  run: async ({ param }, ctx) => `Résultat pour ${param}`,
},
```
Il apparaît automatiquement dans les paramètres et devient utilisable par l'agent.

### Tester sans clé API
```bash
python3 dev/mock-server.py   # écoute sur http://localhost:8787/v1
```
Dans les paramètres, choisissez **Personnalisé**, URL `http://localhost:8787/v1`, modèle `mock-1`.

## Licence
MIT
