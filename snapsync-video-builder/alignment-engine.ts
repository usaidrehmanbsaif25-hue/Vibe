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
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/""/g, '"').trim();
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
      // Handle escaped double-quote ("") – stay inside the field
      if (line[i + 1] === quoteChar) { i++; continue; }
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

const GROQ_MAX_BYTES     = 24 * 1024 * 1024; // 24MB (Groq hard limit is 25MB)
const CHUNK_DURATION_SEC = 8 * 60;            // 8-minute chunks per Whisper request
const CHUNK_OVERLAP_SEC  = 10;                // 10s overlap so boundary words aren't missed

/** Compress audio to mono 64kbps 16kHz MP3 — ideal for Whisper, tiny file size */
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

/** Extract a time slice of audio [startSec, endSec) into outputPath */
async function sliceAudio(inputPath: string, startSec: number, durationSec: number, outputPath: string): Promise<void> {
  const ffmpegMod       = (await import('fluent-ffmpeg')).default;
  const ffmpegInstaller = (await import('@ffmpeg-installer/ffmpeg')).default;
  ffmpegMod.setFfmpegPath(ffmpegInstaller.path);

  return new Promise((resolve, reject) => {
    ffmpegMod(inputPath)
      .setStartTime(startSec)
      .setDuration(durationSec)
      .outputOptions(['-y'])
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(new Error(`FFmpeg slice failed: ${err.message}`)))
      .save(outputPath);
  });
}

/** Upload one audio buffer to Groq Whisper, return response JSON */
async function whisperRequest(audioBuffer: Buffer, fileName: string, apiKey: string): Promise<any> {
  const FormData = (await import('form-data')).default;
  const fetch    = (await import('node-fetch')).default;

  const ext = fileName.split('.').pop()?.toLowerCase() || 'mp3';
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
    aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac'
  };
  const mimeType = mimeMap[ext] || 'audio/mpeg';

  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: fileName, contentType: mimeType });
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper API error (${response.status}): ${errText}`);
  }
  return response.json();
}

// ── Main transcription entry point — handles any audio length ─────────

export async function transcribeWithGroq(
  audioFilePath: string,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<any> {
  const { default: fsFull } = await import('fs');
  const pathMod = await import('path');
  const osMod   = await import('os');

  const log = (msg: string) => { console.log(msg); onProgress?.(msg); };

  const tmpDir   = osMod.tmpdir();
  const tempFiles: string[] = [];

  try {
    // ── Step 1: Always compress to mono 64kbps MP3 ──────────────────
    const compressedPath = pathMod.join(tmpDir, `snapsync_audio_${Date.now()}.mp3`);
    tempFiles.push(compressedPath);

    const origSize = fsFull.statSync(audioFilePath).size;
    log(`[whisper] Compressing audio (${(origSize / 1024 / 1024).toFixed(1)}MB) → mono 64kbps MP3...`);
    await compressAudio(audioFilePath, compressedPath);
    const compressedSize = fsFull.statSync(compressedPath).size;
    log(`[whisper] Compressed to ${(compressedSize / 1024 / 1024).toFixed(1)}MB`);

    // ── Step 2: Determine if chunking is needed ──────────────────────
    const totalDuration = await getAudioDuration(compressedPath);
    log(`[whisper] Audio duration: ${(totalDuration / 60).toFixed(1)} minutes`);

    const needsChunking = totalDuration > CHUNK_DURATION_SEC || compressedSize > GROQ_MAX_BYTES;

    if (!needsChunking) {
      // ── Short audio: single request ────────────────────────────────
      log(`[whisper] Transcribing in single request...`);
      const buf = fsFull.readFileSync(compressedPath);
      return await whisperRequest(buf, 'audio.mp3', apiKey);
    }

    // ── Step 3: Chunked transcription for long audio ─────────────────
    const numChunks = Math.ceil(totalDuration / CHUNK_DURATION_SEC);
    log(`[whisper] Long audio detected — splitting into ${numChunks} chunks of ${CHUNK_DURATION_SEC / 60} min each...`);

    const allWords: WhisperWord[] = [];
    const seenWordKeys = new Set<string>(); // deduplicate overlap words

    for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
      const chunkStart = chunkIdx * CHUNK_DURATION_SEC;
      // Add overlap at start (except first chunk) to catch boundary words
      const sliceStart = Math.max(0, chunkStart - (chunkIdx > 0 ? CHUNK_OVERLAP_SEC : 0));
      const sliceDur   = Math.min(CHUNK_DURATION_SEC + CHUNK_OVERLAP_SEC, totalDuration - sliceStart);

      if (sliceDur <= 0) break;

      const chunkPath = pathMod.join(tmpDir, `snapsync_chunk_${Date.now()}_${chunkIdx}.mp3`);
      tempFiles.push(chunkPath);

      log(`[whisper] Chunk ${chunkIdx + 1}/${numChunks}: ${(sliceStart / 60).toFixed(1)}–${((sliceStart + sliceDur) / 60).toFixed(1)} min`);
      await sliceAudio(compressedPath, sliceStart, sliceDur, chunkPath);

      const chunkBuf = fsFull.readFileSync(chunkPath);
      const result   = await whisperRequest(chunkBuf, `chunk_${chunkIdx}.mp3`, apiKey);

      // Extract words with absolute time offset applied
      const chunkWords = extractWords(result, sliceStart);

      // Deduplicate: each chunk only owns words in [chunkStart, nextChunkStart).
      // The backward overlap (sliceStart … chunkStart) gives Whisper better context
      // for boundary words but those words belong to the previous chunk's territory.
      // The forward overlap (chunkStart … sliceStart+sliceDur) is extra audio included
      // so Whisper has context; those words belong to the NEXT chunk's territory and
      // must be excluded here to prevent double-counting.
      const lowerCutoff = chunkIdx > 0 ? chunkStart : 0;
      const upperCutoff = chunkIdx < numChunks - 1 ? (chunkIdx + 1) * CHUNK_DURATION_SEC : Infinity;
      for (const w of chunkWords) {
        if (w.start < lowerCutoff) continue; // belongs to previous chunk's territory
        if (w.start >= upperCutoff) continue; // belongs to next chunk's territory
        const key = `${w.text}:${w.start.toFixed(2)}`;
        if (!seenWordKeys.has(key)) {
          seenWordKeys.add(key);
          allWords.push(w);
        }
      }

      log(`[whisper] Chunk ${chunkIdx + 1} → ${chunkWords.length} words extracted`);
    }

    // Sort merged words by start time (chunks are sequential but overlaps may cause minor disorder)
    allWords.sort((a, b) => a.start - b.start);
    log(`[whisper] Total merged words: ${allWords.length}`);

    // Return a synthetic whisper-style response with merged words
    return { words: allWords.map(w => ({ word: w.text, start: w.start, end: w.end })), segments: [] };

  } finally {
    // Clean up all temp files
    for (const f of tempFiles) {
      try { if (fsFull.existsSync(f)) fsFull.unlinkSync(f); } catch {}
    }
  }
}
