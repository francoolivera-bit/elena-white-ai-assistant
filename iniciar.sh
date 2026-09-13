#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Instalando dependencias..."
  npm install
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Se creó .env. Edita GEMINI_API_KEY una sola vez y vuelve a ejecutar ./iniciar.sh"
  exit 0
fi

npm start
