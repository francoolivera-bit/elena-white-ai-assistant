@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 goto :error
)

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo Se creo .env. Abrelo y coloca tu GEMINI_API_KEY una sola vez.
  notepad .env
  echo.
  echo Guarda el archivo .env y vuelve a ejecutar iniciar.bat.
  pause
  exit /b 0
)

echo Iniciando Elena White AI Assistant...
call npm start
goto :eof

:error
echo.
echo No se pudieron instalar las dependencias. Verifica Node.js y tu conexion a Internet.
pause
exit /b 1
