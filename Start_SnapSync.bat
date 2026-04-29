@echo off
title SnapSync Video Builder
setlocal

:: Always run from the directory where this .bat file lives
cd /d "%~dp0snapsync-video-builder"

echo ====================================================================
echo  SnapSync Video Builder
echo ====================================================================
echo.

:: Create .env.local from the example if it doesn't exist yet
if not exist ".env.local" (
    if exist ".env.example" (
        copy ".env.example" ".env.local" >nul
        echo [INFO] Created .env.local from .env.example
        echo        Please edit .env.local and add your GLADIA_API_KEY, then
        echo        re-run this file.
        echo.
        notepad .env.local
        pause
        exit /b 0
    )
)

:: Warn if GLADIA_API_KEY is still the placeholder
findstr /C:"YOUR_GLADIA_API_KEY" .env.local >nul 2>&1
if %errorlevel%==0 (
    echo ====================================================================
    echo [WARNING] GLADIA_API_KEY is not set in .env.local!
    echo The alignment step will fail until you add your key.
    echo Please edit: %~dp0snapsync-video-builder\.env.local
    echo ====================================================================
    echo.
    pause
)

:: Install dependencies if node_modules is missing
if not exist "node_modules" (
    echo [INFO] node_modules not found — running npm install...
    npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed. Make sure Node.js is installed.
        pause
        exit /b 1
    )
    echo.
)

echo Starting server — this window must stay open while you use the tool.
echo.

:: Open browser after a short delay (runs in background)
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

npm run dev

pause
