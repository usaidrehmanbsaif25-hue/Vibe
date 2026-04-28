@echo off
title SnapSync Video Builder
echo Starting SnapSync Video Builder...

:: Navigate to the project directory
cd /d "d:\Tool\snapsync-video-builder"

:: Check if the API key is still the placeholder
findstr /C:"your_api_key_here" .env.local >nul
if %errorlevel%==0 (
    echo ====================================================================
    echo [WARNING] You haven't set your Gemini API key in the .env.local file!
    echo The app will not work correctly until you add your key.
    echo Please edit: d:\Tool\snapsync-video-builder\.env.local
    echo ====================================================================
    echo.
)

echo Launching application in your browser...
:: Wait a second to ensure server starts before browser opens
timeout /t 2 /nobreak >nul
start http://localhost:3000

echo Starting local server... Keep this window open while using the tool!
echo.
npm run dev

pause
