import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';
import { generateCapCutProject, AlignmentEntry } from './capcut-generator.js';
import { transcribeWithGladia, extractWords, parseCsvText, alignCsvToAudio } from './alignment-engine.js';

dotenv.config({ path: '.env.local' });

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Natural A-Z sort: handles numeric parts correctly (1, 2, 10 not 1, 10, 2)
function naturalSort(a: string, b: string): number {
  const nameA = path.basename(a);
  const nameB = path.basename(b);
  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
}

const app = express();
const PORT = 3000;

// Setup directories
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// Multer storage
const storage = multer.diskStorage({
  destination: (req: any, file, cb) => {
    req.uploadId = req.uploadId || uuidv4();
    const dir = path.join(UPLOADS_DIR, req.uploadId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

app.use(express.json({ limit: '50mb' }));
app.use('/outputs', express.static(OUTPUTS_DIR));

// Tasks state
const tasks: Record<string, {
  status: 'idle' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  videoUrl?: string;
  error?: string;
}> = Object.create(null); // null-prototype prevents __proto__ pollution

/** Validate that a taskId is a well-formed UUID (v4 hex string from uuidv4()). */
function isValidTaskId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Safely look up a task, guarded against prototype-pollution keys. */
function getTask(id: string) {
  return Object.hasOwn(tasks, id) ? tasks[id] : undefined;
}

// 1. Upload files
app.post('/api/upload', (req: express.Request, res: express.Response) => {
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'csv', maxCount: 1 },
    { name: 'zip', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(500).json({ error: 'Upload parsing error: ' + err.message });
    }
    
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    
    if (!files || !files.audio || !files.csv || !files.zip) {
      return res.status(400).json({ error: 'Missing required files (audio, csv, zip). Received: ' + (files ? Object.keys(files).join(',') : 'none') });
    }

    const taskPath = path.dirname(files.audio[0].path);
    const newTaskTaskId = path.basename(taskPath);

    tasks[newTaskTaskId] = {
      status: 'idle',
      progress: 0,
      message: 'Files uploaded successfully'
    };

    res.json({
      taskId: newTaskTaskId,
      audioPath: files.audio[0].path,
      csvPath: files.csv[0].path,
      zipPath: files.zip[0].path
    });
  });
});

// 2. Build Video
app.post('/api/build', async (req, res) => {
  const { taskId, alignment, settings } = req.body;
  
  if (!isValidTaskId(taskId) || !alignment || !Array.isArray(alignment)) {
    return res.status(400).json({ error: 'Invalid task or alignment data' });
  }

  const task = getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'processing';
  task.progress = 10;
  task.message = 'Extracting images...';

  try {
    const taskDir = path.join(UPLOADS_DIR, taskId);
    const imgDir = path.join(taskDir, 'images');
    const zipFile = fs.readdirSync(taskDir).find(f => f.toLowerCase().endsWith('.zip'));
    
    if (!zipFile) throw new Error('ZIP file not found');

    const zip = new AdmZip(path.join(taskDir, zipFile));
    zip.extractAllTo(imgDir, true);

    task.progress = 30;
    task.message = 'Preparing video frames...';

    // Get all images recursively
    const getAllFiles = (dirPath: string, arrayOfFiles: string[] = []) => {
      const files = fs.readdirSync(dirPath);
      files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
          arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
          arrayOfFiles.push(fullPath);
        }
      });
      return arrayOfFiles;
    };

    const allImagesPaths = getAllFiles(imgDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (allImagesPaths.length === 0) throw new Error('No images found in ZIP file');
    
    // Natural A-Z sort (numeric-aware: img1, img2, img10 — not img1, img10, img2)
    allImagesPaths.sort(naturalSort);
    console.log('[build] Image order:', allImagesPaths.map(f => path.basename(f)));

    // 3. Assemble Video using Concat Demuxer
    const audioFile = fs.readdirSync(taskDir).find(f => /\.(mp3|wav|m4a)$/i.test(f));
    if (!audioFile) throw new Error('Audio file not found');
    const audioPath = path.join(taskDir, audioFile);

    // Resolution setup
    const resMap: Record<string, string> = {
      'landscape': '1920x1080',
      'portrait': '1080x1920',
      'square': '1080x1080'
    };
    const sizeStr = resMap[settings?.resolution || 'landscape'] || '1920x1080';
    const [width, height] = sizeStr.split('x');

    // Generate SRT file for subtitles if requested
    const srtFilePath = path.join(taskDir, 'subtitles.srt');
    if (settings?.showSubtitles && alignment.length > 0) {
      let srtContent = '';
      const formatTime = (secs: number) => {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        const ms = Math.floor((secs % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
      };
      
      alignment.forEach((seg: any, idx: number) => {
        srtContent += `${idx + 1}\n`;
        srtContent += `${formatTime(seg.startTime)} --> ${formatTime(seg.endTime)}\n`;
        srtContent += `${seg.text || ''}\n\n`;
      });
      fs.writeFileSync(srtFilePath, srtContent);
    }

    const concatFilePath = path.join(taskDir, 'concat.txt');
    let concatContent = '';
    
    // Build a basename→path lookup for filename-based image matching (MP4 mode)
    const imageByBasename: Record<string, string> = {};
    for (const p of allImagesPaths) {
      imageByBasename[path.basename(p).toLowerCase()] = p;
    }

    alignment.forEach((seg: any, idx: number) => {
      // Resolve image: prefer filename from CSV second column, fall back to sequential wrap-around
      let imgPath: string;
      if (seg.imageFileName) {
        imgPath =
          imageByBasename[seg.imageFileName.toLowerCase()] ??
          allImagesPaths[idx % allImagesPaths.length];
      } else {
        imgPath = allImagesPaths[idx % allImagesPaths.length];
      }
      if (fs.existsSync(imgPath)) {
        // FFmpeg concat demuxer expects single quotes escaped and forward slashes on Windows
        const escapedPath = imgPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
        concatContent += `file '${escapedPath}'\n`;
        concatContent += `duration ${seg.endTime - seg.startTime}\n`;
      }
    });

    // FFmpeg concat demuxer bug: last file needs to be repeated or wait
    if (alignment.length > 0) {
      const imgPath = allImagesPaths[(alignment.length - 1) % allImagesPaths.length];
      
      const escapedPath = imgPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
      concatContent += `file '${escapedPath}'\n`;
    }
    
    fs.writeFileSync(concatFilePath, concatContent);

    task.progress = 50;
    task.message = 'Rendering video...';

    const outputPath = path.join(OUTPUTS_DIR, `${taskId}.mp4`);
    
    ffmpeg()
      .input(concatFilePath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .input(audioPath)
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-r 24',
        '-shortest',
        '-vf', (() => {
          let filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
          if (settings?.showSubtitles && fs.existsSync(srtFilePath)) {
            // Escape backslashes and colons for the subtitles filter on Windows
            const escapedSrtPath = srtFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');
            filter += `,subtitles='${escapedSrtPath}'`;
          }
          return filter;
        })()
      ])
      .on('progress', (progress) => {
        task.progress = 50 + (progress.percent || 0) / 2;
        task.message = `Rendering: ${Math.round(progress.percent || 0)}%`;
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        task.status = 'failed';
        task.error = err.message;
      })
      .on('end', () => {
        task.status = 'completed';
        task.progress = 100;
        task.message = 'Video created successfully!';
        task.videoUrl = `/outputs/${taskId}.mp4`;
      })
      .save(outputPath);

    // Note: The loop input above handles durations. 
    // If we have many images, we should probably generate a temporary concat script for ffmpeg.

    res.json({ taskId });

  } catch (error: any) {
    task.status = 'failed';
    task.error = error.message;
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/status/:taskId', (req, res) => {
  if (!isValidTaskId(req.params.taskId)) return res.status(400).json({ error: 'Invalid taskId' });
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// ── Server-side Alignment (word-level Gladia + fuzzy matching) ───
app.post('/api/align', async (req, res) => {
  const { taskId } = req.body;
  if (!isValidTaskId(taskId)) return res.status(400).json({ error: 'taskId required' });

  const task = getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'processing';
  task.progress = 10;
  task.message = 'Transcribing audio with Gladia...';

  try {
    const taskDir = path.join(UPLOADS_DIR, taskId);
    const audioFile = fs.readdirSync(taskDir).find(f => /\.(mp3|wav|m4a)$/i.test(f));
    if (!audioFile) throw new Error('Audio file not found');
    const audioPath = path.join(taskDir, audioFile);

    const csvFile = fs.readdirSync(taskDir).find(f => /\.csv$/i.test(f));
    if (!csvFile) throw new Error('CSV file not found');
    const csvText = fs.readFileSync(path.join(taskDir, csvFile), 'utf-8');

    // Get audio duration
    const audioDuration: number = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err: any, metadata: any) => {
        if (err) reject(err);
        else resolve(metadata.format.duration || 0);
      });
    });

    task.progress = 20;
    task.message = 'Getting word-level timestamps from Gladia...';

    // Transcribe with word-level timestamps via Gladia
    const apiKey = process.env.GLADIA_API_KEY;
    if (!apiKey) throw new Error('GLADIA_API_KEY not configured');
    const whisperResult = await transcribeWithGladia(audioPath, apiKey);

    task.progress = 60;
    task.message = 'Aligning script lines to audio...';

    // Extract word timeline
    const words = extractWords(whisperResult);
    console.log(`[align] Extracted ${words.length} words from audio`);

    // Parse CSV
    const csvRows = parseCsvText(csvText);
    console.log(`[align] Parsed ${csvRows.length} CSV rows`);

    // Run deterministic alignment
    const alignment = alignCsvToAudio(csvRows, words, audioDuration);
    console.log(`[align] Produced ${alignment.length} aligned segments`);

    task.progress = 100;
    task.status = 'completed';
    task.message = `Aligned ${alignment.length} segments`;

    res.json({ alignment, audioDuration });

  } catch (error: any) {
    console.error('Alignment error:', error);
    task.status = 'failed';
    task.error = error.message;
    res.status(500).json({ error: error.message });
  }
});

// ── CapCut Project Generation ────────────────────────────────────
app.post('/api/build-capcut', async (req, res) => {
  const { taskId, alignment, settings } = req.body;

  if (!isValidTaskId(taskId) || !alignment || !Array.isArray(alignment)) {
    return res.status(400).json({ error: 'Invalid task or alignment data' });
  }

  const task = getTask(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.status = 'processing';
  task.progress = 10;
  task.message = 'Preparing CapCut project...';

  try {
    const taskDir = path.join(UPLOADS_DIR, taskId);
    const imgDir = path.join(taskDir, 'images');

    // Extract images from ZIP
    const zipFile = fs.readdirSync(taskDir).find(f => f.toLowerCase().endsWith('.zip'));
    if (!zipFile) throw new Error('ZIP file not found');
    const zip = new AdmZip(path.join(taskDir, zipFile));
    zip.extractAllTo(imgDir, true);

    task.progress = 30;
    task.message = 'Sorting images...';

    // Collect and sort images
    const getAllFiles = (dirPath: string, arr: string[] = []) => {
      for (const file of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, file);
        if (fs.statSync(full).isDirectory()) getAllFiles(full, arr);
        else arr.push(full);
      }
      return arr;
    };
    const allImages = getAllFiles(imgDir)
      .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort(naturalSort);
    console.log('[capcut] Image order:', allImages.map(f => path.basename(f)));

    if (allImages.length === 0) throw new Error('No images found in ZIP');

    // Find audio file
    const audioFile = fs.readdirSync(taskDir).find(f => /\.(mp3|wav|m4a)$/i.test(f));
    if (!audioFile) throw new Error('Audio file not found');
    const audioPath = path.join(taskDir, audioFile);

    // Get audio duration
    const audioDuration: number = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err: any, metadata: any) => {
        if (err) reject(err);
        else resolve(metadata.format.duration || 0);
      });
    });

    task.progress = 50;
    task.message = 'Generating CapCut project...';

    // CapCut projects directory
    const capcutDir = process.env.CAPCUT_PROJECTS_PATH
      || 'C:/Users/Hanzla Rehman/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft';

    const result = generateCapCutProject(
      alignment as AlignmentEntry[],
      audioPath,
      allImages,
      audioDuration,
      {
        resolution: settings?.resolution || 'landscape',
        projectName: settings?.projectName || `SnapSync_${Date.now()}`
      },
      capcutDir
    );

    task.status = 'completed';
    task.progress = 100;
    task.message = `CapCut project created: ${result.projectName}`;
    (task as any).projectName = result.projectName;
    (task as any).projectPath = result.projectPath;

    res.json({
      taskId,
      projectName: result.projectName,
      projectPath: result.projectPath
    });

  } catch (error: any) {
    console.error('CapCut generation error:', error);
    task.status = 'failed';
    task.error = error.message;
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
