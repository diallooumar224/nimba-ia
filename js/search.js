// Recherche web et actualités
// Moteurs : Tavily (par défaut, fonctionne sans clé), Serper (résultats Google, clé requise), Wikipédia (secours)

const TAVILY = 'https://api.tavily.com';
const SERPER = 'https://google.serper.dev';
const RANGES = { jour: 'day', semaine: 'week', mois: 'month', annee: 'year' };
const SERPER_TBS = { jour: 'qdr:d', semaine: 'qdr:w', mois: 'qdr:m', annee: 'qdr:y' };

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const fmtDate = (d) => { if (!d) return ''; const t = Date.parse(d); return isNaN(t) ? String(d) : new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };

async function tavily(path, body, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key; else headers['X-Tavily-Access-Mode'] = 'keyless';
  const r = await fetch(TAVILY + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.detail?.error || j.detail || j.error || j.message || `HTTP ${r.status}`;
    if (r.status === 429 || r.status === 432 || r.status === 433 || /cap|limit/i.test(JSON.stringify(msg))) {
      throw new Error(key ? 'Tavily : quota de la clé atteint. Rechargez sur app.tavily.com ou passez au moteur Serper.'
        : "Tavily : limite quotidienne de l'accès sans clé atteinte. Ajoutez une clé Tavily gratuite (1 000 recherches/mois, app.tavily.com) dans Paramètres → Recherche web.");
    }
    if (r.status === 401) throw new Error('Tavily : clé invalide.');
    throw new Error('Tavily : ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 200));
  }
  return j;
}

async function serper(path, body, key) {
  const r = await fetch(SERPER + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Serper : ' + (j.message || `HTTP ${r.status}`) + (r.status === 401 || r.status === 403 ? ' (clé invalide)' : ''));
  return j;
}

async function wikipedia(q, lang = 'fr') {
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const p = new URLSearchParams({ action: 'query', list: 'search', srsearch: q, format: 'json', origin: '*', srlimit: '5' });
  const j = await (await fetch(`${base}?${p}`)).json();
  const hits = j.query?.search || [];
  if (!hits.length) return [];
  const p2 = new URLSearchParams({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', pageids: hits.slice(0, 4).map(h => h.pageid).join('|'), format: 'json', origin: '*' });
  const ex = (await (await fetch(`${base}?${p2}`)).json()).query?.pages || {};
  return hits.map(h => ({ title: h.title, url: `https://${lang}.wikipedia.org/?curid=${h.pageid}`, content: ex[h.pageid]?.extract || h.snippet.replace(/<[^>]+>/g, ''), source: 'Wikipédia' }));
}

function format(results, { answer, heading }) {
  if (!results.length) return { text: 'Aucun résultat trouvé. Reformule la requête (mots-clés plus simples, autre langue).', sources: [] };
  let t = heading ? heading + '\n\n' : '';
  if (answer) t += `Synthèse automatique (à vérifier avec les sources) : ${clip(answer, 900)}\n\n`;
  t += results.map((r, i) => {
    const meta = [r.source || host(r.url), fmtDate(r.date)].filter(Boolean).join(' · ');
    return `[${i + 1}] ${r.title}\n${r.url}\n${meta}\n${clip(r.content, 700)}`;
  }).join('\n\n');
  t += '\n\nCite les sources utilisées sous forme de liens Markdown [Titre](url).';
  return { text: t, sources: results.map(r => ({ title: r.title, url: r.url, source: r.source || host(r.url), date: r.date || '' })) };
}

const engine = (s) => (s.searchEngine === 'serper' && s.serperKey ? 'serper' : 'tavily');

export async function webSearch({ requete, periode, nombre = 6, domaines }, s) {
  const n = Math.min(Math.max(Number(nombre) || 6, 1), 10);
  try {
    if (engine(s) === 'serper') {
      const body = { q: requete, num: n, hl: s.searchLang || 'fr' };
      if (s.searchCountry) body.gl = s.searchCountry;
      if (SERPER_TBS[periode]) body.tbs = SERPER_TBS[periode];
      const j = await serper('/search', body, s.serperKey);
      const res = (j.organic || []).slice(0, n).map(o => ({ title: o.title, url: o.link, content: o.snippet, date: o.date }));
      const kg = j.answerBox?.answer || j.answerBox?.snippet || j.knowledgeGraph?.description;
      return format(res, { answer: kg, heading: 'Résultats Google (Serper)' });
    }
    const body = { query: requete, max_results: n, search_depth: s.searchDepth || 'basic', include_answer: true };
    if (RANGES[periode]) body.time_range = RANGES[periode];
    if (Array.isArray(domaines) && domaines.length) body.include_domains = domaines;
    const j = await tavily('/search', body, s.tavilyKey);
    const res = (j.results || []).map(r => ({ title: r.title, url: r.url, content: r.content, date: r.published_date }));
    return format(res, { answer: j.answer, heading: 'Résultats web (Tavily)' });
  } catch (e) {
    // Secours : Wikipédia
    const w = await wikipedia(requete, s.searchLang || 'fr').catch(() => []);
    if (!w.length) throw e;
    const out = format(w, { heading: `Moteur web indisponible (${e.message}). Résultats Wikipédia à la place :` });
    return out;
  }
}

export async function newsSearch({ requete, periode = 'semaine', nombre = 8 }, s) {
  const n = Math.min(Math.max(Number(nombre) || 8, 1), 15);
  if (engine(s) === 'serper') {
    const body = { q: requete, num: n, hl: s.searchLang || 'fr' };
    if (s.searchCountry) body.gl = s.searchCountry;
    if (SERPER_TBS[periode]) body.tbs = SERPER_TBS[periode];
    const j = await serper('/news', body, s.serperKey);
    const res = (j.news || []).slice(0, n).map(o => ({ title: o.title, url: o.link, content: o.snippet, date: o.date, source: o.source }));
    return format(res, { heading: `Actualités Google News (${periode})` });
  }
  const body = { query: requete, topic: 'news', max_results: n, time_range: RANGES[periode] || 'week', include_answer: true, search_depth: s.searchDepth || 'basic' };
  let j;
  try { j = await tavily('/search', body, s.tavilyKey); }
  catch (e) { if (s.serperKey) return newsSearch({ requete, periode, nombre }, { ...s, searchEngine: 'serper' }); throw e; }
  const res = (j.results || [])
    .map(r => ({ title: r.title, url: r.url, content: r.content, date: r.published_date }))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return format(res, { answer: j.answer, heading: `Actualités (${periode}), de la plus récente à la plus ancienne` });
}

export async function readPage({ url }, s) {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL invalide');
  try {
    const j = await tavily('/extract', { urls: [url], format: 'markdown' }, s.tavilyKey);
    const r = j.results?.[0];
    if (r?.raw_content) return { text: clip0(r.raw_content, 9000), sources: [{ title: r.title || host(url), url, source: host(url) }] };
    if (j.failed_results?.length) throw new Error(j.failed_results[0].error || 'extraction impossible');
    throw new Error('page vide');
  } catch (e) {
    const r = await fetch('https://r.jina.ai/' + url, { headers: { Accept: 'text/plain' } });
    if (!r.ok) throw new Error(`Lecture impossible (${e.message})`);
    return { text: clip0(await r.text(), 9000), sources: [{ title: host(url), url, source: host(url) }] };
  }
}
const clip0 = (s, n) => (s.length > n ? s.slice(0, n) + `\n…[tronqué, ${s.length - n} caractères de plus]` : s);

export async function wikiSearch({ requete, langue = 'fr' }) {
  return format(await wikipedia(requete, langue), { heading: 'Résultats Wikipédia' });
}
