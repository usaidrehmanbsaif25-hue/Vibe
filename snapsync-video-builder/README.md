<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# SnapSync Video Builder

Automatically align images to audio using word-level transcription from Gladia, then export as an MP4 or CapCut project.

## Quick Start (Windows)

1. Install [Node.js](https://nodejs.org/) (v18 or later)
2. Download / clone this repository
3. Double-click **`Start_SnapSync.bat`** — it will:
   - Create `.env.local` from `.env.example` on first run and open it in Notepad
   - Install `node_modules` automatically if needed
   - Launch the server and open `http://localhost:3000` in your browser

## Manual Setup

```
cd snapsync-video-builder
npm install
```

Create `snapsync-video-builder/.env.local` with your Gladia API key:

```
GLADIA_API_KEY=your_key_here
```

Then start the server:

```
npm run dev
```

Open `http://localhost:3000` in your browser.

## Getting a Gladia API Key

Sign up for free at <https://app.gladia.io> and copy your API key from the dashboard.
