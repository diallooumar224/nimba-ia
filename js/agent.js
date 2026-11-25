// Boucle de l'agent autonome : réflexion → action (outil) → observation → … → terminer
import { chat } from './llm.js';
import { TOOLS, activeTools } from './tools.js';

export function systemPrompt({ mode, memory, custom }) {
  const now = new Date().toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const mem = Object.entries(memory || {});
  let s = `Tu es Nimba IA, un agent IA autonome, fiable et efficace. Tu réponds dans la langue de l'utilisateur (français par défaut).
Date actuelle : ${now}.

Tu disposes d'outils. Utilise-les dès qu'ils améliorent la qualité ou l'exactitude de la réponse (calculs exacts, informations factuelles, analyse de données, création de livrables). N'invente jamais de faits : vérifie avec les outils, et cite les liens trouvés.`;
  if (mode === 'autonome') {
    s += `

MODE AUTONOME — tu travailles seul jusqu'à atteindre l'objectif :
1. Commence par appeler mettre_a_jour_plan pour décomposer l'objectif en 3 à 7 étapes concrètes.
2. Exécute les étapes une par une avec les outils. Mets à jour le plan (statut en_cours / termine) au fil de l'eau.
3. Si une étape échoue, adapte le plan et essaie une autre approche plutôt que d'abandonner.
4. Pour un livrable conséquent (rapport, plan, tableau, code), crée-le avec creer_fichier.
5. Mémorise avec memoire_enregistrer les informations durables sur l'utilisateur.
6. Termine OBLIGATOIREMENT en appelant terminer avec un résumé clair en Markdown des résultats.
Ne pose de question à l'utilisateur que si l'objectif est réellement impossible à interpréter.`;
  } else {
    s += `

MODE ASSISTANT — réponds de façon conversationnelle et concise, en utilisant les outils si utile. Formate en Markdown.`;
  }
  if (mem.length) s += `\n\nMémoire à long terme sur l'utilisateur :\n` + mem.map(([k, v]) => `- ${k} : ${v}`).join('\n');
  if (custom?.trim()) s += `\n\nInstructions personnalisées de l'utilisateur :\n${custom.trim()}`;
  return s;
}

const API_ROLES = new Set(['user', 'assistant', 'tool']);
export function toApi(messages) {
  return messages.filter(m => API_ROLES.has(m.role)).map(m => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: String(m.content) };
    if (m.role === 'assistant') {
      const o = { role: 'assistant', content: m.content || '' };
      if (m.tool_calls?.length) { o.tool_calls = m.tool_calls; if (!m.content) o.content = null; }
      return o;
    }
    return { role: 'user', content: m.content };
  });
}

/**
 * hooks : { onUpdate(), onDelta(text), onStreamStart(), confirm(title, detail) => Promise<bool>, setStatus(text) }
 * ctx (outils) : { setPlan, memSet, memAll, addFile }
 */
export async function runAgent({ conv, settings, memory, mode, hooks, ctx, signal }) {
  const maxSteps = mode === 'autonome' ? Math.max(1, Number(settings.maxSteps) || 15) : 8;
  const tools = activeTools(settings.tools || {}, mode);

  for (let step = 1; step <= maxSteps; step++) {
    if (signal.aborted) throw new DOMException('Arrêt', 'AbortError');
    hooks.setStatus(mode === 'autonome' ? `Réflexion · étape ${step}/${maxSteps}` : 'Réflexion…');
    const messages = [{ role: 'system', content: systemPrompt({ mode, memory: memory(), custom: settings.system }) }, ...toApi(conv.messages)];
    hooks.onStreamStart();
    const res = await chat({ settings, messages, tools, signal, onDelta: hooks.onDelta });
    const msg = { role: 'assistant', content: res.content || '', ts: Date.now() };
    if (res.tool_calls.length) msg.tool_calls = res.tool_calls;
    conv.messages.push(msg);
    hooks.onUpdate();

    if (!res.tool_calls.length) return { done: true };

    let finished = false;
    for (const call of res.tool_calls) {
      if (signal.aborted) throw new DOMException('Arrêt', 'AbortError');
      const name = call.function.name;
      const tool = TOOLS[name];
      let args = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = { _brut: call.function.arguments }; }
      const result = { role: 'tool', tool_call_id: call.id, name, status: 'ok', content: '' };
      hooks.setStatus(`Action · ${name}`);
      hooks.onUpdate({ running: call.id });

      if (!tool) { result.status = 'err'; result.content = `Outil inconnu : ${name}`; }
      else if (tool.sensitive && settings.approval && !(await hooks.confirm(`Autoriser « ${name} » ?`, JSON.stringify(args, null, 2)))) {
        result.status = 'denied'; result.content = "L'utilisateur a refusé cette action. Trouve une autre approche.";
      } else {
        try { result.content = String(await tool.run(args, ctx)); }
        catch (e) { result.status = 'err'; result.content = 'Erreur : ' + (e.message || e); }
      }
      conv.messages.push(result);
      hooks.onUpdate();
      if (name === 'terminer' && result.status === 'ok') finished = true;
    }
    if (finished) return { done: true };
  }
  conv.messages.push({ role: 'note', content: `Limite de ${maxSteps} étapes atteinte. Envoyez « continue » pour poursuivre la mission.` });
  hooks.onUpdate();
  return { done: false };
}
