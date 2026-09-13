# Publicar en Render sin exponer la API key

Este proyecto está preparado para desplegarse como **Render Blueprint** usando `render.yaml`.

## Antes de subir a GitHub

1. No escribas tu API key en ningún archivo del repositorio.
2. Si usaste el proyecto localmente, confirma que `.env` no se vaya a subir:

```bash
git status
```

`.env` debe estar ignorado por Git.

## Subir a GitHub

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Preparar despliegue seguro en Render"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

> Si el repositorio ya existe localmente, omite `git init` y adapta el comando `git remote` según corresponda.

## Crear el servicio en Render con Blueprint

1. Entra a Render y conecta tu cuenta de GitHub.
2. Elige **New > Blueprint**.
3. Selecciona el repositorio que contiene este proyecto.
4. Render detectará automáticamente `render.yaml`.
5. Durante la creación te pedirá el valor de `GEMINI_API_KEY` porque en el Blueprint está declarada con `sync: false`.
6. Pega allí tu API key de Gemini. **No la agregues a GitHub ni a `render.yaml`.**
7. Confirma la creación del Blueprint.
8. Render instalará dependencias con `npm install --omit=dev` y arrancará la aplicación con `npm start`.
9. Cuando `/api/health` responda correctamente, Render publicará el servicio.

La dirección final tendrá un formato similar a:

```text
https://elena-white-ai-assistant.onrender.com
```

El nombre exacto puede variar si ese subdominio ya está ocupado.

## Qué queda público y qué queda secreto

El navegador puede ver:

- `public/index.html`
- las llamadas a `/api/chat`
- las respuestas que devuelve tu backend

El navegador NO recibe:

- `GEMINI_API_KEY`
- el encabezado `x-goog-api-key` enviado por el servidor a Gemini
- el contenido de un archivo `.env`

La ruta es:

```text
Navegador -> POST /api/chat -> Render/Node.js -> Gemini API
                                      |
                                      +-> GEMINI_API_KEY (secreto de Render)
```

## Cambiar la clave en el futuro

Hazlo desde las variables de entorno del servicio en Render y vuelve a desplegar si Render lo solicita. No necesitas modificar el código ni hacer un commit con la clave.

## Comprobación de seguridad después de publicar

Abre las herramientas de desarrollador del navegador (F12) y revisa **Network** al realizar una consulta.

Debe aparecer una solicitud a:

```text
/api/chat
```

No debe aparecer tu clave ni una llamada directa del navegador a:

```text
generativelanguage.googleapis.com
```

También puedes abrir:

```text
https://TU_DOMINIO.onrender.com/api/health
```

La respuesta debe ser únicamente:

```json
{"ok":true}
```

## Nota sobre el plan gratuito

El archivo `render.yaml` solicita `plan: free`. Las limitaciones y disponibilidad del plan gratuito dependen de Render y pueden cambiar. Para un proyecto personal o de prueba suele ser suficiente; revisa el panel de Render si la aplicación empieza a recibir uso intensivo.
