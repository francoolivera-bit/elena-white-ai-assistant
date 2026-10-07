# Despliegue: Render Static Site + Cloudflare Worker

## Parte A — Subir a GitHub

1. Descomprime este proyecto.
2. Crea un repositorio vacío en GitHub.
3. Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Elena White Render + Cloudflare"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

Nunca agregues una API key al repositorio.

---

## Parte B — Desplegar el Worker seguro en Cloudflare

### Opción recomendada: desde tu PC con Wrangler

Necesitas Node.js instalado.

```bash
cd worker
npm install
npx wrangler login
```

Guarda la API key como Secret (no se escribe en el repositorio):

```bash
npx wrangler secret put GEMINI_API_KEY
```

Wrangler pedirá el valor. Pega tu API key de Gemini y confirma.

Despliega:

```bash
npm run deploy
```

Al terminar recibirás una URL parecida a:

```text
https://elena-white-ai-api.TU-SUBDOMINIO.workers.dev
```

Comprueba:

```text
https://elena-white-ai-api.TU-SUBDOMINIO.workers.dev/api/health
```

Debe responder algo parecido a:

```json
{"ok":true,"model":"gemini-3.8-flash"}
```

---

## Parte C — Conectar el frontend con el Worker

Edita:

```text
frontend/config.js
```

Cambia:

```javascript
WORKER_API_BASE: "https://TU-WORKER.TU-SUBDOMINIO.workers.dev"
```

por la URL real de tu Worker.

Luego:

```bash
git add frontend/config.js
git commit -m "Configurar URL del Worker"
git push
```

---

## Parte D — Publicar frontend en Render

Crea un **Static Site** en Render y conecta el mismo repositorio.

Si Render detecta `render.yaml`, puede crear el Static Site desde el Blueprint. Si lo configuras manualmente usa:

```text
Build Command: echo "No build step required"
Publish Directory: frontend
```

No agregues `GEMINI_API_KEY` en Render. Render solo aloja archivos públicos.

Cuando termine tendrás una URL parecida a:

```text
https://elena-white-ai-assistant.onrender.com
```

---

## Parte E — Restringir CORS a tu sitio Render (recomendado)

Cuando ya conozcas la URL definitiva de Render, edita:

```text
worker/wrangler.jsonc
```

Cambia:

```json
"ALLOWED_ORIGINS": "*"
```

por:

```json
"ALLOWED_ORIGINS": "https://TU-SITIO.onrender.com"
```

Luego despliega nuevamente:

```bash
cd worker
npm run deploy
```

Para permitir Render y pruebas locales puedes usar una lista separada por comas:

```json
"ALLOWED_ORIGINS": "https://TU-SITIO.onrender.com,http://localhost:5500,http://127.0.0.1:5500"
```

CORS ayuda a impedir llamadas casuales desde otros sitios web, pero no reemplaza autenticación ni límites de cuota.

---

## Cambiar modelo Gemini

Edita `worker/wrangler.jsonc`:

```json
"GEMINI_MODEL": "gemini-3.8-flash"
```

por otro ID de modelo compatible, y ejecuta:

```bash
cd worker
npm run deploy
```

La API key no necesita cambiar.

---

## Si aparece HTTP 429

Un `429` indica límites/cuota/capacidad de Gemini. El Worker realiza como máximo un reintento corto para fallos transitorios. Si la cuota diaria del proyecto está agotada, reintentar no resolverá el problema: revisa la cuota del proyecto/modelo en Google AI Studio.

---

## Qué es público y qué es secreto

Público:
- HTML/CSS/JS del frontend
- URL `workers.dev`
- nombre del modelo si consultas `/api/health`

Secreto:
- `GEMINI_API_KEY`

La API key solo existe como Secret de Cloudflare y se envía desde el Worker a Google Gemini.
