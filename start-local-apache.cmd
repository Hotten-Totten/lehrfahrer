@echo off
setlocal

set "PROJECT_NAME=lehrfahrer"
set "APP_URL=http://localhost/%PROJECT_NAME%/app/"
set "XAMPP_DIR=C:\xampp"
set "APACHE_START=%XAMPP_DIR%\apache_start.bat"
set "XAMPP_CTRL=%XAMPP_DIR%\xampp-control.exe"
set "HTDOCS_LINK=%XAMPP_DIR%\htdocs\%PROJECT_NAME%"
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo [Lehrfahrer] Starte lokale Umgebung...

if not exist "%APACHE_START%" (
  echo [Fehler] XAMPP nicht gefunden unter %XAMPP_DIR%.
  echo Bitte zuerst XAMPP installieren.
  pause
  exit /b 1
)

if not exist "%HTDOCS_LINK%" (
  echo [Lehrfahrer] Erstelle Projekt-Link in htdocs...
  cmd /c mklink /J "%HTDOCS_LINK%" "%PROJECT_DIR%" >nul 2>nul
  if errorlevel 1 (
    echo [Hinweis] Konnte Link nicht automatisch anlegen.
    echo Als Administrator ausfuehren oder manuell erstellen:
    echo mklink /J "%HTDOCS_LINK%" "%PROJECT_DIR%"
  )
)

start "" "%APACHE_START%"

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 8; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  echo [Warnung] App noch nicht erreichbar. Oeffne XAMPP Control Panel...
  if exist "%XAMPP_CTRL%" start "" "%XAMPP_CTRL%"
  echo Starte dort Apache manuell und rufe dann auf:
  echo %APP_URL%
  pause
  exit /b 1
)

echo [OK] Apache laeuft. Oeffne App: %APP_URL%
start "" "%APP_URL%"
exit /b 0
