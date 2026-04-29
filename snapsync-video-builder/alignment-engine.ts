/**
 * Server-side audio-text alignment engine.
 * Ported from the proven Python algorithm in audio_Synchronizer notebooks.
 * Uses word-level Whisper timestamps + deterministic fuzzy matching.
 * Supports audio of any length via chunked transcription.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface WhisperWord {
  text: string;   // normalized single token
  start: number;  // seconds (absolute, in full audio)
  end: number;    // seconds (absolute, in full audio)
}

export interface CsvRow {
  index: number;
  text: string;           // original text
  cleanText: string;      // normalized
  tokens: string[];       // normalized tokens
  imageFileName?: string; // optional second CSV column (image filename)
}

export interface AlignedSegment {
  text: string;
  startTime: number;
  endTime: number;
  imageFileName?: string; // forwarded from CSV second column
}

// ── Text normalization (matches notebook logic) ──────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')  // remove punctuation
    .replace(/\s+/g, ' ')      // collapse whitespace
    .trim();
}

// ── Sequence similarity (SequenceMatcher equivalent) ─────────────────

function sequenceRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a.length || !b.length) return 0.0;

  const m = a.length, n = b.length;
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return (2.0 * prev[n]) / (m + n);
}

// ── Fuzzy threshold (from notebook) ──────────────────────────────────

function getFuzzyThreshold(tokenCount: number): number {
  if (tokenCount <= 2) return 0.75;
  if (tokenCount <= 5) return 0.65;
  return 0.55;
}

// ── Core matching: find a sentence in the word stream ─────────────────

function findSentenceMatch(
  sentenceTokens: string[],
  words: WhisperWord[],
  startWordIndex: number,
  lookaheadWords: number = 1000
): { startIdx: number; endIdx: number; score: number } | null {
  if (!sentenceTokens.length) return null;

  const n = sentenceTokens.length;
  const sentenceStr = sentenceTokens.join(' ');
  const endLimit = Math.min(words.length, startWordIndex + lookaheadWords);

  if (startWordIndex >= words.length || endLimit <= startWordIndex) return null;

  // Pass 1: exact token-by-token match
  const maxStartExact = endLimit - n;
  if (maxStartExact >= startWordIndex) {
    for (let i = startWordIndex; i <= maxStartExact; i++) {
      let match = true;
      for (let j = 0; j < n; j++) {
        if (words[i + j].text !== sentenceTokens[j]) { match = false; break; }
      }
      if (match) return { startIdx: i, endIdx: i + n - 1, score: 1.0 };
    }
  }

  // Pass 2: fuzzy sliding window
  const fuzzyThreshold = getFuzzyThreshold(n);
  let bestMatch: { startIdx: number; endIdx: number; score: number } | null = null;
  let bestScore = 0.0;

  const minWindow = Math.max(1, n - 3);
  const maxWindow = Math.min(n + 6, endLimit - startWordIndex);
  if (maxWindow < minWindow) return null;

  for (let windowSize = minWindow; windowSize <= maxWindow; windowSize++) {
    const maxStart = endLimit - windowSize;
    if (maxStart < startWordIndex) continue;
    for (let i = startWordIndex; i <= maxStart; i++) {
      const windowStr = words.slice(i, i + windowSize).map(w => w.text).join(' ');
      const score = sequenceRatio(sentenceStr, windowStr);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { startIdx: i, endIdx: i + windowSize - 1, score };
      }
    }
  }

  if (bestMatch && bestScore >= fuzzyThreshold) return bestMatch;
  return null;
}

// ── Parse CSV text into rows ─────────────────────────────────────────

/**
 * Parse a single CSV value: strip surrounding quotes and unescape doubled quotes.
 */
function parseCsvField(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/""/g, '"').trim();
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'").trim();
  }
  return s;
}

/**
 * Split a CSV line into at most two fields, respecting quoted values.
 * Returns [textField, imageField | undefined].
 */
function splitCsvLine(line: string): [string, string | undefined] {
  // Walk through the line tracking whether we are inside a quoted field
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (!inQuote && (ch === '"' || ch === "'")) {
      inQuote = true;
      quoteChar = ch;
    } else if (inQuote && ch === quoteChar) {
      // Handle escaped double-quote ("") or single-quote ('') – stay inside the field
      if (i + 1 < line.length && line[i + 1] === quoteChar) { i++; continue; }
      inQuote = false;
    } else if (!inQuote && ch === ',') {
      // Found the field separator
      const textRaw  = line.substring(0, i);
      const imageRaw = line.substring(i + 1);
      const imageVal = parseCsvField(imageRaw);
      return [parseCsvField(textRaw), imageVal || undefined];
    }
  }
  // No comma found – single-column CSV
  return [parseCsvField(line), undefined];
}

export function parseCsvText(csvText: string): CsvRow[] {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const rows: CsvRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const [textRaw, imageFileName] = splitCsvLine(lines[i]);
    const text = textRaw.trim();

    const lower = text.toLowerCase();
    if (i === 0 && (lower === 'text' || lower === 'script' || lower === 'line' ||
        lower === 'narration' || lower === 'dialogue' || lower === 'image')) {
      continue;
    }

    const clean = normalizeText(text);
    if (!clean) continue;

    rows.push({ index: rows.length, text, cleanText: clean, tokens: clean.split(' '), imageFileName });
  }
  return rows;
}

// ── Extract word timeline from Whisper response (with time offset) ────

export function extractWords(whisperResponse: any, offsetSec = 0): WhisperWord[] {
  const words: WhisperWord[] = [];

  // Method 1: top-level word timestamps (from timestamp_granularities[]=word)
  if (whisperResponse.words && Array.isArray(whisperResponse.words)) {
    for (const w of whisperResponse.words) {
      const clean = normalizeText(w.word || '');
      if (!clean) continue;
      const tokens = clean.split(' ').filter(Boolean);
      const wStart = (w.start ?? 0) + offsetSec;
      const wEnd   = (w.end   ?? 0) + offsetSec;
      const dur = Math.max((wEnd - wStart) / Math.max(tokens.length, 1), 0.01);
      tokens.forEach((token, i) => {
        words.push({ text: token, start: wStart + i * dur, end: wStart + (i + 1) * dur });
      });
    }
    if (words.length > 0) return words;
  }

  // Method 2: segment-level (with optional per-word timestamps inside segments)
  if (whisperResponse.segments && Array.isArray(whisperResponse.segments)) {
    for (const seg of whisperResponse.segments) {
      const segStart = (seg.start || 0) + offsetSec;
      const segEnd   = (seg.end   || segStart - offsetSec) + offsetSec;
      const segWords = seg.words || [];

      if (segWords.length > 0) {
        for (const w of segWords) {
          const clean = normalizeText(w.word || '');
          if (!clean) continue;
          const wStart = (w.start ?? seg.start ?? 0) + offsetSec;
          const wEnd   = (w.end   ?? seg.end   ?? 0) + offsetSec;
          const tokens = clean.split(' ').filter(Boolean);
          const dur = Math.max((wEnd - wStart) / Math.max(tokens.length, 1), 0.01);
          tokens.forEach((token, i) => {
            words.push({ text: token, start: wStart + i * dur, end: Math.min(wStart + (i + 1) * dur, wEnd) });
          });
        }
      } else {
        // No per-word timestamps — distribute segment text evenly
        const tokens = normalizeText(seg.text || '').split(' ').filter(Boolean);
        if (!tokens.length) continue;
        const dur = Math.max((segEnd - segStart) / tokens.length, 0.01);
        tokens.forEach((token, i) => {
          words.push({ text: token, start: segStart + i * dur, end: segStart + (i + 1) * dur });
        });
      }
    }
  }

  return words;
}

// ── Main alignment: match CSV lines to audio word timeline ───────────

export function alignCsvToAudio(
  csvRows: CsvRow[],
  words: WhisperWord[],
  audioDuration: number
): AlignedSegment[] {
  if (!words.length || !csvRows.length) {
    const dur = audioDuration / Math.max(csvRows.length, 1);
    return csvRows.map((row, i) => ({
      text: row.text,
      startTime: i * dur,
      endTime: (i + 1) * dur
    }));
  }

  // Phase 1: Find matches for each CSV line
  const matches: ({ startIdx: number; endIdx: number; score: number } | null)[] = [];
  let wordPointer = 0;

  for (const row of csvRows) {
    const match = findSentenceMatch(row.tokens, words, wordPointer);
    if (match) wordPointer = match.endIdx + 1;
    matches.push(match);
  }

  // Phase 2: Convert matches to timestamps
  const times: ([number, number] | null)[] = matches.map(m => {
    if (!m) return null;
    const st = words[m.startIdx].start;
    const en = words[m.endIdx].end;
    return [st, Math.max(st + 0.1, en)];
  });

  // Interpolate null gaps
  let i = 0;
  while (i < times.length) {
    if (times[i] === null) {
      let j = i;
      while (j < times.length && times[j] === null) j++;
      const prevEnd   = i > 0 && times[i - 1] ? times[i - 1]![1] : 0.0;
      const nextStart = j < times.length && times[j] ? times[j]![0] : audioDuration;
      const dur = Math.max(nextStart - prevEnd, 0.1) / (j - i);
      let curr = prevEnd;
      for (let k = i; k < j; k++) { times[k] = [curr, curr + dur]; curr += dur; }
      i = j;
    } else {
      i++;
    }
  }

  // Phase 3: Extend each segment to the next segment's start (no gaps)
  const result: AlignedSegment[] = [];
  for (let i = 0; i < csvRows.length; i++) {
    const t = times[i]!;
    const endTime = i < csvRows.length - 1 && times[i + 1]
      ? Math.max(times[i + 1]![0], t[0] + 0.1)
      : audioDuration;

    result.push({
      text: csvRows[i].text,
      startTime: Math.round(t[0] * 1000) / 1000,
      endTime:   Math.round(endTime * 1000) / 1000,
      imageFileName: csvRows[i].imageFileName
    });
  }

  return result;
}

// ── Transcription helpers ─────────────────────────────────────────────

/** Compress audio to mono 64kbps 16kHz MP3 — smaller upload, no quality loss for speech */
async function compressAudio(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegMod       = (await import('fluent-ffmpeg')).default;
  const ffmpegInstaller = (await import('@ffmpeg-installer/ffmpeg')).default;
  ffmpegMod.setFfmpegPath(ffmpegInstaller.path);

  return new Promise((resolve, reject) => {
    ffmpegMod(inputPath)
      .audioCodec('libmp3lame')
      .audioBitrate(64)       // 64kbps — plenty for speech transcription quality
      .audioChannels(1)       // mono — halves size, no quality loss for speech
      .audioFrequency(16000)  // 16kHz — Whisper's native sample rate
      .outputOptions(['-y'])
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`FFmpeg compression failed: ${err.message}`)))
      .save(outputPath);
  });
}

/** Get audio duration in seconds via ffprobe */
async function getAudioDuration(filePath: string): Promise<number> {
  const ffmpegMod       = (await import('fluent-ffmpeg')).default;
  const ffmpegInstaller = (await import('@ffmpeg-installer/ffmpeg')).default;
  ffmpegMod.setFfmpegPath(ffmpegInstaller.path);

  return new Promise((resolve, reject) => {
    ffmpegMod.ffprobe(filePath, (err: any, meta: any) => {
      if (err) reject(err);
      else resolve(meta?.format?.duration || 0);
    });
  });
}

// ── Gladia transcription ──────────────────────────────────────────────

const GLADIA_UPLOAD_URL     = 'https://api.gladia.io/v2/upload';
const GLADIA_TRANSCRIBE_URL = 'https://api.gladia.io/v2/pre-recorded';
const GLADIA_POLL_INTERVAL  = 3000;  // ms between status polls
const GLADIA_MAX_WAIT_MS    = 20 * 60 * 1000; // 20-minute cap

/**
 * Transcribe an audio file using Gladia's async API.
 * Handles audio of any length — Gladia processes the whole file server-side.
 * Returns a Whisper-compatible response `{ words: [{word, start, end}] }` so
 * the existing `extractWords` / `alignCsvToAudio` pipeline works unchanged.
 */
export async function transcribeWithGladia(
  audioFilePath: string,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<any> {
  const { default: fsFull } = await import('fs');
  const pathMod  = await import('path');
  const osMod    = await import('os');
  const FormData = (await import('form-data')).default;
  const fetch    = (await import('node-fetch')).default;

  const log = (msg: string) => { console.log(msg); onProgress?.(msg); };

  const tmpDir   = osMod.tmpdir();
  const tempFiles: string[] = [];

  try {
    // ── Step 1: Compress to mono MP3 for faster upload ───────────────
    const compressedPath = pathMod.join(tmpDir, `snapsync_gladia_${Date.now()}.mp3`);
    tempFiles.push(compressedPath);

    const origSize = fsFull.statSync(audioFilePath).size;
    log(`[gladia] Compressing audio (${(origSize / 1024 / 1024).toFixed(1)}MB) → mono 64kbps MP3...`);
    await compressAudio(audioFilePath, compressedPath);
    const compressedSize = fsFull.statSync(compressedPath).size;
    log(`[gladia] Compressed to ${(compressedSize / 1024 / 1024).toFixed(1)}MB`);

    // ── Step 2: Upload to Gladia ─────────────────────────────────────
    log(`[gladia] Uploading audio to Gladia...`);
    const uploadForm = new FormData();
    uploadForm.append('audio', fsFull.createReadStream(compressedPath), {
      filename: 'audio.mp3',
      contentType: 'audio/mpeg'
    });

    const uploadRes = await fetch(GLADIA_UPLOAD_URL, {
      method: 'POST',
      headers: { 'x-gladia-key': apiKey, ...uploadForm.getHeaders() },
      body: uploadForm
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Gladia upload failed (${uploadRes.status}): ${errText}`);
    }
    const uploadData: any = await uploadRes.json();
    const audioUrl: string = uploadData.audio_url;
    if (!audioUrl) throw new Error('Gladia upload did not return audio_url');
    log(`[gladia] Upload complete. audio_url: ${audioUrl}`);

    // ── Step 3: Start transcription job ─────────────────────────────
    log(`[gladia] Starting transcription job...`);
    const transcribeRes = await fetch(GLADIA_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        'x-gladia-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        diarization: false,
        word_timestamps: true
      })
    });
    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text();
      throw new Error(`Gladia transcription start failed (${transcribeRes.status}): ${errText}`);
    }
    const transcribeData: any = await transcribeRes.json();
    const jobId: string = transcribeData.id;
    if (!jobId) throw new Error('Gladia did not return a job id');
    log(`[gladia] Job created: ${jobId}`);

    // ── Step 4: Poll for completion ──────────────────────────────────
    const pollUrl = `${GLADIA_TRANSCRIBE_URL}/${jobId}`;
    const deadline = Date.now() + GLADIA_MAX_WAIT_MS;
    let gladiaResult: any = null;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, GLADIA_POLL_INTERVAL));
      const pollRes = await fetch(pollUrl, {
        headers: { 'x-gladia-key': apiKey }
      });
      if (!pollRes.ok) {
        const errText = await pollRes.text();
        throw new Error(`Gladia poll failed (${pollRes.status}): ${errText}`);
      }
      const pollData: any = await pollRes.json();
      log(`[gladia] Job status: ${pollData.status}`);

      if (pollData.status === 'done') {
        gladiaResult = pollData;
        break;
      }
      if (pollData.status === 'error') {
        throw new Error(`Gladia transcription error: ${JSON.stringify(pollData.error_code ?? pollData)}`);
      }
    }

    if (!gladiaResult) {
      throw new Error(`Gladia transcription timed out after ${GLADIA_MAX_WAIT_MS / 60000} minutes`);
    }

    // ── Step 5: Convert to Whisper-compatible word list ───────────────
    const utterances: any[] = gladiaResult?.result?.transcription?.utterances ?? [];
    const words: { word: string; start: number; end: number }[] = [];

    for (const utt of utterances) {
      for (const w of (utt.words ?? [])) {
        if (w.word) words.push({ word: w.word, start: w.start ?? 0, end: w.end ?? 0 });
      }
    }
    log(`[gladia] Extracted ${words.length} words from transcript`);

    return { words, segments: [] };

  } finally {
    for (const f of tempFiles) {
      try { if (fsFull.existsSync(f)) fsFull.unlinkSync(f); } catch {}
    }
  }
}
