"""Faux serveur compatible OpenAI pour tester Nimba IA sans clé API.
Usage : python3 dev/mock-server.py  puis URL de l'API = http://localhost:8787/v1 (fournisseur « Personnalisé »)."""
import json, time
from http.server import BaseHTTPRequestHandler, HTTPServer

def script(msgs):
    n_tool = sum(1 for m in msgs if m.get('role') == 'tool')
    last_user = [m for m in msgs if m.get('role') == 'user'][-1]['content']
    autonome = any('terminer' in json.dumps(m) for m in msgs[:1])
    plan = lambda s: {"etapes": [{"titre": "Analyser l'objectif", "statut": s[0]}, {"titre": "Calculer les chiffres clés", "statut": s[1]}, {"titre": "Rédiger le rapport", "statut": s[2]}]}
    steps = [
        ("Je commence par établir un plan.", "mettre_a_jour_plan", plan(["en_cours", "a_faire", "a_faire"])),
        ("", "calculer", {"expression": "150000000*0.14/12"}),
        ("", "executer_javascript", {"code": "const v=[12,45,33,27];console.log('Total', v.reduce((a,b)=>a+b));return v.length"}),
        ("", "mettre_a_jour_plan", plan(["termine", "termine", "en_cours"])),
        ("", "creer_fichier", {"nom": "rapport-test.md", "contenu": "# Rapport\n\n| Indicateur | Valeur |\n|---|---|\n| Intérêts mensuels | 1 750 000 GNF |\n"}),
        ("", "memoire_enregistrer", {"cle": "ville", "valeur": "Conakry"}),
        ("", "mettre_a_jour_plan", plan(["termine", "termine", "termine"])),
        ("", "terminer", {"resume": "## Mission accomplie\n\n- Intérêts mensuels : **1 750 000 GNF**\n- Rapport créé : `rapport-test.md`\n\n```js\nconsole.log('ok')\n```"}),
    ]
    if 'actu' in last_user.lower():
        news = [("Je cherche les dernières actualités.", "actualites", {"requete": "Guinée économie", "periode": "semaine", "nombre": 5}),
                ("", "recherche_web", {"requete": "Simandou production minerai de fer 2026", "nombre": 4}),
                ("", "terminer", {"resume": "## Revue de presse\n\nVoici les principales actualités trouvées (voir sources ci-dessous)."})]
        return news[n_tool] if n_tool < len(news) else ("Terminé.", None, None)
    if not autonome:
        return ("Bonjour ! Voici une réponse **en mode assistant** à : " + last_user, None, None)
    if n_tool < len(steps):
        return steps[n_tool]
    return ("Terminé.", None, None)

class H(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        text, tool, args = script(body['messages'])
        self.send_response(200); self.cors()
        self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        def send(d): self.wfile.write(b'data: ' + json.dumps(d).encode() + b'\n\n'); self.wfile.flush()
        for w in text.split(' ') if text else []:
            send({"choices": [{"delta": {"content": w + ' '}}]}); time.sleep(0.02)
        if tool:
            send({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": f"c{time.time_ns()}", "function": {"name": tool, "arguments": ""}}]}}]})
            a = json.dumps(args, ensure_ascii=False)
            for i in range(0, len(a), 20):
                send({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": a[i:i+20]}}]}}]})
        self.wfile.write(b'data: [DONE]\n\n')
    def log_message(self, *a): pass

HTTPServer(('0.0.0.0', 8787), H).serve_forever()
