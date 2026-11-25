// Nimba IA — interface
import { load, save, wipe, uid, persistent } from './storage.js';
import { PROVIDERS, chat as llmChat } from './llm.js';
import { TOOL_GROUPS } from './tools.js';
import { runAgent } from './agent.js';
import { newsSearch } from './search.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- État ----------
const DEFAULT_SETTINGS = { provider: 'openai', baseUrl: PROVIDERS.openai.baseUrl, apiKey: '', model: PROVIDERS.openai.model, temperature: 0.4, maxSteps: 15, approval: true, tts: false, system: '', tools: {}, theme: null,
  searchEngine: 'tavily', tavilyKey: '', serperKey: '', searchLang: 'fr', searchCountry: 'gn', searchDepth: 'basic' };
const state = {
  settings: { ...DEFAULT_SETTINGS, ...load('settings', {}) },
  convs: load('convs', []),
  memory: load('memory', {}),
  files: load('files', []),
  currentId: null,
  mode: 'autonome',
  running: null, // AbortController
  runningCall: null,
};
const persist = () => { save('convs', state.convs); save('memory', state.memory); save('files', state.files); };
const current = () => state.convs.find(c => c.id === state.currentId);

function newConv() {
  const c = { id: uid(), title: 'Nouvelle mission', created: Date.now(), updated: Date.now(), messages: [], plan: [] };
  state.convs.unshift(c); state.currentId = c.id; persist(); return c;
}

// ---------- Thème ----------
function applyTheme() {
  const t = state.settings.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = t;
}
$('#toggleTheme').onclick = () => {
  state.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  save('settings', state.settings); applyTheme();
};

// ---------- Toast ----------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- Markdown ----------
function md(text) {
  const html = window.marked ? window.marked.parse(text || '', { breaks: true, gfm: true }) : esc(text).replace(/\n/g, '<br>');
  return window.DOMPurify ? window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }) : html;
}
function enhance(el) {
  el.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  el.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-code')) return;
    const b = document.createElement('button'); b.className = 'copy-code'; b.type = 'button'; b.textContent = 'Copier';
    b.onclick = () => copy(pre.innerText.replace(/Copier$/, '').trim(), b);
    pre.appendChild(b);
  });
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = 'Copié'; setTimeout(() => (btn.textContent = o), 1200); } else toast('Copié');
}

// ---------- Sidebar ----------
function renderList() {
  const q = $('#searchChats').value.trim().toLowerCase();
  const list = $('#chatList'); list.innerHTML = '';
  const items = state.convs.filter(c => !q || c.title.toLowerCase().includes(q) || c.messages.some(m => typeof m.content === 'string' && m.content.toLowerCase().includes(q)));
  if (!items.length) { list.innerHTML = `<p class="panel-empty">${q ? 'Aucun résultat' : 'Aucune conversation'}</p>`; return; }
  const day = 864e5, now = Date.now();
  let lastGroup = '';
  for (const c of items) {
    const g = now - c.updated < day ? "Aujourd'hui" : now - c.updated < 7 * day ? '7 derniers jours' : 'Plus ancien';
    if (g !== lastGroup) { list.insertAdjacentHTML('beforeend', `<div class="chat-group">${g}</div>`); lastGroup = g; }
    const b = document.createElement('div');
    b.className = 'chat-item' + (c.id === state.currentId ? ' active' : '');
    b.tabIndex = 0; b.role = 'button';
    b.innerHTML = `<span class="name">${esc(c.title)}</span><button class="del" aria-label="Supprimer" title="Supprimer"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>`;
    b.onclick = (e) => {
      if (e.target.closest('.del')) { e.stopPropagation(); deleteConv(c.id); return; }
      if (state.running) return toast('Une mission est en cours');
      state.currentId = c.id; renderAll(); closeMobile();
    };
    b.onkeydown = (e) => { if (e.key === 'Enter') b.click(); };
    list.appendChild(b);
  }
}
function deleteConv(id) {
  if (state.running && id === state.currentId) return toast('Arrêtez la mission avant de supprimer');
  state.convs = state.convs.filter(c => c.id !== id);
  state.files = state.files.filter(f => f.convId !== id);
  if (state.currentId === id) state.currentId = state.convs[0]?.id || null;
  persist(); renderAll();
}
$('#searchChats').oninput = renderList;
$('#newChat').onclick = () => {
  if (state.running) return toast('Une mission est en cours');
  const c = current();
  if (c && !c.messages.length) { renderAll(); closeMobile(); $('#input').focus(); return; }
  newConv(); renderAll(); closeMobile(); $('#input').focus();
};

// ---------- Messages ----------
const SUGGESTIONS = [
  ['Étude de marché', "Fais une étude de marché synthétique sur la vente de panneaux solaires en Guinée et crée un rapport téléchargeable."],
  ['Plan financier', "Calcule le remboursement mensuel d'un prêt de 150 000 000 GNF sur 3 ans à 14 % par an, avec un tableau d'amortissement en CSV."],
  ['Analyse de données', "Génère 30 ventes fictives, analyse-les avec du code (total, moyenne, meilleur mois) et résume les tendances."],
  ['Revue de presse', "Fais-moi une revue de presse des actualités économiques en Guinée cette semaine, avec les sources."],
];

function renderMessages(opts = {}) {
  const box = $('#messages'); const c = current();
  box.innerHTML = '';
  if (!c || !c.messages.length) {
    const needKey = !state.settings.apiKey && state.settings.provider !== 'ollama';
    box.innerHTML = `<div class="empty">
      <div><h2>Donnez un objectif.<br><span>L'agent s'occupe du reste.</span></h2></div>
      <p>Nimba planifie, recherche, calcule, exécute du code, mémorise et produit des fichiers — étape par étape, en toute autonomie.</p>
      ${needKey ? `<div class="setup-card"><span>Ajoutez votre clé API (OpenAI, Gemini, Groq, Mistral, OpenRouter…) pour démarrer.</span><button class="btn btn-primary" id="setupBtn">Configurer</button></div>` : ''}
      <div class="suggestions">${SUGGESTIONS.map(([t, p]) => `<button class="suggestion" data-p="${esc(p)}"><b>${t}</b><span>${esc(p)}</span></button>`).join('')}</div>
    </div>`;
    box.querySelectorAll('.suggestion').forEach(b => b.onclick = () => { $('#input').value = b.dataset.p; autosize(); $('#input').focus(); });
    $('#setupBtn')?.addEventListener('click', openSettings);
    return;
  }
  const results = {};
  c.messages.forEach(m => { if (m.role === 'tool') results[m.tool_call_id] = m; });
  let aiBlock = null, turnSources = [];
  const flushSources = (blk) => { if (turnSources.length) { blk.appendChild(sourcesRow(turnSources)); turnSources = []; } };
  const ensureAi = () => {
    if (!aiBlock) { aiBlock = document.createElement('div'); aiBlock.className = 'msg msg-ai'; aiBlock.innerHTML = `<div class="who">Nimba</div>`; box.appendChild(aiBlock); }
    return aiBlock;
  };
  for (const m of c.messages) {
    if (m.role === 'user') {
      aiBlock = null; turnSources = [];
      const d = document.createElement('div'); d.className = 'msg msg-user';
      d.innerHTML = `<div class="bubble">${esc(m.content)}</div>`; box.appendChild(d);
    } else if (m.role === 'assistant') {
      const blk = ensureAi();
      if (m.content) {
        const el = document.createElement('div');
        el.className = m.tool_calls?.length ? 'thought content' : 'content';
        el.innerHTML = md(m.content); enhance(el); blk.appendChild(el);
        if (!m.tool_calls?.length) { flushSources(blk); blk.appendChild(actions(m.content)); }
      }
      for (const call of m.tool_calls || []) {
        const r = results[call.id];
        if (r?.sources) for (const src of r.sources) if (!turnSources.some(x => x.url === src.url)) turnSources.push(src);
        if (call.function.name === 'terminer' && r?.status === 'ok') {
          const el = document.createElement('div'); el.className = 'content'; el.innerHTML = md(r.content); enhance(el);
          blk.appendChild(el); flushSources(blk); blk.appendChild(actions(r.content)); continue;
        }
        blk.appendChild(stepCard(call, r, opts.running === call.id));
      }
    } else if (m.role === 'error') {
      const el = document.createElement('div'); el.className = 'error-box'; el.textContent = m.content; ensureAi().appendChild(el);
    } else if (m.role === 'note') {
      const el = document.createElement('div'); el.className = 'thought'; el.textContent = m.content; ensureAi().appendChild(el);
    }
  }
  scrollDown();
}

function stepCard(call, r, running) {
  let args = call.function.arguments || '';
  let pretty = args;
  try { const o = JSON.parse(args || '{}'); pretty = JSON.stringify(o, null, 2); args = Object.values(o).map(v => Array.isArray(v) ? `${v.length} étape(s)` : typeof v === 'string' ? v : JSON.stringify(v)).join(' · '); } catch {}
  const d = document.createElement('details');
  d.className = 'step ' + (r ? r.status : running ? 'running' : 'running');
  const label = { ok: 'terminé', err: 'erreur', denied: 'refusé' }[r?.status] || 'en cours…';
  d.innerHTML = `<summary><span class="badge"></span><span class="tool">${esc(call.function.name)}</span><span class="arg">${esc(args.slice(0, 140))}</span><span>${label}</span></summary>
    <pre><b>Entrée</b>\n${esc(pretty)}${r ? `\n\n<b>Résultat</b>\n${esc(r.content)}` : ''}</pre>`;
  return d;
}

function sourcesRow(list) {
  const wrap = document.createElement('details'); wrap.className = 'sources';
  const fav = (u) => { try { return `https://www.google.com/s2/favicons?sz=32&domain=${new URL(u).hostname}`; } catch { return ''; } };
  const top = list.slice(0, 4).map(x => `<img src="${esc(fav(x.url))}" alt="" loading="lazy">`).join('');
  wrap.innerHTML = `<summary><span class="favs">${top}</span>${list.length} source${list.length > 1 ? 's' : ''} consultée${list.length > 1 ? 's' : ''}</summary>
    <ol>${list.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener"><span class="s-title">${esc(x.title)}</span><span class="s-meta">${esc(x.source || '')}${x.date ? ' · ' + esc(x.date) : ''}</span></a></li>`).join('')}</ol>`;
  return wrap;
}

function actions(text) {
  const a = document.createElement('div'); a.className = 'msg-actions';
  a.innerHTML = `<button class="icon-btn" title="Copier" aria-label="Copier"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg></button>
  <button class="icon-btn" title="Lire à voix haute" aria-label="Lire à voix haute"><svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>`;
  const [c, s] = a.querySelectorAll('button');
  c.onclick = () => copy(text); s.onclick = () => speak(text);
  return a;
}

function scrollDown() { const b = $('#messages'); b.scrollTop = b.scrollHeight; }

// Streaming en direct
let liveEl = null, liveText = '';
function streamStart() {
  liveText = '';
  let blk = $('#messages .msg-ai:last-child');
  if (!blk) { blk = document.createElement('div'); blk.className = 'msg msg-ai'; blk.innerHTML = `<div class="who">Nimba</div>`; $('#messages').appendChild(blk); }
  liveEl = document.createElement('div'); liveEl.className = 'content cursor'; liveEl.innerHTML = '';
  blk.appendChild(liveEl); scrollDown();
}
let rafPending = false;
function streamDelta(t) {
  liveText += t;
  if (rafPending) return; rafPending = true;
  requestAnimationFrame(() => { rafPending = false; if (liveEl) { liveEl.innerHTML = md(liveText); liveEl.classList.add('cursor'); scrollDown(); } });
}

// ---------- Panneau ----------
function setPlan(etapes) { const c = current(); if (c) { c.plan = etapes; persist(); renderPanel(); } }
function memSet(k, v) { state.memory[k] = v; persist(); renderPanel(); }
function addFile(name, content) { state.files.unshift({ id: uid(), name, content, convId: state.currentId, created: Date.now() }); persist(); renderPanel(); toast('Fichier créé : ' + name); }

function renderPanel() {
  const c = current();
  // Plan
  const plan = c?.plan || [];
  const done = plan.filter(e => e.statut === 'termine').length;
  $('#tab-plan').innerHTML = plan.length
    ? `<div class="plan-goal">Progression · ${done}/${plan.length}</div><div class="progress"><i style="width:${plan.length ? (done / plan.length) * 100 : 0}%"></i></div>` +
      plan.map(e => `<div class="plan-step ${esc(e.statut)}"><span class="ico"></span><span class="txt">${esc(e.titre)}</span></div>`).join('')
    : `<p class="panel-empty">Le plan d'action de l'agent apparaîtra ici en mode autonome.</p>`;
  // Mémoire
  const mem = Object.entries(state.memory);
  $('#tab-memoire').innerHTML = `<form class="mem-add" id="memForm"><input class="input" name="k" placeholder="Clé (ex. entreprise)" required><input class="input" name="v" placeholder="Valeur" required><button class="btn btn-ghost">Ajouter à la mémoire</button></form>` +
    (mem.length ? mem.map(([k, v]) => `<div class="mem-item"><div class="k"><span>${esc(k)}</span><button class="link-btn" data-del="${esc(k)}">Oublier</button></div><div class="v">${esc(v)}</div></div>`).join('')
      : `<p class="panel-empty">L'agent mémorisera ici les informations utiles sur vous, partagées entre toutes les conversations.</p>`);
  $('#memForm').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); memSet(f.get('k').trim(), f.get('v').trim()); };
  $('#tab-memoire').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { delete state.memory[b.dataset.del]; persist(); renderPanel(); });
  // Fichiers
  const files = state.files;
  $('#tab-fichiers').innerHTML = files.length ? files.map(f => `<div class="file-item"><div class="k"><span>${esc(f.name)}</span></div>
      <div class="meta">${(f.content.length / 1024).toFixed(1)} Ko · ${new Date(f.created).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</div>
      <div class="row-btns"><button class="link-btn" data-dl="${f.id}">Télécharger</button><button class="link-btn" data-view="${f.id}">Aperçu</button><button class="link-btn" data-cp="${f.id}">Copier</button><button class="link-btn" data-rm="${f.id}">Supprimer</button></div></div>`).join('')
    : `<p class="panel-empty">Les rapports, tableaux et scripts créés par l'agent seront téléchargeables ici.</p>`;
  const byId = (id) => state.files.find(f => f.id === id);
  $('#tab-fichiers').querySelectorAll('[data-dl]').forEach(b => b.onclick = () => download(byId(b.dataset.dl)));
  $('#tab-fichiers').querySelectorAll('[data-cp]').forEach(b => b.onclick = () => copy(byId(b.dataset.cp).content));
  $('#tab-fichiers').querySelectorAll('[data-view]').forEach(b => b.onclick = () => preview(byId(b.dataset.view)));
  $('#tab-fichiers').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { state.files = state.files.filter(f => f.id !== b.dataset.rm); persist(); renderPanel(); });
  // badge compteur
  $('[data-tab="fichiers"]').textContent = files.length ? `Fichiers (${files.length})` : 'Fichiers';
}
const MIME = { md: 'text/markdown', csv: 'text/csv', html: 'text/html', json: 'application/json', js: 'text/javascript', txt: 'text/plain', py: 'text/x-python', svg: 'image/svg+xml' };
function download(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  const blob = new Blob([f.content], { type: (MIME[ext] || 'text/plain') + ';charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function preview(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  const body = ext === 'md' ? f.content : '```' + ext + '\n' + f.content + '\n```';
  $('#messages .empty')?.remove();
  const blk = document.createElement('div'); blk.className = 'msg msg-ai';
  blk.innerHTML = `<div class="who">Aperçu · ${esc(f.name)}</div><div class="content">${md(body)}</div>`;
  enhance(blk); $('#messages').appendChild(blk); scrollDown(); closePanelMobile();
}

document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  ['plan', 'memoire', 'fichiers'].forEach(n => $('#tab-' + n).classList.toggle('hidden', n !== t.dataset.tab));
});
function showTab(name) { document.querySelector(`.tab[data-tab="${name}"]`).click(); }

$('#togglePanel').onclick = () => $('#app').classList.toggle('panel-closed');
$('#toggleSidebar').onclick = () => $('#app').classList.toggle('sidebar-open');
function closeMobile() { $('#app').classList.remove('sidebar-open'); }
function closePanelMobile() { if (innerWidth <= 1100) $('#app').classList.add('panel-closed'); }
$('#messages').addEventListener('click', closeMobile);

// ---------- Modes ----------
document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll('.mode').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', x === b); });
  $('#sendBtn').textContent = state.mode === 'autonome' ? 'Lancer' : 'Envoyer';
  $('#input').placeholder = state.mode === 'autonome' ? "Décrivez un objectif… l'agent s'occupe du reste." : 'Posez votre question…';
});

// ---------- Statut ----------
function setStatus(text, kind = '') { $('#statusText').textContent = text; $('#status').className = 'status ' + kind; }

// ---------- Confirmation ----------
function confirmDialog(title, detail) {
  return new Promise(res => {
    const d = $('#confirmModal'); $('#confirmTitle').textContent = title; $('#confirmDetail').textContent = detail;
    d.returnValue = ''; d.showModal();
    d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
  });
}

// ---------- Envoi ----------
const input = $('#input');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });

$('#composer').onsubmit = async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || state.running) return;
  const s = state.settings;
  if (!s.baseUrl || !s.model || (!s.apiKey && s.provider !== 'ollama' && s.provider !== 'custom')) { openSettings(); toast('Configurez d\'abord votre fournisseur d\'IA'); return; }
  const c = current() || newConv();
  if (!c.messages.length) c.title = text.length > 48 ? text.slice(0, 46) + '…' : text;
  c.messages.push({ role: 'user', content: text, ts: Date.now() });
  c.updated = Date.now();
  input.value = ''; autosize();
  persist(); renderAll();
  if (state.mode === 'autonome' && innerWidth > 1100) { $('#app').classList.remove('panel-closed'); showTab('plan'); }

  const ac = new AbortController(); state.running = ac;
  $('#sendBtn').classList.add('hidden'); $('#stopBtn').classList.remove('hidden');
  setStatus('Démarrage…', 'busy');
  let lastFinal = '';
  try {
    await runAgent({
      conv: c, settings: s, mode: state.mode, signal: ac.signal,
      memory: () => state.memory,
      ctx: { setPlan, memSet, memAll: () => state.memory, addFile, settings: () => state.settings },
      hooks: {
        onStreamStart: streamStart, onDelta: streamDelta,
        onUpdate: (o) => { liveEl = null; c.updated = Date.now(); persist(); renderMessages(o || {}); },
        confirm: confirmDialog,
        setStatus: (t) => setStatus(t, 'busy'),
      },
    });
    setStatus('Terminé');
    const last = [...c.messages].reverse().find(m => (m.role === 'tool' && m.name === 'terminer') || (m.role === 'assistant' && m.content && !m.tool_calls));
    lastFinal = last?.content || '';
    if (s.tts && lastFinal) speak(lastFinal);
  } catch (err) {
    if (err.name === 'AbortError') { c.messages.push({ role: 'note', content: 'Mission arrêtée par l\'utilisateur.' }); setStatus('Arrêté'); }
    else { c.messages.push({ role: 'error', content: err.message || String(err) }); setStatus('Erreur', 'error'); }
    // retire un éventuel appel d'outil orphelin (sans résultat) pour garder l'historique valide
    sanitize(c);
  } finally {
    state.running = null; liveEl = null;
    $('#sendBtn').classList.remove('hidden'); $('#stopBtn').classList.add('hidden');
    persist(); renderAll();
  }
};
$('#stopBtn').onclick = () => state.running?.abort();

function sanitize(c) {
  const ids = new Set(c.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id));
  for (const m of c.messages) if (m.role === 'assistant' && m.tool_calls) {
    m.tool_calls = m.tool_calls.filter(t => ids.has(t.id));
    if (!m.tool_calls.length) delete m.tool_calls;
  }
}

// ---------- Voix ----------
function speak(text) {
  if (!('speechSynthesis' in window)) return toast('Synthèse vocale non disponible');
  speechSynthesis.cancel();
  const plain = text.replace(/```[\s\S]*?```/g, ' (bloc de code) ').replace(/[#*_`>|-]/g, ' ').slice(0, 4000);
  const u = new SpeechSynthesisUtterance(plain); u.lang = 'fr-FR';
  const v = speechSynthesis.getVoices().find(v => v.lang.startsWith('fr')); if (v) u.voice = v;
  speechSynthesis.speak(u);
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
$('#micBtn').onclick = () => {
  if (!SR) return toast('Dictée vocale non prise en charge par ce navigateur');
  if (rec) { rec.stop(); return; }
  rec = new SR(); rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
  const base = input.value;
  rec.onresult = (e) => { input.value = (base ? base + ' ' : '') + [...e.results].map(r => r[0].transcript).join(''); autosize(); };
  rec.onend = () => { rec = null; $('#micBtn').classList.remove('recording'); };
  rec.onerror = (e) => toast('Micro : ' + e.error);
  rec.start(); $('#micBtn').classList.add('recording');
};

// ---------- Paramètres ----------
const sel = $('#sProvider');
sel.innerHTML = Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('#toolsGrid').innerHTML = Object.entries(TOOL_GROUPS).map(([k, l]) => `<label class="check"><input type="checkbox" data-tool="${k}"> ${l}</label>`).join('');
sel.onchange = () => { const p = PROVIDERS[sel.value]; if (p.baseUrl || sel.value === 'custom') { $('#sBaseUrl').value = p.baseUrl; $('#sModel').value = p.model; } };
$('#sTemp').oninput = () => ($('#sTempOut').textContent = $('#sTemp').value);

function openSettings() {
  const s = state.settings;
  sel.value = s.provider; $('#sBaseUrl').value = s.baseUrl; $('#sApiKey').value = s.apiKey; $('#sModel').value = s.model;
  $('#sTemp').value = s.temperature; $('#sTempOut').textContent = s.temperature; $('#sMaxSteps').value = s.maxSteps;
  $('#sApproval').checked = s.approval; $('#sTts').checked = s.tts; $('#sSystem').value = s.system;
  document.querySelectorAll('[data-tool]').forEach(c => (c.checked = s.tools[c.dataset.tool] !== false));
  $('#sEngine').value = s.searchEngine; $('#sTavilyKey').value = s.tavilyKey; $('#sSerperKey').value = s.serperKey;
  $('#sSearchLang').value = s.searchLang; $('#sSearchCountry').value = s.searchCountry; $('#sDepth').value = s.searchDepth;
  $('#testResult').textContent = ''; $('#testSearchResult').textContent = '';
  $('#settingsModal').showModal();
}
function readForm() {
  const tools = {}; document.querySelectorAll('[data-tool]').forEach(c => (tools[c.dataset.tool] = c.checked));
  return { ...state.settings, provider: sel.value, baseUrl: $('#sBaseUrl').value.trim(), apiKey: $('#sApiKey').value.trim(), model: $('#sModel').value.trim(),
    temperature: Number($('#sTemp').value), maxSteps: Math.min(50, Math.max(1, Number($('#sMaxSteps').value) || 15)),
    approval: $('#sApproval').checked, tts: $('#sTts').checked, system: $('#sSystem').value, tools,
    searchEngine: $('#sEngine').value, tavilyKey: $('#sTavilyKey').value.trim(), serperKey: $('#sSerperKey').value.trim(),
    searchLang: $('#sSearchLang').value.trim() || 'fr', searchCountry: $('#sSearchCountry').value.trim().toLowerCase(), searchDepth: $('#sDepth').value };
}
$('#openSettings').onclick = () => { closeMobile(); openSettings(); };
$('#settingsModal').addEventListener('close', () => {
  if ($('#settingsModal').returnValue !== 'save') return;
  state.settings = readForm(); save('settings', state.settings); renderAll(); toast('Paramètres enregistrés');
});
$('#testConn').onclick = async () => {
  const s = readForm(); const out = $('#testResult');
  out.style.color = 'var(--muted)'; out.textContent = 'Test en cours…';
  try {
    let txt = '';
    await llmChat({ settings: s, messages: [{ role: 'user', content: 'Réponds uniquement : OK' }], onDelta: t => (txt += t), signal: AbortSignal.timeout(30000) });
    out.style.color = 'var(--ok)'; out.textContent = 'Connexion réussie · ' + (txt.trim().slice(0, 30) || 'OK');
  } catch (e) { out.style.color = 'var(--err)'; out.textContent = e.message.slice(0, 200); }
};
$('#testSearch').onclick = async () => {
  const s = readForm(); const out = $('#testSearchResult');
  out.style.color = 'var(--muted)'; out.textContent = 'Recherche en cours…';
  try {
    const r = await newsSearch({ requete: 'Guinée', periode: 'semaine', nombre: 3 }, s);
    out.style.color = 'var(--ok)'; out.textContent = `Recherche OK · ${r.sources.length} article(s) · ${r.sources[0]?.title?.slice(0, 50) || ''}`;
  } catch (e) { out.style.color = 'var(--err)'; out.textContent = e.message.slice(0, 220); }
};
$('#exportData').onclick = () => {
  const data = { version: 1, exported: new Date().toISOString(), convs: state.convs, memory: state.memory, files: state.files, settings: { ...state.settings, apiKey: '', tavilyKey: '', serperKey: '' } };
  download({ name: `nimba-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, content: JSON.stringify(data, null, 2) });
};
$('#importData').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const ids = new Set(state.convs.map(c => c.id));
    state.convs = [...(d.convs || []).filter(c => !ids.has(c.id)), ...state.convs];
    state.memory = { ...state.memory, ...(d.memory || {}) };
    state.files = [...(d.files || []), ...state.files];
    persist(); renderAll(); toast('Import réussi');
  } catch { toast('Fichier invalide'); }
  e.target.value = '';
};
$('#wipeData').onclick = async () => {
  if (!(await confirmDialog('Tout effacer ?', 'Conversations, mémoire, fichiers et paramètres (y compris la clé API) seront supprimés de ce navigateur.'))) return;
  wipe(); state.convs = []; state.memory = {}; state.files = []; state.settings = { ...DEFAULT_SETTINGS }; state.currentId = null;
  $('#settingsModal').close(); renderAll(); toast('Données effacées');
};

// ---------- Rendu global ----------
function renderAll() {
  const c = current();
  $('#chatTitle').textContent = c?.title || 'Nouvelle mission';
  const s = state.settings;
  $('#modelChip').textContent = s.model ? `${PROVIDERS[s.provider]?.label.split(' ')[0] || ''} · ${s.model}` : 'Aucun modèle';
  renderList(); renderMessages(); renderPanel();
}

applyTheme();
if (!state.convs.length) newConv(); else state.currentId = state.convs[0].id;
renderAll();
if (innerWidth <= 1100) $('#app').classList.add('panel-closed');
if (!persistent) setTimeout(() => toast('Stockage local indisponible : les données seront perdues à la fermeture'), 800);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
