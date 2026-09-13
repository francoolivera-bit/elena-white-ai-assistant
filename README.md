# Elena G. de White — Asistente seguro con Gemini

Esta versión elimina la API key del navegador. La página llama únicamente a `POST /api/chat`; el servidor Node.js es quien agrega `GEMINI_API_KEY` al comunicarse con Google Gemini.

## Estructura

```text
elena_white_secure/
├─ public/
│  └─ index.html
├─ server.js
├─ package.json
├─ .env.example
├─ .gitignore
├─ iniciar.bat
├─ iniciar.sh
├─ render.yaml
├─ DEPLOY_RENDER.md
└─ README.md
```

## 1. Requisitos

- Node.js 18 o superior.
- Una API key válida de Gemini.

## 2. Instalar dependencias

Abre una terminal dentro de la carpeta del proyecto:

```bash
npm install
```

## 3. Configurar la API key UNA SOLA VEZ

Copia `.env.example` como `.env`.

### Windows PowerShell

```powershell
Copy-Item .env.example .env
notepad .env
```

### Linux / macOS / WSL

```bash
cp .env.example .env
nano .env
```

En `.env`, reemplaza:

```env
GEMINI_API_KEY=PEGA_AQUI_TU_API_KEY
```

por tu clave real.

**No pongas la clave en `public/index.html`, JavaScript del navegador ni `localStorage`.**

## 4. Ejecutar

```bash
npm start
```

Luego abre:

```text
http://localhost:3000
```

> Importante: ya no debes abrir `public/index.html` con doble clic (`file://`). La versión segura necesita ejecutarse a través de `server.js`, porque la API key vive exclusivamente en el servidor.

En Windows también puedes usar `iniciar.bat`; la primera vez instala dependencias y, si falta `.env`, crea una copia de `.env.example`.

A partir de ese momento la página funciona sin pedir la clave. El navegador nunca recibe `GEMINI_API_KEY`.

## 5. Verificar que está protegida

En el navegador abre F12 → Network → consulta `/api/chat`.

Debes ver una solicitud a:

```text
/api/chat
```

No debes ver:

- `generativelanguage.googleapis.com` llamado directamente desde el navegador.
- `?key=...` en ninguna URL.
- `GEMINI_API_KEY` en JavaScript.
- `egw_gemini_key` en Local Storage.

También puedes comprobar el backend en:

```text
http://localhost:3000/api/health
```

Devuelve únicamente `{"ok":true}` y nunca expone información sobre la clave.

## 6. GitHub

`.gitignore` ya excluye `.env`.

Antes de hacer commit:

```bash
git status
```

Asegúrate de que `.env` NO aparezca.

Puedes subir `.env.example`, porque contiene solamente un marcador de posición.

## 7. Publicar en Render

Este paquete ya incluye `render.yaml` con un Web Service Node.js configurado para el plan gratuito, health check y `GEMINI_API_KEY` declarada como secreto mediante `sync: false`.

Consulta **`DEPLOY_RENDER.md`** para el procedimiento GitHub → Render paso a paso.

Si el sitio será público, considera agregar autenticación de usuarios además del rate limiting incluido. Ocultar la clave evita que la roben, pero una URL pública sin login todavía podría ser usada por terceros y consumir tu cuota.

## Cambios de seguridad incluidos

- API key eliminada de `localStorage` y del HTML/JS público.
- Llamadas de Gemini movidas al backend.
- Autenticación con `x-goog-api-key` desde el servidor.
- `.env` excluido de Git.
- Validación y límite de tamaño de entradas.
- Rate limiting para `/api/*`.
- Cabeceras de seguridad con Helmet.
- Sanitización del Markdown generado con DOMPurify.
- URLs de fuentes limitadas a HTTP/HTTPS.
- Errores enviados al navegador sin revelar detalles sensibles.
