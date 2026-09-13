'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-3.7-flash').trim();

if (!GEMINI_API_KEY) {
  console.error('ERROR: falta GEMINI_API_KEY. Crea el archivo .env a partir de .env.example.');
  process.exit(1);
}

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

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // La interfaz actual usa Tailwind/Marked/FontAwesome desde CDN.
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(express.json({ limit: '32kb', strict: true }));

const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas. Espera unos minutos antes de volver a intentar.' }
});
app.use('/api/', apiLimiter);

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-20)
    .map((item) => {
      const role = item?.role === 'model' ? 'model' : item?.role === 'user' ? 'user' : null;
      const text = item?.parts?.[0]?.text;
      if (!role || typeof text !== 'string') return null;
      const cleanedText = text.trim().slice(0, 6000);
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

async function callGemini(contents, useSearchTool) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }]
    }
  };

  if (useSearchTool) {
    payload.tools = [{ googleSearch: {} }];
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000)
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Se procesa abajo como una respuesta inválida.
  }

  return { response, data };
}

function publicErrorFor(status) {
  if (status === 400) return 'La solicitud a Gemini no fue aceptada. Revisa el modelo configurado o el contenido enviado.';
  if (status === 401 || status === 403) return 'Gemini rechazó la autenticación. Revisa GEMINI_API_KEY y sus permisos/restricciones.';
  if (status === 429) return 'Se alcanzó temporalmente el límite de uso de Gemini. Intenta nuevamente más tarde.';
  if (status >= 500) return 'Gemini está temporalmente no disponible. Intenta nuevamente más tarde.';
  return 'No se pudo completar la consulta a Gemini.';
}

app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ error: 'La consulta no puede estar vacía.' });
  }
  if (prompt.length > 6000) {
    return res.status(400).json({ error: 'La consulta es demasiado larga (máximo 6000 caracteres).' });
  }

  const history = cleanHistory(req.body?.history);
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: prompt }] }
  ];

  try {
    let result = await callGemini(contents, true);

    // Si el uso de Google Search es rechazado por configuración/modelo, se conserva
    // el comportamiento anterior y se reintenta sin grounding. No se reintentan
    // errores de autenticación, cuota o servidor para evitar duplicar solicitudes.
    if (!result.response.ok && result.response.status === 400) {
      console.warn('Gemini rechazó la solicitud con Google Search; reintentando sin grounding.');
      result = await callGemini(contents, false);
    }

    if (!result.response.ok) {
      const detail = result.data?.error?.message || `HTTP ${result.response.status}`;
      console.error('Gemini API error:', detail);
      return res.status(result.response.status >= 400 && result.response.status < 600 ? result.response.status : 502)
        .json({ error: publicErrorFor(result.response.status) });
    }

    const candidate = result.data?.candidates?.[0];
    if (!candidate) {
      return res.status(502).json({ error: 'Gemini no devolvió una respuesta utilizable.' });
    }

    const text = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
          .map((part) => typeof part?.text === 'string' ? part.text : '')
          .filter(Boolean)
          .join('\n\n')
          .trim()
      : '';

    if (!text) {
      return res.status(502).json({ error: 'Gemini devolvió una respuesta sin texto.' });
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

    return res.json({ text, sources: sources.slice(0, 8) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.error('Gemini timeout');
      return res.status(504).json({ error: 'Gemini tardó demasiado en responder.' });
    }
    console.error('Internal error:', error?.message || error);
    return res.status(500).json({ error: 'Ocurrió un error interno al procesar la consulta.' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'ignore',
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Elena White AI Assistant: http://localhost:${PORT}`);
  console.log(`Modelo Gemini: ${GEMINI_MODEL}`);
  console.log('API key cargada de forma segura en el servidor.');
});
