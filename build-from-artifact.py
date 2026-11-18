# Genera public/index.html dalla versione artifact: aggiunge login, adattatore dati e calendario via server.
# Uso: python3 build-from-artifact.py <artifact.html> public/index.html shim.html
import sys
src, out, shim_path = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src).read()

def R(x, y):
    global s
    assert s.count(x) >= 1, x
    s = s.replace(x, y)

# testi pensati per claude.ai
R("Apri l'app da claude.ai con il tuo account per vedere e modificare i dati.", "Ricarica la pagina e inserisci la password.")
R("Apri l\\'app da claude.ai con il tuo account.", "Ricarica la pagina e inserisci la password.")
R("Il calendario si vede quando apri l\\'app dentro claude.ai con Google Calendar collegato.", "Calendario non disponibile in questo momento.")
R("const calErrMsg=code=>({",
  "const calErrMsg=code=>({\n  not_configured:['warn','<b>Il calendario non è ancora collegato.</b> Manca l\\'indirizzo iCal segreto nelle impostazioni di Netlify (GCAL_ICS_URL).'],\n  unavailable:['info','Google Calendar non risponde in questo momento. Riprovo da solo tra poco.'],")
R("Vedi tutto come titolare: clienti, tariffe e documenti riservati sono visibili solo a te e al tuo socio.",
  "Sei entrato con la password dei titolari: clienti, tariffe e documenti riservati li vedete solo voi.")

shim = open(shim_path).read()
i = s.index("<script>")
s = s[:i] + shim + "\n" + s[i:]
head_end = s.index("</style>") + len("</style>")
doc = ('<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
       '<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#14110c">'
       '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-180.png"><link rel="icon" href="/icon-192.png">'
       '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Fenice Film"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
       '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
       + s[:head_end] + "</head><body>" + s[head_end:] + "</body></html>")
open(out, "w").write(doc)
print("ok", len(doc))
