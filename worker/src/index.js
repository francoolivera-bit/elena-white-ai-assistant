// Cloudflare Worker: proxy seguro entre el frontend (Render Static Site) y Google Gemini.
// GEMINI_API_KEY vive solo como Secret de Cloudflare; el navegador nunca la recibe.

const DEFAULT_MODEL = 'gemini-3.8-flash';
const MAX_BODY_BYTES = 32 * 1024;
const MAX_PROMPT_CHARS = 6000;
const MAX_HISTORY_ITEMS = 20;
const GEMINI_TIMEOUT_MS = 60000;
const RETRY_DELAY_MS = 1500;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const SYSTEM_INSTRUCTION = `Eres un asistente de Inteligencia Artificial altamente especializado en la literatura, biografía, teología y escritos de Elena G. de White (Ellen G. White).
Tu objetivo principal es responder a las consultas con máxima exactitud histórica y doctrinal, citando fuentes oficiales.

REGLAS DE RESPUESTA:
1. CITAS TEXTUALES Y EXACTITUD:
   - Cuando el usuario te pida buscar una frase, palabra u oración, proporciona la cita exacta siempre que esté disponible.
   - Indica siempre la fuente bibliográfica precisa: Nombre de la obra en español (ej. El Conflicto de los Siglos, El Deseado de todas las gentes, El Camino a Cristo, Joyas de los Testimonios, Consejos sobre el Régimen Alimenticio, Ministerio de Curación, Educación, etc.), seguido del número de página, capítulo o párrafo si corresponde.
   - Formatea las citas en bloques de cita resaltados con la sintaxis Markdown (> "Texto de la cita...").

2. VERIFICACIÓN DE FRASES Y APÓCRIFOS:
   - Si el usuario pregunta si una cita es auténtica, verifica si realmente pertenece a los escritos de Elena White o si es una cita atribuida erróneamente (apócrifa/falsa). Explica con claridad su origen.

3. FUENTES OFICIALES:
   - Fundamenta tus búsquedas prioritariamente en repositorios oficiales:
     * Ellen G. White Estate: https://whiteestate.org/
     * EGW Writings: https://m.egwwritings.org/
     * EllenWhite.org: https://ellenwhite.org/
   - Proporciona enlaces o referencias directas a estos repositorios cuando sea pertinente.
   - Si una cita textual no puede verificarse con suficiente confianza, dilo claramente y no inventes página, capítulo ni referencia.

4. TONO Y ESTILO:
   - Mantén un tono respetuoso, claro, educativo y académico.
   - Utiliza formato Markdown con títulos (##), viñetas y negritas para facilitar la lectura.`;

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  if (allowed.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function isOriginAllowed(request, env) {
  const allowed = allowedOrigins(env);
  if (allowed.includes('*')) return true;
  const origin = request.headers.get('Origin');
  // Sin cabecera Origin (curl, health checks) no es una llamada de navegador entre sitios.
  return !origin || allowed.includes(origin);
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors
    }
  });
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => {
      const role = item?.role === 'model' ? 'model' : item?.role === 'user' ? 'user' : null;
      const text = item?.parts?.[0]?.text;
      if (!role || typeof text !== 'string') return null;
      const cleanedText = text.trim().slice(0, MAX_PROMPT_CHARS);
      if (!cleanedText) return null;
      return { role, parts: [{ text: cleanedText }] };
    })
    .filter(Boolean);
}

function safeWebSource(source) {
  if (!source?.uri || typeof source.uri !== 'string') return null;
  try {
    const url = new URL(source.uri);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return {
      uri: url.href,
      title: typeof source.title === 'string' && source.title.trim()
        ? source.title.trim().slice(0, 200)
        : url.hostname
    };
  } catch {
    return null;
  }
}

// Gemini responde HTTP 400 (no 401/403) cuando la API key no es válida.
function isInvalidApiKey(data) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  return details.some((detail) => detail?.reason === 'API_KEY_INVALID')
    || /api key not valid/i.test(data?.error?.message || '');
}

function publicErrorFor(status, data) {
  if (isInvalidApiKey(data)) return 'Gemini rechazó la API key. Revisa el Secret GEMINI_API_KEY del Worker.';
  if (status === 400) return 'La solicitud a Gemini no fue aceptada. Revisa el modelo configurado o el contenido enviado.';
  if (status === 401 || status === 403) return 'Gemini rechazó la autenticación. Revisa GEMINI_API_KEY y sus permisos/restricciones.';
  if (status === 404) return 'El modelo de Gemini configurado no existe o no está disponible. Revisa GEMINI_MODEL.';
  if (status === 429) return 'Se alcanzó temporalmente el límite de uso de Gemini. Intenta nuevamente más tarde.';
  if (status >= 500) return 'Gemini está temporalmente no disponible. Intenta nuevamente más tarde.';
  return 'No se pudo completar la consulta a Gemini.';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGemini(env, contents, useSearchTool) {
  const model = (env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const payload = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }
  };
  if (useSearchTool) {
    payload.tools = [{ googleSearch: {} }];
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY.trim()
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Se procesa como respuesta inválida más abajo.
  }
  return { response, data };
}

// Como máximo un reintento corto para fallos transitorios (429/5xx).
async function callGeminiWithRetry(env, contents, useSearchTool) {
  let result = await callGemini(env, contents, useSearchTool);
  if (!result.response.ok && RETRYABLE_STATUS.has(result.response.status)) {
    await sleep(RETRY_DELAY_MS);
    result = await callGemini(env, contents, useSearchTool);
  }
  return result;
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) return { error: 'La solicitud es demasiado grande.', status: 413 };

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return { error: 'La solicitud es demasiado grande.', status: 413 };
  }
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { error: 'JSON inválido.', status: 400 };
  }
}

async function handleChat(request, env, cors) {
  if (!env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()) {
    console.error('Falta el Secret GEMINI_API_KEY.');
    return json({ error: 'El servidor no está configurado correctamente.' }, 500, cors);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json({ error: 'Content-Type debe ser application/json.' }, 415, cors);
  }

  const parsed = await readJsonBody(request);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, cors);

  const prompt = typeof parsed.body?.prompt === 'string' ? parsed.body.prompt.trim() : '';
  if (!prompt) {
    return json({ error: 'La consulta no puede estar vacía.' }, 400, cors);
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: `La consulta es demasiado larga (máximo ${MAX_PROMPT_CHARS} caracteres).` }, 400, cors);
  }

  const contents = [
    ...cleanHistory(parsed.body?.history),
    { role: 'user', parts: [{ text: prompt }] }
  ];

  try {
    let result = await callGeminiWithRetry(env, contents, true);

    // Si Google Search es rechazado por el modelo/configuración, se reintenta sin grounding.
    if (!result.response.ok && result.response.status === 400 && !isInvalidApiKey(result.data)) {
      console.warn('Gemini rechazó la solicitud con Google Search; reintentando sin grounding.');
      result = await callGeminiWithRetry(env, contents, false);
    }

    if (!result.response.ok) {
      const status = result.response.status;
      console.error('Gemini API error:', result.data?.error?.message || `HTTP ${status}`);
      return json({ error: publicErrorFor(status, result.data) }, status >= 400 && status < 600 ? status : 502, cors);
    }

    const candidate = result.data?.candidates?.[0];
    if (!candidate) {
      return json({ error: 'Gemini no devolvió una respuesta utilizable.' }, 502, cors);
    }

    const text = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .filter(Boolean)
          .join('\n\n')
          .trim()
      : '';
    if (!text) {
      return json({ error: 'Gemini devolvió una respuesta sin texto.' }, 502, cors);
    }

    const grounding = candidate.groundingMetadata || candidate.grounding_metadata || {};
    const rawChunks = grounding.groundingChunks || grounding.grounding_chunks || [];
    const sources = [];
    const seen = new Set();
    for (const chunk of rawChunks) {
      const source = safeWebSource(chunk?.web);
      if (source && !seen.has(source.uri)) {
        seen.add(source.uri);
        sources.push(source);
      }
    }

    return json({ text, sources: sources.slice(0, 8) }, 200, cors);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.error('Gemini timeout');
      return json({ error: 'Gemini tardó demasiado en responder.' }, 504, cors);
    }
    console.error('Internal error:', error?.message || error);
    return json({ error: 'Ocurrió un error interno al procesar la consulta.' }, 500, cors);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: isOriginAllowed(request, env) ? 204 : 403, headers: cors });
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, model: (env.GEMINI_MODEL || DEFAULT_MODEL).trim() }, 200, cors);
    }

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return json({ error: 'Método no permitido.' }, 405, { ...cors, Allow: 'POST, OPTIONS' });
      }
      if (!isOriginAllowed(request, env)) {
        return json({ error: 'Origen no permitido.' }, 403, cors);
      }
      return handleChat(request, env, cors);
    }

    return json({ error: 'No encontrado.' }, 404, cors);
  }
};
