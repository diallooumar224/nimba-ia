// Client LLM compatible OpenAI (Chat Completions) avec streaming et appels d'outils

export const PROVIDERS = {
  openai:     { label: 'OpenAI',            baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { label: 'OpenRouter (Claude, Gemini, Llama…)', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  gemini:     { label: 'Google Gemini (gratuit)',     baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash-lite' },
  groq:       { label: 'Groq (gratuit)',              baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  mistral:    { label: 'Mistral AI',        baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  deepseek:   { label: 'DeepSeek',          baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  ollama:     { label: 'Ollama (local, gratuit)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  custom:     { label: 'Personnalisé',      baseUrl: '', model: '' },
};

/**
 * Appelle le modèle. Retourne { content, tool_calls }.
 * onDelta(texte) est appelé à chaque fragment de texte reçu.
 */
export async function chat({ settings, messages, tools, onDelta, signal }) {
  const url = settings.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;
  if (settings.provider === 'openrouter') { headers['HTTP-Referer'] = location.origin || 'https://nimba.app'; headers['X-Title'] = 'Nimba IA'; }

  const body = { model: settings.model, messages, temperature: Number(settings.temperature), stream: true };
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error("Impossible de joindre l'API (" + url + "). Vérifiez l'URL, votre connexion ou les restrictions CORS du fournisseur.");
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error?.message || j.message || JSON.stringify(j); } catch { detail = await res.text().catch(() => ''); }
    const hint = res.status === 401 ? ' — clé API invalide ou manquante.' : res.status === 404 ? ' — modèle ou URL introuvable.' : res.status === 429 ? ' — quota atteint ou trop de requêtes.' : '';
    throw new Error(`Erreur ${res.status}${hint} ${detail}`.trim());
  }

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('event-stream') || !res.body) {
    // Réponse non streamée
    const j = await res.json();
    const m = j.choices?.[0]?.message || {};
    if (m.content) onDelta?.(m.content);
    return { content: m.content || '', tool_calls: m.tool_calls || [] };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  const calls = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      const d = j.choices?.[0]?.delta;
      if (!d) continue;
      if (d.content) { content += d.content; onDelta?.(d.content); }
      if (d.tool_calls) for (const tc of d.tool_calls) {
        const i = tc.index ?? calls.length;
        calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].function.name += tc.function.name;
        if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
      }
    }
  }
  const tool_calls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || 'call_' + i + '_' + Date.now() }));
  return { content, tool_calls };
}
