// Outils disponibles pour l'agent. Chaque outil : définition (schéma JSON) + exécution.

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const trunc = (s, n = 6000) => (s.length > n ? s.slice(0, n) + `\n…[tronqué, ${s.length - n} caractères de plus]` : s);

export const TOOLS = {
  mettre_a_jour_plan: {
    label: 'Planification', always: true,
    def: fn('mettre_a_jour_plan',
      "Crée ou met à jour le plan d'action de la mission. Appelle-le au début pour décomposer l'objectif, puis à chaque changement de statut d'étape.",
      { etapes: { type: 'array', items: { type: 'object', properties: {
          titre: { type: 'string' },
          statut: { type: 'string', enum: ['a_faire', 'en_cours', 'termine', 'echec'] } }, required: ['titre', 'statut'] } } },
      ['etapes']),
    run: async ({ etapes }, ctx) => { ctx.setPlan(etapes || []); const d = (etapes || []).filter(e => e.statut === 'termine').length; return `Plan mis à jour (${d}/${(etapes || []).length} étapes terminées).`; },
  },

  recherche_web: {
    label: 'Recherche web (Wikipédia)',
    def: fn('recherche_web', "Recherche des informations encyclopédiques sur Wikipédia. Retourne titres, extraits et liens.",
      { requete: { type: 'string', description: 'Termes de recherche' }, langue: { type: 'string', description: 'Code langue (fr, en…). Défaut : fr' } }, ['requete']),
    run: async ({ requete, langue = 'fr' }) => {
      const base = `https://${langue}.wikipedia.org/w/api.php`;
      const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: requete, format: 'json', origin: '*', srlimit: '5' });
      const r = await fetch(`${base}?${q}`); const j = await r.json();
      const hits = j.query?.search || [];
      if (!hits.length) return 'Aucun résultat.';
      const ids = hits.slice(0, 3).map(h => h.pageid).join('|');
      const q2 = new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', pageids: ids, format: 'json', origin: '*' });
      const j2 = await (await fetch(`${base}?${q2}`)).json();
      const ex = j2.query?.pages || {};
      return hits.map(h => {
        const e = ex[h.pageid]?.extract;
        return `## ${h.title}\nhttps://${langue}.wikipedia.org/?curid=${h.pageid}\n${trunc(e || h.snippet.replace(/<[^>]+>/g, ''), 1500)}`;
      }).join('\n\n');
    },
  },

  lire_page_web: {
    label: 'Lecture de pages web', sensitive: true,
    def: fn('lire_page_web', "Lit le contenu textuel d'une page web à partir de son URL (via le service de lecture r.jina.ai).",
      { url: { type: 'string' } }, ['url']),
    run: async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('URL invalide');
      const r = await fetch('https://r.jina.ai/' + url, { headers: { Accept: 'text/plain' } });
      if (!r.ok) throw new Error('Lecture impossible (HTTP ' + r.status + ')');
      return trunc(await r.text(), 8000);
    },
  },

  executer_javascript: {
    label: 'Exécution de code JavaScript', sensitive: true,
    def: fn('executer_javascript',
      "Exécute du code JavaScript dans un bac à sable isolé (Web Worker, 8 s max). Utilise console.log() pour afficher les résultats ; la valeur de la dernière expression 'return' est aussi renvoyée. Idéal pour calculs, analyse de données, transformations de texte.",
      { code: { type: 'string' } }, ['code']),
    run: ({ code }) => runInWorker(code),
  },

  calculer: {
    label: 'Calculatrice',
    def: fn('calculer', "Évalue une expression mathématique (ex. '(1500000*0.18)/12', 'sqrt(2)', 'pow(1.05,10)').",
      { expression: { type: 'string' } }, ['expression']),
    run: async ({ expression }) => {
      if (!/^[\d\s+\-*/%().,^a-zA-Z_]*$/.test(expression)) throw new Error('Expression non autorisée');
      const allowed = Object.getOwnPropertyNames(Math);
      const words = expression.match(/[a-zA-Z_]+/g) || [];
      for (const w of words) if (!allowed.includes(w)) throw new Error('Fonction inconnue : ' + w);
      const expr = expression.replace(/\^/g, '**');
      const v = Function(...allowed, `"use strict"; return (${expr});`)(...allowed.map(k => Math[k]));
      return `${expression} = ${typeof v === 'number' ? Number(v.toPrecision(12)) : v}`;
    },
  },

  meteo: {
    label: 'Météo',
    def: fn('meteo', 'Donne la météo actuelle et les prévisions sur 3 jours pour une ville.', { ville: { type: 'string' } }, ['ville']),
    run: async ({ ville }) => {
      const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ville)}&count=1&language=fr`)).json();
      const p = g.results?.[0]; if (!p) return 'Ville introuvable.';
      const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=3&timezone=auto`)).json();
      const c = w.current, d = w.daily;
      return `${p.name}, ${p.country} — actuellement ${c.temperature_2m}°C, humidité ${c.relative_humidity_2m}%, vent ${c.wind_speed_10m} km/h, précipitations ${c.precipitation} mm.\n` +
        d.time.map((t, i) => `${t} : ${d.temperature_2m_min[i]}–${d.temperature_2m_max[i]}°C, pluie ${d.precipitation_sum[i]} mm`).join('\n');
    },
  },

  date_heure: {
    label: 'Date et heure',
    def: fn('date_heure', "Renvoie la date et l'heure actuelles (fuseau de l'utilisateur ou fuseau demandé).", { fuseau: { type: 'string', description: 'ex. Africa/Conakry' } }),
    run: async ({ fuseau } = {}) => {
      const tz = fuseau || Intl.DateTimeFormat().resolvedOptions().timeZone;
      return new Date().toLocaleString('fr-FR', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }) + ` (${tz})`;
    },
  },

  memoire_enregistrer: {
    label: 'Mémoire à long terme',
    def: fn('memoire_enregistrer', "Enregistre durablement une information utile sur l'utilisateur ou ses projets (préférences, faits, décisions). Elle sera disponible dans toutes les futures conversations.",
      { cle: { type: 'string', description: 'Nom court, ex. entreprise' }, valeur: { type: 'string' } }, ['cle', 'valeur']),
    run: async ({ cle, valeur }, ctx) => { ctx.memSet(cle, valeur); return `Mémorisé : ${cle}`; },
  },

  memoire_lire: {
    label: 'Mémoire à long terme', hidden: true,
    def: fn('memoire_lire', 'Lit toute la mémoire à long terme enregistrée.'),
    run: async (_, ctx) => { const m = ctx.memAll(); const k = Object.keys(m); return k.length ? k.map(x => `${x} : ${m[x]}`).join('\n') : 'Mémoire vide.'; },
  },

  creer_fichier: {
    label: 'Création de fichiers',
    def: fn('creer_fichier', "Crée un fichier téléchargeable (rapport .md, données .csv, page .html, script, .json…). Utilise-le pour tout livrable conséquent.",
      { nom: { type: 'string', description: 'Nom avec extension, ex. plan-marketing.md' }, contenu: { type: 'string' } }, ['nom', 'contenu']),
    run: async ({ nom, contenu }, ctx) => { ctx.addFile(nom, contenu); return `Fichier « ${nom} » créé (${contenu.length} caractères). L'utilisateur peut le télécharger dans l'onglet Fichiers.`; },
  },

  terminer: {
    label: 'Fin de mission', always: true,
    def: fn('terminer', "Termine la mission. À appeler uniquement quand l'objectif est entièrement atteint (ou impossible). Donne le résumé final destiné à l'utilisateur, en Markdown.",
      { resume: { type: 'string' } }, ['resume']),
    run: async ({ resume }) => resume,
  },
};

export const TOOL_GROUPS = (() => {
  const g = {};
  for (const [name, t] of Object.entries(TOOLS)) if (!t.always && !t.hidden) g[name] = t.label;
  return g;
})();

export function activeTools(enabled, mode) {
  return Object.entries(TOOLS).filter(([name, t]) => {
    if (name === 'terminer' && mode !== 'autonome') return false;
    if (name === 'mettre_a_jour_plan') return true;
    if (name === 'memoire_lire') return enabled.memoire_enregistrer !== false;
    return enabled[name] !== false;
  }).map(([, t]) => t.def);
}

function runInWorker(code) {
  return new Promise((resolve) => {
    const src = `
      const out = [];
      const fmt = v => { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return String(v); } };
      console.log = (...a) => out.push(a.map(fmt).join(' '));
      console.error = console.warn = console.info = console.log;
      self.onmessage = async (e) => {
        try {
          const r = await (new Function('return (async () => {' + e.data + '\\n})()'))();
          if (r !== undefined) out.push('→ ' + fmt(r));
          postMessage({ ok: true, out: out.join('\\n') || '(aucune sortie)' });
        } catch (err) { postMessage({ ok: false, out: out.join('\\n') + '\\nErreur : ' + err.message }); }
      };`;
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); }
    catch (e) { resolve('Erreur : impossible de créer le bac à sable (' + e.message + ')'); return; }
    const timer = setTimeout(() => { w.terminate(); resolve('Erreur : délai de 8 secondes dépassé.'); }, 8000);
    w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(trunc(e.data.out, 6000)); };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); resolve('Erreur : ' + e.message); };
    w.postMessage(code);
  });
}
