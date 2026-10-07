# Elena G. de White — Asistente con Gemini (Render + Cloudflare)

El frontend es un sitio estático en **Render**. Las consultas pasan por un **Cloudflare Worker**, que es el único lugar donde está `GEMINI_API_KEY`. El navegador nunca ve la clave.

```text
Render Static Site  (frontend/)
       │  POST /api/chat
       ▼
Cloudflare Worker   (worker/)
       │
       ├── GEMINI_API_KEY 🔐  (Secret de Cloudflare)
       │
       ▼
Google Gemini
```

## Estructura

```text
├── frontend/
│   ├── index.html        # Interfaz del chat
│   └── config.js         # URL pública del Worker (sin secretos)
│
├── worker/
│   ├── src/
│   │   └── index.js      # /api/health y /api/chat → Gemini
│   ├── wrangler.jsonc    # Nombre, modelo y CORS (ALLOWED_ORIGINS)
│   ├── package.json
│   ├── .dev.vars.example # Plantilla de la clave para desarrollo local
│   └── .gitignore
│
├── render.yaml           # Blueprint del Static Site
├── .gitignore
├── README.md
└── DEPLOY.md             # Despliegue paso a paso
```

## Despliegue

Consulta **[DEPLOY.md](DEPLOY.md)**. Resumen:

1. `cd worker && npm install && npx wrangler login`
2. `npx wrangler secret put GEMINI_API_KEY`
3. `npm run deploy` → anota la URL `*.workers.dev`
4. Pon esa URL en `frontend/config.js` (`WORKER_API_BASE`) y haz push.
5. Crea el Static Site en Render (Blueprint `render.yaml`, o *Publish Directory* `frontend`).
6. Restringe `ALLOWED_ORIGINS` en `worker/wrangler.jsonc` a tu URL de Render y vuelve a desplegar.

## Desarrollo local

Worker (puerto 8787):

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # coloca tu clave real; .dev.vars está ignorado por Git
npm run dev
```

Frontend (puerto 5500): cambia temporalmente `frontend/config.js` a `http://localhost:8787` y sirve la carpeta:

```bash
cd frontend
python3 -m http.server 5500
```

Abre `http://localhost:5500`. No hagas commit de la URL local en `config.js`.

## API del Worker

| Método | Ruta          | Respuesta |
|--------|---------------|-----------|
| GET    | `/api/health` | `{"ok":true,"model":"gemini-3.8-flash"}` |
| POST   | `/api/chat`   | Body `{"prompt":"...","history":[...]}` → `{"text":"...","sources":[{"uri","title"}]}` |

## Seguridad

- La API key solo existe como Secret de Cloudflare; no está en el repositorio, en Render ni en el navegador.
- CORS configurable con `ALLOWED_ORIGINS` (lista separada por comas). Los orígenes no permitidos reciben `403`.
- Validación de entrada: cuerpo máximo 32 KB, consulta máxima 6000 caracteres, historial limitado a 20 mensajes.
- Como máximo un reintento corto ante `429`/`5xx` de Gemini.
- Errores enviados al navegador sin detalles internos; Markdown sanitizado con DOMPurify y fuentes limitadas a HTTP/HTTPS.

CORS frena llamadas casuales desde otros sitios, pero **no** sustituye la autenticación: cualquiera puede llamar al Worker con `curl`. Si el sitio se vuelve público y popular, considera añadir [Rate Limiting de Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) o Turnstile, y revisa la cuota en Google AI Studio.
