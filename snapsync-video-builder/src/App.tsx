/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  FileAudio, 
  FileSpreadsheet, 
  FileArchive, 
  Play, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Download,
  Settings2,
  Video,
  FolderOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type Resolution = 'landscape' | 'portrait' | 'square';
type OutputMode = 'mp4' | 'capcut';

interface AlignmentSegment {
  text: string;
  startTime: number;
  endTime: number;
  imageFileName?: string;
}

export default function App() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  
  const [resolution, setResolution] = useState<Resolution>('landscape');
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [outputMode, setOutputMode] = useState<OutputMode>('capcut');
  const [projectName, setProjectName] = useState('');
  
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState({ progress: 0, message: '', videoUrl: '' });
  const [error, setError] = useState<string | null>(null);
  const [capcutResult, setCapcutResult] = useState<{ projectName: string; projectPath: string } | null>(null);

  const pollInterval = useRef<number | null>(null);

  const handleUpload = async () => {
    if (!audioFile || !csvFile || !zipFile) {
      setError('Please select all required files.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setCapcutResult(null);
    setStatus({ progress: 5, message: 'Uploading files...', videoUrl: '' });

    try {
      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('csv', csvFile);
      formData.append('zip', zipFile);

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) throw new Error('Upload failed');
      const { taskId : tid } = await uploadRes.json();
      setTaskId(tid);

      // ── Server-side alignment (word-level Whisper + fuzzy matching) ──
      setStatus({ progress: 15, message: 'Transcribing audio & aligning...', videoUrl: '' });
      const alignRes = await fetch('/api/align', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: tid })
      });

      if (!alignRes.ok) {
        const errData = await alignRes.json();
        throw new Error(errData.error || 'Alignment failed');
      }

      const { alignment } = await alignRes.json();

      if (outputMode === 'capcut') {
        // ── CapCut Project Mode ──
        setStatus({ progress: 70, message: 'Generating CapCut project...', videoUrl: '' });
        const buildRes = await fetch('/api/build-capcut', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: tid,
            alignment,
            settings: {
              resolution,
              projectName: projectName.trim() || `SnapSync_${Date.now()}`
            }
          })
        });

        if (!buildRes.ok) {
          const errData = await buildRes.json();
          throw new Error(errData.error || 'CapCut generation failed');
        }

        const result = await buildRes.json();
        setCapcutResult({ projectName: result.projectName, projectPath: result.projectPath });
        setStatus({ progress: 100, message: `Project "${result.projectName}" created!`, videoUrl: '' });
        setIsProcessing(false);

      } else {
        // ── MP4 Render Mode (existing flow) ──
        setStatus({ progress: 70, message: 'Starting video build...', videoUrl: '' });
        const buildRes = await fetch('/api/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: tid,
            alignment,
            settings: { resolution, showSubtitles }
          })
        });

        if (!buildRes.ok) throw new Error('Build failed');
        startPolling(tid);
      }

    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setIsProcessing(false);
    }
  };

  const startPolling = (tid: string) => {
    if (pollInterval.current) window.clearInterval(pollInterval.current);
    pollInterval.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${tid}`);
        if (!res.ok) throw new Error('Status check failed');
        const data = await res.json();
        
        setStatus({
          progress: data.progress,
          message: data.message,
          videoUrl: data.videoUrl || ''
        });

        if (data.status === 'completed') {
          stopPolling();
          setIsProcessing(false);
        } else if (data.status === 'failed') {
          stopPolling();
          setError(data.error || 'Processing failed');
          setIsProcessing(false);
        }
      } catch (err: any) {
        stopPolling();
        setError(err.message);
        setIsProcessing(false);
      }
    }, 2000);
  };

  const stopPolling = () => {
    if (pollInterval.current) window.clearInterval(pollInterval.current);
  };

  const resetAll = () => {
    setAudioFile(null); setCsvFile(null); setZipFile(null);
    setStatus({ progress: 0, message: '', videoUrl: '' });
    setTaskId(null); setCapcutResult(null); setError(null);
    setProjectName('');
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-slate-200 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm">SP</span>
              SnapSync Pro
            </h1>
            <p className="text-slate-500 text-xs mt-1">Automated Audio-Visual Synchronization Engine</p>
          </div>
          {status.videoUrl ? (
            <motion.a 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              href={status.videoUrl} 
              download
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-500 transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)]"
            >
              <Download className="w-4 h-4" /> Download Video
            </motion.a>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-xs font-medium text-slate-300">Production Environment</span>
                <span className="text-[10px] text-green-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span> Ready for processing</span>
              </div>
              <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                <span className="text-xs text-slate-400">JD</span>
              </div>
            </div>
          )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Main Controls */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="bg-[#141414] border border-slate-800 rounded-xl p-6 flex flex-col">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Input Assets</h2>
              
              <div className="grid grid-cols-1 gap-3">
                <FileDrop 
                  label="Image Collection"
                  description="Drop .zip file containing high-res assets"
                  icon={<span className="font-mono text-xs">ZIP</span>}
                  file={zipFile}
                  onSelect={setZipFile}
                  colorClass="bg-blue-500/10 text-blue-500"
                />
                <FileDrop 
                  label="Voiceover Track"
                  description="Master audio file (WAV/MP3/AAC)"
                  icon={<span className="font-mono text-xs">MP3</span>}
                  file={audioFile}
                  onSelect={setAudioFile}
                  colorClass="bg-purple-500/10 text-purple-500"
                />
                <FileDrop 
                  label="Sync Manifest"
                  description="Time-stamped image mapping data"
                  icon={<span className="font-mono text-xs">CSV</span>}
                  file={csvFile}
                  onSelect={setCsvFile}
                  colorClass="bg-green-500/10 text-green-500"
                />
              </div>
            </div>

            <div className="bg-[#141414] border border-slate-800 rounded-xl p-6 flex-1">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Processing Config</h2>
              
              {/* Output Mode Toggle */}
              <div className="mb-5">
                <label className="text-[10px] text-slate-500 uppercase mb-2 block">Output Mode</label>
                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                  <button
                    onClick={() => setOutputMode('capcut')}
                    className={`flex-1 py-2.5 px-4 text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      outputMode === 'capcut' 
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)]' 
                        : 'bg-[#1A1A1A] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    CapCut Project
                  </button>
                  <button
                    onClick={() => setOutputMode('mp4')}
                    className={`flex-1 py-2.5 px-4 text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                      outputMode === 'mp4' 
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)]' 
                        : 'bg-[#1A1A1A] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Video className="w-3.5 h-3.5" />
                    Render MP4
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase mb-2 block">Resolution</label>
                    <select 
                      value={resolution} 
                      onChange={(e) => setResolution(e.target.value as Resolution)}
                      className="w-full bg-[#1A1A1A] border border-slate-800 rounded p-2 text-sm text-slate-300 outline-none hover:border-slate-700 focus:border-blue-500 transition-colors"
                    >
                      <option value="landscape">Full HD 1080p (1920x1080)</option>
                      <option value="portrait">Vertical (1080x1920)</option>
                      <option value="square">Square (1080x1080)</option>
                    </select>
                  </div>

                  {outputMode === 'capcut' && (
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase mb-2 block">Project Name</label>
                      <input 
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="SnapSync_auto"
                        className="w-full bg-[#1A1A1A] border border-slate-800 rounded p-2 text-sm text-slate-300 outline-none hover:border-slate-700 focus:border-blue-500 transition-colors placeholder:text-slate-600"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {outputMode === 'mp4' && (
                    <div className="flex items-center justify-between mt-8">
                      <label className="text-xs font-medium text-slate-400">Burn-in Subtitles</label>
                      <button 
                        onClick={() => setShowSubtitles(!showSubtitles)}
                        className={`w-10 h-5 rounded-full p-0.5 transition-all ${showSubtitles ? 'bg-blue-600' : 'bg-slate-800'}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white transition-all shadow-sm ${showSubtitles ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  )}
                  {outputMode === 'capcut' && (
                    <div className="mt-8 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                      <p className="text-[10px] text-blue-400 leading-relaxed">
                        <strong>CapCut Mode:</strong> Generates a project directly in your CapCut project folder. 
                        Close CapCut before generating, then reopen to find your project.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Preview / Results */}
          <div className="lg:col-span-5 flex flex-col gap-4 h-full min-h-0">
            <div className="bg-[#141414] border border-slate-800 rounded-xl p-6 flex flex-col h-full overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">System Readiness</h2>
                <span className="text-[10px] font-mono text-slate-500 italic">v.3.0.0-capcut</span>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto pr-2 relative">
                {/* CapCut Success State */}
                {capcutResult && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center h-full text-center p-6"
                  >
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-6 border border-blue-500/30">
                      <CheckCircle2 className="w-10 h-10 text-green-400" />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">CapCut Project Ready!</h3>
                    <p className="text-sm text-slate-400 mb-1">
                      Project <span className="text-blue-400 font-mono">"{capcutResult.projectName}"</span> has been created.
                    </p>
                    <p className="text-xs text-slate-500 mb-6">Open CapCut Desktop to find it in your project list.</p>
                    
                    <div className="w-full p-3 rounded-lg bg-[#1A1A1A] border border-slate-800 text-left mb-4">
                      <p className="text-[10px] text-slate-500 uppercase mb-1">Project Path</p>
                      <p className="text-xs text-slate-300 font-mono break-all">{capcutResult.projectPath}</p>
                    </div>
                    
                    <button 
                      onClick={resetAll}
                      className="text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-wider"
                    >
                      Start New Task →
                    </button>
                  </motion.div>
                )}

                {/* MP4 Video Preview */}
                {status.videoUrl && !capcutResult ? (
                  <video 
                    src={status.videoUrl} 
                    controls 
                    className="w-full h-full object-contain bg-black rounded"
                  />
                ) : !capcutResult && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700">
                    {outputMode === 'capcut' ? (
                      <>
                        <FolderOpen className="w-16 h-16 mb-4 stroke-1" />
                        <p className="text-xs font-mono tracking-widest uppercase">CapCut Project Output</p>
                      </>
                    ) : (
                      <>
                        <Video className="w-16 h-16 mb-4 stroke-1" />
                        <p className="text-xs font-mono tracking-widest uppercase">Video Preview Area</p>
                      </>
                    )}
                  </div>
                )}

                {isProcessing && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 text-center rounded">
                    <div className="max-w-md w-full">
                      <div className="mb-6">
                        <div className="text-4xl font-black text-white mb-2 leading-none font-mono">
                          {status.progress}%
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">{status.message}</div>
                      </div>
                      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${status.progress}%` }}
                          className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                        />
                      </div>
                    </div>
                  </div>
                )}
                
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute inset-x-0 bottom-0 bg-red-900/40 text-red-400 p-4 rounded-lg flex items-start gap-3 border border-red-900/50"
                  >
                    <AlertCircle className="w-5 h-5 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold shadow-none uppercase tracking-wider">Processing Error</h4>
                      <p className="text-sm opacity-80">{error}</p>
                    </div>
                  </motion.div>
                )}
                
                {status.videoUrl && !capcutResult && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute inset-x-0 bottom-0 bg-green-900/20 text-green-400 p-4 rounded-lg flex items-center justify-between border border-green-900/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/20 rounded-lg">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm tracking-tight text-green-400">System Ready</h3>
                      </div>
                    </div>
                    <button 
                      onClick={resetAll}
                      className="text-[10px] uppercase font-bold text-slate-400 hover:text-white transition-colors"
                    >
                      Start New Task
                    </button>
                  </motion.div>
                )}
              </div>

              <div className="mt-auto pt-6 border-t border-slate-800/60 break-words mt-6">
                <button
                  onClick={handleUpload}
                  disabled={isProcessing || !audioFile || !csvFile || !zipFile}
                  className={`w-full py-4 text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm ${
                    outputMode === 'capcut' 
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 shadow-[0_0_20px_rgba(99,102,241,0.3)]'
                      : 'bg-blue-600 hover:bg-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.3)]'
                  }`}
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 
                    outputMode === 'capcut' ? <FolderOpen className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isProcessing ? 'PROCESSING...' : 
                    outputMode === 'capcut' ? 'GENERATE CAPCUT PROJECT' : 'GENERATE PRODUCTION VIDEO'}
                </button>
                <p className="text-[10px] text-center text-slate-600 mt-3">Assets are processed locally for maximum privacy and speed.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <footer className="mt-12 text-center">
        <p className="text-[10px] font-mono uppercase opacity-30 tracking-[0.2em]">
          Powered by Gladia • v3.0.0 PRO + CapCut
        </p>
      </footer>
    </div>
  );
}

function FileDrop({ label, description, icon, file, onSelect, colorClass = "" }: any) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div 
      onClick={() => inputRef.current?.click()}
      className={`group relative border-2 border-dashed border-slate-800 hover:border-blue-500/50 bg-[#1A1A1A] rounded-lg p-4 transition-colors cursor-pointer`}
    >
      <input 
        type="file" 
        ref={inputRef} 
        className="hidden" 
        onChange={(e) => onSelect(e.target.files?.[0] || null)}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 rounded flex items-center justify-center ${colorClass}`}>
            {icon}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium text-slate-200 truncate">{file ? file.name : label}</p>
            <p className="text-xs text-slate-500 truncate">{description}</p>
          </div>
        </div>
        <span className={`text-[10px] px-2 py-1 rounded ${file ? 'bg-green-500/20 text-green-400' : 'bg-slate-800 text-slate-400'}`}>
          {file ? 'Selected' : 'Required'}
        </span>
      </div>
    </div>
  );
}
