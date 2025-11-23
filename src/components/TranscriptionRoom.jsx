import React, { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { saveAs } from 'file-saver';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { 
  Settings as SettingsIcon, 
  Mic, 
  MicOff, 
  Monitor,
  StopCircle,
  Download,
  Maximize2,
  Clock,
  Copy,
  Check,
  Bug,
  Activity
} from 'lucide-react';
import AIResponse from './AIResponse';
import Settings from './Settings/Settings.jsx';

const TranscriptionRoom = ({ initialService }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [aiResponses, setAiResponses] = useState([]);
  const processedBlocksRef = useRef(new Set()); // Track blocks that have triggered AI analysis
  const [isAiThinking, setIsAiThinking] = useState(false);
  const socketRef = useRef();
  const audioContextRef = useRef(null);
  const screenStreamRef = useRef(null);
  const lastAnalysisTimeRef = useRef(null);
  const ANALYSIS_INTERVAL = 20000; // 20 seconds
  const [currentSegment, setCurrentSegment] = useState({
    text: '',
    startTime: null,
    timeLeft: 20
  });
  const [screenPreview, setScreenPreview] = useState(null);
  const [selectedService, setSelectedService] = useState(initialService || '');
  const [currentStep, setCurrentStep] = useState('provider'); // 'provider', 'recording', 'transcribing'
  const [isProviderLocked, setIsProviderLocked] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [useRAG, setUseRAG] = useState(() => {
    // Try to load from localStorage, default to false (Original)
    try {
      const saved = localStorage.getItem('ai_analysis_type');
      return saved === 'rag';
    } catch {
      return false;
    }
  }); // false = Original only, true = Document-Enhanced only
  
  // Use ref to always have current useRAG value (avoids closure issues)
  const useRAGRef = useRef(useRAG);
  
  // Update ref when state changes
  useEffect(() => {
    useRAGRef.current = useRAG;
    try {
      localStorage.setItem('ai_analysis_type', useRAG ? 'rag' : 'original');
      console.log(`[CLIENT] Saved analysis type preference: ${useRAG ? 'Document-Enhanced' : 'Original'}`);
    } catch (err) {
      console.warn('Failed to save analysis type preference:', err);
    }
  }, [useRAG]);
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [transcriptBlocks, setTranscriptBlocks] = useState([]);
  const [currentBlock, setCurrentBlock] = useState({
    text: '',
    interim: '',
    startTime: null,
    isComplete: false,
    id: null
  });
  const [selectedAgent, setSelectedAgent] = useState('MEETING_ANALYST');
  const [roomContext, setRoomContext] = useState(null);
  const [historyIdx, setHistoryIdx] = useState(null);
  const [historyStage, setHistoryStage] = useState('idle'); // 'new' | 'warn' | 'idle'
  const [historyCopied, setHistoryCopied] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const sessionStartRef = useRef(null);
  const sessionTimerRef = useRef(null);
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioKbps, setAudioKbps] = useState(0);
  const [chunksPerSec, setChunksPerSec] = useState(0);
  const [dgMetadata, setDgMetadata] = useState(null);
  const [avgLatencyMs, setAvgLatencyMs] = useState(0);
  const [ragAuthenticated, setRagAuthenticated] = useState(() => {
    return localStorage.getItem('rag_authenticated') === 'true';
  });
  const debugStatsRef = useRef({ bytesSent: 0, lastBytes: 0, chunksSent: 0, lastChunks: 0, interimCount: 0, finalCount: 0, lastTick: Date.now(), lastEmitTs: 0, latencies: [] });

  const [debugSettings, setDebugSettings] = useState({
    // feature/context-encoder
    maskedPrediction: false,
    attentionType: 'standard', // standard | relative | conformer | rotary
    multiScale: false,
    // feature/fusion-strategies
    fusionMethod: 'none', // none | concat | geometric | learned
    adaptiveGating: false,
    crossModalAttention: false,
    // feature/noise-augmentation
    noiseMixLevel: 0,
    environmentProfile: 'none', // none | office | cafe | street | car
    realWorldConditions: false,
    // feature/performance-optimization
    latencyTargetMs: 800,
    memoryEfficient: true,
    inferenceSpeedup: true,
    // feature/training-pipeline (placeholders)
    distributedTraining: false,
    mixedPrecision: true,
    gradAccumulation: false,
    // feature/evaluation-metrics
    enableAdvancedWER: true,
    runNoiseRobustness: false,
    enableLatencyProfiling: true,
    // feature/model-compression
    knowledgeDistillation: false,
    quantization: 'none', // none | int8 | fp16
    pruning: false,
  });

  // Helper for a clean overlay caption (recent snippet only)
  const getOverlayText = useCallback(() => {
    const base = `${currentBlock.text ? currentBlock.text + ' ' : ''}${currentBlock.interim || ''}`
      .replace(/\s+/g, ' ')
      .trim();
    if (!base) return '';
    const LIMIT = 220; // characters
    return base.length > LIMIT ? `… ${base.slice(-LIMIT)}` : base;
  }, [currentBlock.text, currentBlock.interim]);

  const cleanupAudioContext = () => {
    try {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.suspend()
          .then(() => {
            if (audioContextRef.current) {  // Check again before closing
              return audioContextRef.current.close();
            }
          })
          .then(() => {
            audioContextRef.current = null;
          })
          .catch((error) => {
            console.warn('Audio context cleanup error:', error);
            audioContextRef.current = null;
          });
      } else {
        audioContextRef.current = null;
      }
    } catch (error) {
      console.warn('Audio context cleanup error:', error);
      audioContextRef.current = null;
    }
  };

  const formatDuration = useCallback((ms) => {
    if (!ms || ms < 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const two = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
  }, []);

  // Confirm before closing an active room and create a fresh room on reload
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isRecording || isScreenSharing) {
        // Show native confirm dialog
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const handlePageHide = () => {
      // User confirmed leaving - clear cached room so a new one is created on next load
      try { sessionStorage.removeItem('desired_room_id'); } catch (_) {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [isRecording, isScreenSharing]);

  useEffect(() => {
    // Enable debug via ?debug=1 or localStorage('debug_mode')
    const params = new URLSearchParams(window.location.search);
    const dbg = params.get('debug') === '1' || localStorage.getItem('debug_mode') === '1';
    setDebugMode(dbg);
    if (dbg) {
      const saved = localStorage.getItem('overlay_visible');
      if (saved !== null) setIsOverlayVisible(saved === '1');
      const handler = (e) => {
        if (e.key.toLowerCase() === 'o') {
          setIsOverlayVisible(v => { const nv = !v; localStorage.setItem('overlay_visible', nv ? '1' : '0'); return nv; });
        }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }

    const inferredUrl = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : undefined;
    const serverUrl = process.env.PUBLIC_SERVER_URL || process.env.REACT_APP_SERVER_URL || inferredUrl || 'http://localhost:5002';
    socketRef.current = io(serverUrl, {
      autoConnect: true,
      query: {
        desiredRoomId: (typeof window !== 'undefined' && sessionStorage.getItem('desired_room_id')) || ''
      }
    });

    socketRef.current.on('connect', () => {
      const socketId = socketRef.current.id;
      setRoomId(socketId);
      try { sessionStorage.setItem('desired_room_id', socketId); } catch (_) {}
      window.history.pushState({}, '', `/${socketId}`);
    });

    // Timer for countdown
    const countdownInterval = setInterval(() => {
      setCurrentSegment(prev => {
        if (!prev.startTime) return prev;
        const elapsed = (Date.now() - prev.startTime) / 1000;
        const timeLeft = Math.max(0, 20 - Math.floor(elapsed));
        return { ...prev, timeLeft };
      });
    }, 1000);

    socketRef.current.on('transcription', (transcription) => {
      console.log('Received transcription:', transcription);
      
      if (!transcription?.text) return;

      const isFinal = Boolean(transcription.isFinal);
      const utteranceEnd = Boolean(transcription.speechFinal);
      const txt = transcription.text.trim();
      if (!txt) return;

      // Debug stats & metadata
      try {
        if (isFinal) debugStatsRef.current.finalCount += 1; else debugStatsRef.current.interimCount += 1;
        if (transcription.metadata) setDgMetadata(transcription.metadata);
        if (debugStatsRef.current.lastEmitTs) {
          const latency = Date.now() - debugStatsRef.current.lastEmitTs;
          const arr = debugStatsRef.current.latencies;
          arr.push(latency);
          if (arr.length > 20) arr.shift();
          const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
          setAvgLatencyMs(avg);
        }
      } catch (_) {}

      setCurrentBlock(prev => {
        // Start block if needed
        const now = Date.now();
        const shouldRotate = prev.startTime && now - prev.startTime > 20000;
        if (!prev.startTime || prev.isComplete || shouldRotate) {
          if (prev.text || prev.interim) {
            setTranscriptBlocks(blocks => {
              const newId = prev.id || `${Date.now()}_${blocks.length}`;
              const next = [...blocks, { ...prev, isComplete: true, id: newId }];
              setHistoryIdx(next.length - 1);
              // Flash green, then hold yellow until the next finalized item arrives
              setHistoryStage('new');
              setTimeout(() => setHistoryStage('warn'), 1500);
              // Trigger AI analysis for this finalized block
              try {
                // Prevent duplicate AI analysis for the same block
                if (!processedBlocksRef.current.has(newId)) {
                  processedBlocksRef.current.add(newId);
                  // Use ref to get current value (avoids closure stale value issue)
                  const currentUseRAG = useRAGRef.current;
                  // Use socket ID directly as roomId (more reliable than state)
                  const currentRoomId = socketRef.current?.id || roomId;
                  console.log(`[CLIENT] Emitting process_with_ai event for block ${newId}`);
                  console.log(`   Text length: ${(prev.text + (prev.interim ? ` ${prev.interim}` : '')).trim().length} chars`);
                  console.log(`   Agent: ${selectedAgent}`);
                  console.log(`   RoomId: ${currentRoomId || 'EMPTY!'}`);
                  console.log(`   useRAG: ${currentUseRAG} (${currentUseRAG ? 'Document-Enhanced' : 'Original'})`);
                socketRef.current.emit('process_with_ai', { 
                  text: (prev.text + (prev.interim ? ` ${prev.interim}` : '')).trim(),
                  roomId: currentRoomId, // Use socket ID directly
                  agentType: selectedAgent,
                  blockId: newId,
                  useRAG: Boolean(currentUseRAG) // Use ref value to ensure current state
                });
                } else {
                  console.log(`[CLIENT] Skipping duplicate analysis for block ${newId}`);
                }
              } catch (err) {
                console.error(`[X] [CLIENT] Error emitting process_with_ai:`, err);
              }
              return next;
            });
          }
          return {
            text: isFinal ? txt : '',
            interim: isFinal ? '' : txt,
            startTime: now,
            isComplete: false,
            id: `${now}_${Math.random().toString(36).slice(2,8)}`,
          };
        }

        // Update existing block
        if (isFinal) {
          const combined = prev.text
            ? (prev.text.endsWith('.') ? prev.text + ' ' + txt : prev.text + ' ' + txt)
            : txt;
          return { ...prev, text: combined, interim: '' };
        } else if (utteranceEnd) {
          // Promote interim as a finished sentence when Deepgram marks utterance end
          const combined = prev.text
            ? (prev.text.endsWith('.') ? prev.text + ' ' + txt : prev.text + ' ' + txt)
            : txt;
          return { ...prev, text: combined, interim: '' };
        } else {
          return { ...prev, interim: txt };
        }
      });
    });

    // Add error handling
    socketRef.current.on('transcription_error', (error) => {
      console.error('Transcription error:', error);
      alert(`Transcription error: ${error.message}`);
    });

    // Debug bandwidth/chunk metrics ticker
    const dbgTicker = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.max(1, (now - (debugStatsRef.current.lastTick || now)) / 1000);
      const bytesDelta = debugStatsRef.current.bytesSent - (debugStatsRef.current.lastBytes || 0);
      const chunksDelta = debugStatsRef.current.chunksSent - (debugStatsRef.current.lastChunks || 0);
      setAudioKbps(Math.round((bytesDelta * 8) / 1000 / elapsed));
      setChunksPerSec(Math.round(chunksDelta / elapsed));
      debugStatsRef.current.lastBytes = debugStatsRef.current.bytesSent;
      debugStatsRef.current.lastChunks = debugStatsRef.current.chunksSent;
      debugStatsRef.current.lastTick = now;
    }, 1000);

    // DISABLED: Interval-based processing to prevent duplicate analysis
    // AI analysis now happens immediately when finalized blocks are created (line 256)
    // This prevents duplicate calls and ensures RAG integration works correctly
    const analysisInterval = null; // Disabled to prevent duplicate analysis
    // const analysisInterval = setInterval(() => {
    //   setCurrentSegment(prev => {
    //     if (prev.text.trim()) {
    //       processTranscriptionWithAI(prev.text);
    //       return { text: '', startTime: null, timeLeft: 20 };
    //     }
    //     return prev;
    //   });
    // }, ANALYSIS_INTERVAL);

    socketRef.current.on('ai_response', (response) => {
      console.log(`[CLIENT] Received ai_response:`, response);
      console.log(`   Analysis Type: ${response.analysisType}`);
      console.log(`   RAG Used: ${response.ragUsed}`);
      console.log(`   RAG Sources: ${response.ragSources?.length || 0}`);
      console.log(`   BlockId: ${response.blockId}`);
      
      // Attach response to a specific block if blockId is provided
      if (response.blockId) {
        // Handle RAG responses with -rag suffix
        const isRagResponse = response.blockId.endsWith('-rag');
        const originalBlockId = isRagResponse ? response.blockId.replace(/-rag$/, '') : response.blockId;
        
        const aiResponseData = {
                text: response.text,
          timestamp: response.timestamp || new Date().toISOString(),
                isError: response.isError,
                agent: response.agent,
                roomContext: response.roomContext,
          isFormatted: response.isFormatted,
          analysisType: response.analysisType,
          ragUsed: response.ragUsed,
          ragSources: response.ragSources,
          ragTag: response.ragTag,
          tags: response.tags,
          tagMetadata: response.tagMetadata
        };
        
        setTranscriptBlocks(prev => prev.map(b => {
          if (b.id === originalBlockId) {
            if (isRagResponse) {
              // Store RAG response separately
              return { ...b, aiRag: aiResponseData };
            } else {
              // Store original response
              return { ...b, ai: aiResponseData };
            }
          }
          return b;
        }));
      } else {
        setAiResponses(prev => [...prev, {
          text: response.text,
          timestamp: response.timestamp || new Date().toISOString(),
          isError: response.isError,
          isMock: response.isMock,
          agent: response.agent,
          roomContext: response.roomContext,
          isFormatted: response.isFormatted,
          analysisType: response.analysisType,
          ragUsed: response.ragUsed,
          ragSources: response.ragSources,
          ragTag: response.ragTag,
          tags: response.tags,
          tagMetadata: response.tagMetadata
        }]);
      }
      setIsAiThinking(false);
      
      // Update room context if provided
      if (response.roomContext) {
        setRoomContext(response.roomContext);
      }
    });

    socketRef.current.on('agent_switched', ({ agentType }) => {
      console.log(`AI Agent switched to: ${agentType}`);
    });

    return () => {
      cleanupAudioContext();
      clearInterval(countdownInterval);
      if (analysisInterval) clearInterval(analysisInterval); // Safely clear if exists
      clearInterval(dbgTicker);
      if (socketRef.current) {
        window.history.pushState({}, '', '/');
        socketRef.current.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (selectedService && socketRef.current?.id) {
      window.history.pushState(
        {}, 
        '', 
        `/${socketRef.current.id}_${selectedService}`
      );
    } else if (socketRef.current?.id) {
      window.history.pushState(
        {}, 
        '', 
        `/${socketRef.current.id}`
      );
    }
  }, [selectedService]);

  const processTranscriptionWithAI = async (text) => {
    if (!text.trim()) return;
    setIsAiThinking(true);
    socketRef.current.emit('process_with_ai', { 
      text, 
      roomId,
      agentType: selectedAgent 
    });
  };

  const startScreenShare = async () => {
    try {
      // Guard: Screen Capture API requires a secure context (HTTPS) or localhost
      const secure = (typeof window !== 'undefined' && (window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost'));
      const hasAPI = typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
      if (!secure || !hasAPI) {
        const why = !secure ? 'This page is not served over HTTPS (secure context).' : 'Screen Capture API is not available in this browser.';
        alert(`Screen sharing is unavailable: ${why}\n\nUse an HTTPS URL (or localhost) and a modern Chromium/Firefox browser.`);
        // Fallback: start mic-only recording if possible
        await startRecording();
        return;
      }

      setIsProviderLocked(true);
      setCurrentStep('transcribing');
      // Start session timer
      sessionStartRef.current = Date.now();
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = setInterval(() => {
        setSessionElapsedMs(Date.now() - sessionStartRef.current);
      }, 1000);
      
      if (socketRef.current?.id && selectedService) {
        window.history.pushState(
          {}, 
          '', 
          `/${socketRef.current.id}_${selectedService}`
        );
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
          channelCount: 1,
          autoGainControl: true,
          sampleSize: 16,
          latency: 0
        }
      }).catch(error => {
        if (error.name === 'NotAllowedError') {
          throw new Error('Please select a tab to complete step 2');
        }
        throw error;
      });

      setScreenPreview(stream);
      screenStreamRef.current = stream;

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No audio track found in screen share');
      }

      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(new MediaStream([audioTrack]));
      
      // Add noise gate to filter out background noise
      const noiseGate = audioContextRef.current.createDynamicsCompressor();
      noiseGate.threshold.value = -50;
      noiseGate.knee.value = 40;
      noiseGate.ratio.value = 12;
      noiseGate.attack.value = 0;
      noiseGate.release.value = 0.25;
      
      // Add gain control
      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = 1.5;

      // Load and initialize the AudioWorklet
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.worklet.js');
      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      
      source.connect(noiseGate);
      noiseGate.connect(gainNode);
      gainNode.connect(workletNode);
      workletNode.connect(audioContextRef.current.destination);

      workletNode.port.onmessage = (event) => {
        const { audioData } = event.data;
        if (audioData) {
          // Convert Float32Array to Int16Array
          const float32Array = new Float32Array(audioData);
          const int16Array = new Int16Array(float32Array.length);
          
          for (let i = 0; i < float32Array.length; i++) {
            // Apply noise gate
            let sample = float32Array[i];
            if (Math.abs(sample) < 0.01) {
              sample = 0;
            }
            
            // Convert to 16-bit PCM
            const s = Math.max(-1, Math.min(1, sample));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          const bytes = int16Array.byteLength;
          debugStatsRef.current.bytesSent += bytes;
          debugStatsRef.current.chunksSent += 1;
          debugStatsRef.current.lastEmitTs = Date.now();
          // simple audio level meter (RMS approximation)
          let sum = 0;
          for (let i = 0; i < int16Array.length; i += 32) {
            const v = int16Array[i] / 32767;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / Math.max(1, Math.floor(int16Array.length / 32)));
          setAudioLevel(prev => 0.8 * prev + 0.2 * rms);

          socketRef.current.emit('audio_data', {
            roomId,
            audio: int16Array.buffer,
            isScreenShare: true,
            service: selectedService
          });
        }
      };

      // Start recording automatically when screen sharing starts
      if (selectedService === 'google') {
        await startRecording(stream);
      }

      socketRef.current.emit('start_transcription', { 
        roomId,
        service: selectedService 
      });
      setIsScreenSharing(true);

      // Handle screen share stop
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (error) {
      console.error('Error starting screen share:', error);
      alert('Error starting screen share: ' + error.message);
      setIsProviderLocked(false);
      setCurrentStep('recording');
    }
  };

  const stopScreenShare = () => {
    try {
      // Stop screen share stream
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      
      // Cleanup video element
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      
      // Stop recording if using Google service
      if (selectedService === 'google' && isRecording) {
        stopRecording();
      }
      
      cleanupAudioContext();
      
      // Reset AI analysis state
      setIsAiThinking(false);
      setCurrentSegment({
        text: '',
        startTime: null,
        timeLeft: 20
      });
      
      // Stop transcription and AI processing
      socketRef.current.emit('stop_transcription', roomId);
      socketRef.current.emit('stop_ai_processing', roomId);
      
      setIsScreenSharing(false);
      setScreenPreview(null);
      // Stop session timer
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
      sessionStartRef.current = null;
      setSessionElapsedMs(0);
      
      // Reset back to step 1
      setIsProviderLocked(false);
      setCurrentStep('provider');
      setSelectedService('');
    } catch (error) {
      console.error('Error stopping screen share:', error);
    }
  };

  const startRecording = async (existingStream = null) => {
    try {
      // Start session timer if not already running
      if (!sessionStartRef.current) {
        sessionStartRef.current = Date.now();
        if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = setInterval(() => {
          setSessionElapsedMs(Date.now() - sessionStartRef.current);
        }, 1000);
      }

      const stream = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);

      // Load and initialize the AudioWorklet
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.worklet.js');
      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      
      source.connect(workletNode);
      workletNode.connect(audioContextRef.current.destination);

      workletNode.port.onmessage = (event) => {
        const { audioData } = event.data;
        if (audioData) {
          // Convert Float32Array to Int16Array
          const float32Array = new Float32Array(audioData);
          const int16Array = new Int16Array(float32Array.length);
          
          for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          const bytes = int16Array.byteLength;
          debugStatsRef.current.bytesSent += bytes;
          debugStatsRef.current.chunksSent += 1;
          // quick level
          let sum = 0;
          for (let i = 0; i < int16Array.length; i += 32) {
            const v = int16Array[i] / 32767;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / Math.max(1, Math.floor(int16Array.length / 32)));
          setAudioLevel(prev => 0.8 * prev + 0.2 * rms);

          socketRef.current.emit('audio_data', {
            roomId,
            audio: int16Array.buffer,
            isScreenShare: !!existingStream,
            service: selectedService
          });
        }
      };

      socketRef.current.emit('start_transcription', { 
        roomId,
        service: selectedService 
      });
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error starting recording: ' + error.message);
    }
  };

  const stopRecording = () => {
    try {
      cleanupAudioContext();
      socketRef.current.emit('stop_transcription', roomId);
      setIsRecording(false);
      // Stop session timer if screen share is not active
      if (!isScreenSharing) {
        if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
        sessionStartRef.current = null;
        setSessionElapsedMs(0);
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  };

  const exportTranscript = () => {
    // Combine all completed blocks and current block
    const allBlocks = [...transcriptBlocks];
    if (currentBlock.text) {
      allBlocks.push(currentBlock);
    }
    
    const text = allBlocks.map(block => block.text).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `transcript-${roomId}-${new Date().toLocaleDateString()}.txt`);
  };

  useEffect(() => {
    if (!window.AudioContext) {
      console.warn('AudioContext is not supported in this browser');
    } else if (!window.AudioWorklet) {
      console.warn('AudioWorklet is not supported in this browser, falling back to ScriptProcessor');
    }
  }, []);

  const StepIndicator = () => {
    return (
      <div className="flex items-center gap-2 mb-4">
        <Badge variant={currentStep === 'provider' ? 'default' : 'secondary'}>
          1. Select Provider
        </Badge>
        <Badge variant={currentStep === 'recording' ? 'default' : 'secondary'}>
          2. Start Recording
        </Badge>
        <Badge variant={currentStep === 'transcribing' ? 'default' : 'secondary'}>
          3. Transcribing
        </Badge>
      </div>
    );
  };

  const aiResponsesRef = useRef(null);
  const transcriptsRef = useRef(null);

  const scrollToBottom = () => {
    if (isAutoScrollEnabled) {
      if (aiResponsesRef.current) {
        aiResponsesRef.current.scrollTop = aiResponsesRef.current.scrollHeight;
      }
      if (transcriptsRef.current) {
        transcriptsRef.current.scrollTop = transcriptsRef.current.scrollHeight;
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [aiResponses, transcriptBlocks, currentBlock]);

  const toggleFullscreen = useCallback(() => {
    if (!videoRef.current) return;

    if (!document.fullscreenElement) {
      videoRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      if (screenPreview) {
        videoRef.current.srcObject = screenPreview;
      } else {
        // Properly cleanup video element
        if (videoRef.current.srcObject) {
          const tracks = videoRef.current.srcObject.getTracks();
          tracks.forEach(track => track.stop());
          videoRef.current.srcObject = null;
        }
      }
    }
  }, [screenPreview]);

  const CopyButton = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    };

    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn("absolute top-2 right-2", copied && "text-green-500")}
        onClick={handleCopy}
      >
        {copied ? (
          <>
            <Check className="h-4 w-4 mr-1" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-4 w-4 mr-1" />
            Copy
          </>
        )}
      </Button>
    );
  };

  const renderTranscripts = () => {
    if (transcriptBlocks.length === 0 && !currentBlock.text) {
      return (
        <div className="text-center text-muted-foreground py-12">
          <p>Start recording or share your screen to begin transcription...</p>
        </div>
      );
    }

    const renderFormattedText = (text) => {
      // Split by double newlines to get separate speakers
      const speakerSegments = text.split('\n\n').filter(segment => segment.trim());
      
      // If only one segment (no speaker changes), display as continuous text
      if (speakerSegments.length === 1) {
        const segment = speakerSegments[0];
        const speakerMatch = segment.match(/^Speaker (\d+): /);
        const speakerNum = speakerMatch ? parseInt(speakerMatch[1]) : 0;
        const textWithoutSpeaker = speakerMatch 
          ? segment.substring(speakerMatch[0].length)
          : segment;
        
        return (
          <div className="space-y-2">
            {speakerMatch && (
              <Badge variant="outline" className="mb-2">
                Speaker {speakerNum}
              </Badge>
            )}
            <p className="text-sm leading-relaxed">{textWithoutSpeaker}</p>
          </div>
        );
      }
      
      // Multiple speakers - show each separately
      return speakerSegments.map((segment, idx) => {
        const speakerMatch = segment.match(/^Speaker (\d+): /);
        const speakerNum = speakerMatch ? parseInt(speakerMatch[1]) : 0;
        const textWithoutSpeaker = speakerMatch 
          ? segment.substring(speakerMatch[0].length)
          : segment;
        
        return (
          <div key={idx} className="space-y-2 mb-4">
            {speakerMatch && (
              <Badge variant="outline" className="mb-2">
                Speaker {speakerNum}
              </Badge>
            )}
            <p className="text-sm leading-relaxed">{textWithoutSpeaker}</p>
          </div>
        );
      });
    };

    return (
      <>
        {transcriptBlocks.map((block, index) => (
          <Card key={index} className="mb-4 relative">
            <CardContent className="pt-6">
              {renderFormattedText(block.text)}
            </CardContent>
            <CopyButton text={block.text} />
          </Card>
        ))}
        {currentBlock.text && (
          <Card className="mb-4 border-primary/50">
            <CardContent className="pt-6">
              {renderFormattedText(currentBlock.text)}
            </CardContent>
          </Card>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="max-w-[1600px] mx-auto">
        {/* Header: Enterprise quick polish */}
        <div className="flex items-center justify-between mb-6 py-2">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-lg font-semibold tracking-tight">ASR SyncScribe</div>
              <div className="text-xs text-muted-foreground">Room • {roomId || '—'}</div>
            </div>
            <div className="hidden md:flex items-center gap-2 pl-4 border-l border-border/60">
              <Badge variant="secondary">
                {selectedService === 'deepgram' ? 'Deepgram' : selectedService === 'openai' ? 'OpenAI' : selectedService === 'google' ? 'Google Cloud' : 'Provider'}
              </Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${isRecording || isScreenSharing ? 'bg-green-500 animate-pulse' : 'bg-orange-500'}`} />
                {isRecording || isScreenSharing ? 'Live' : 'Idle'}
              </span>
              <span className="text-xs text-muted-foreground">{formatDuration(sessionElapsedMs)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 1500);
                } catch (e) {}
              }}
              title="Copy room link"
            >
              {linkCopied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}Copy Link
            </Button>
            {(transcriptBlocks.length > 0 || currentBlock.text) && (
              <Button variant="outline" size="sm" onClick={exportTranscript}>
                <Download className="h-4 w-4 mr-2" />Export
              </Button>
            )}
            <Settings 
              selectedService={selectedService}
              setSelectedService={setSelectedService}
              currentStep={currentStep}
              setCurrentStep={setCurrentStep}
              isProviderLocked={isProviderLocked}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              roomContext={roomContext}
              socket={socketRef.current}
              roomId={roomId}
              onRAGAuthChange={setRagAuthenticated}
            />
          </div>
        </div>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Panel - Transcription */}
          <div className="lg:col-span-4">
            <Card className="h-[calc(100vh-8rem)]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">Live Transcription</CardTitle>
                  <Badge variant={isRecording || isScreenSharing ? "destructive" : "secondary"}>
                    {isRecording || isScreenSharing ? (
                      <>
                        <span className="h-2 w-2 bg-red-500 rounded-full mr-2 animate-pulse" />
                        Recording
                      </>
                    ) : (
                      "Ready"
                    )}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col h-[calc(100%-5rem)]">
                {/* Screen Preview */}
                <div className="mb-4">
                  <Card className="overflow-hidden">
                    <div className="relative aspect-video bg-muted">
                      {screenPreview ? (
                        <>
                          <video 
                            ref={videoRef}
                            autoPlay 
                            muted 
                            playsInline
                            className="w-full h-full object-contain"
                          />
                          <div className="absolute top-2 left-2 flex gap-2">
                            <Badge variant="destructive">
                              <span className="h-2 w-2 bg-red-500 rounded-full mr-2 animate-pulse" />
                              Live
                            </Badge>
                            <Badge variant="secondary">
                              {selectedService === 'deepgram' ? 'Deepgram' : 
                               selectedService === 'openai' ? 'OpenAI' : 'Google Cloud'}
                            </Badge>
                          </div>
                          {debugMode && isOverlayVisible && (currentBlock.text || currentBlock.interim) && (
                            <div className="absolute bottom-12 left-2 right-12">
                              <div className="mx-auto max-w-3xl bg-black/65 backdrop-blur-sm rounded-lg border border-white/10 shadow-lg">
                                <p className="px-3 py-2 text-white text-sm leading-relaxed">
                                  {getOverlayText()}
                                </p>
                              </div>
                            </div>
                          )}
                          {debugMode && (
                            <div className="absolute top-2 right-2">
                              <Button size="sm" variant={isOverlayVisible ? 'secondary' : 'outline'} onClick={() => setIsOverlayVisible(v => { const nv = !v; localStorage.setItem('overlay_visible', nv ? '1' : '0'); return nv; })} title="Toggle overlay (O)">
                                {isOverlayVisible ? 'Overlay On' : 'Overlay Off'}
                              </Button>
                            </div>
                          )}
                          <div className="absolute bottom-2 right-2 flex gap-2">
                            <Button size="sm" variant="secondary" onClick={stopScreenShare}>
                              <StopCircle className="h-4 w-4 mr-1" />
                              Stop
                            </Button>
                            <Button size="icon" variant="secondary" onClick={toggleFullscreen}>
                              <Maximize2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          {currentStep === 'provider' ? (
                            <div className="text-center p-4">
                              <SettingsIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                              <p className="text-muted-foreground">Please select a provider first</p>
                            </div>
                          ) : (
                            <Button
                              onClick={startScreenShare}
                              disabled={!selectedService}
                              size="lg"
                            >
                              <Monitor className="h-5 w-5 mr-2" />
                              Share Screen/Tab
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                {/* Transcripts */}
                <ScrollArea className="flex-1 pr-4" ref={transcriptsRef}>
                  {/* Live transcription pinned at top */}
                  {(isRecording || isScreenSharing) && (
                    <div className="mb-3 p-2 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-lg border border-primary/20">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
                          <span className="text-sm font-medium">Live Transcription</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {selectedService === 'deepgram' ? 'Deepgram' : 
                             selectedService === 'openai' ? 'OpenAI' : 'Google Cloud'}
                          </Badge>
                          {currentBlock.metadata?.speechRate && (
                            <Badge variant="secondary" className="text-xs">
                              {Math.round(currentBlock.metadata.speechRate * 60)} wpm
                            </Badge>
                          )}
                          {currentBlock.metadata?.hasFillerWords && (
                            <Badge variant="secondary" className="text-xs">Filler Words</Badge>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {/* Constrained, scrollable live text so controls stay visible */}
                        <div className="rounded-md bg-secondary/50 border border-border/40">
                          <ScrollArea className="h-28 md:h-36 no-scrollbar">
                            <div className="p-2">
                              <p className="text-xs leading-relaxed whitespace-pre-wrap">
                                {(currentBlock.text + (currentBlock.interim ? ` ${currentBlock.interim}` : '')).trim() || "Listening..."}
                              </p>
                            </div>
                          </ScrollArea>
                        </div>
                        {currentBlock.metadata?.sentiment && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                            <Badge variant={
                              currentBlock.metadata.sentiment === 'positive' ? 'success' :
                              currentBlock.metadata.sentiment === 'negative' ? 'destructive' :
                              'secondary'
                            }>
                              {currentBlock.metadata.sentiment}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Horizontal carousel for finalized blocks */}
                  {transcriptBlocks.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">History</span>
                        <div className="flex gap-2">
                          <Badge variant="secondary" className="text-xs">{(historyIdx ?? (transcriptBlocks.length-1)) + 1} / {transcriptBlocks.length}</Badge>
                          <Button variant="secondary" size="sm" onClick={() => setHistoryIdx(idx => Math.max(0, (idx ?? transcriptBlocks.length-1) - 1))}>Prev</Button>
                          <Button variant="secondary" size="sm" onClick={() => setHistoryIdx(idx => Math.min(transcriptBlocks.length - 1, (idx ?? transcriptBlocks.length-1) + 1))}>Next</Button>
                        </div>
                      </div>
                      <Card
                        className={`relative group cursor-pointer transition-colors duration-500 ${historyStage==='new' ? 'border-green-400' : historyStage==='warn' ? 'border-yellow-400' : ''}`}
                        onClick={async () => {
                          const text = transcriptBlocks[historyIdx ?? (transcriptBlocks.length-1)]?.text || '';
                          try {
                            await navigator.clipboard.writeText(text);
                            setHistoryCopied(true);
                            setTimeout(() => setHistoryCopied(false), 1200);
                          } catch (e) {}
                        }}
                        title="Click to copy"
                      >
                        <CardContent className="pt-6">
                          <ScrollArea className="max-h-60 md:max-h-72 no-scrollbar pr-2">
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                              {transcriptBlocks[historyIdx ?? (transcriptBlocks.length-1)]?.text}
                            </p>
                          </ScrollArea>
                        </CardContent>
                        {/* Copy overlay feedback */}
                        <div className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${historyCopied ? 'opacity-100' : 'opacity-0'} bg-black/30 rounded-lg`}>
                          <span className="text-xs px-2 py-1 rounded bg-black/70 text-white border border-white/20">Copied</span>
                        </div>
                        {/* Hover hint */}
                        <div className="pointer-events-none absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xs text-muted-foreground">Click to copy</div>
                      </Card>
                    </div>
                  )}
                </ScrollArea>

                {/* Export Button */}
                {(transcriptBlocks.length > 0 || currentBlock.text) && (
                  <div className="mt-4">
                    <Button 
                      onClick={exportTranscript} 
                      variant="secondary"
                      className="w-full"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export Transcript
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - AI Analysis */}
          <div className="lg:col-span-8">
            <Card className="h-[calc(100vh-8rem)]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">AI Analysis</CardTitle>
                  <div className="flex items-center gap-4">
                    {currentSegment.startTime && (
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {currentSegment.timeLeft}s until analysis
                        </span>
                        <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary transition-all duration-1000 ease-linear"
                            style={{ width: `${(currentSegment.timeLeft / 20) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isAutoScrollEnabled}
                          onChange={(e) => setIsAutoScrollEnabled(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm text-muted-foreground">Auto Scroll</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">AI Analysis:</span>
                        <select
                          value={useRAG ? 'rag' : 'original'}
                          onChange={(e) => {
                            const newValue = e.target.value === 'rag';
                            console.log(`[CLIENT] Changing analysis type: ${newValue ? 'Document-Enhanced' : 'Original'}`);
                            setUseRAG(newValue);
                          }}
                          className="text-sm bg-background border border-border rounded px-2 py-1 cursor-pointer"
                        >
                          <option value="original">Original</option>
                          <option value="rag">Document-Enhanced</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <CardDescription>
                  {currentSegment.startTime 
                    ? "Collecting conversation context..."
                    : "Waiting for conversation to begin..."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[calc(100vh-16rem)]" ref={aiResponsesRef}>
                  {(() => {
                    const idx = historyIdx ?? (transcriptBlocks.length - 1);
                    const block = transcriptBlocks[idx];
                    const ai = block?.ai;
                    const aiRag = block?.aiRag;
                    
                    if (ai || aiRag) {
                      return (
                        <div className="space-y-4">
                          {ai && (
                          <Card>
                            <CardContent className="pt-6">
                              <AIResponse response={ai} />
                            </CardContent>
                          </Card>
                          )}
                          {aiRag && ragAuthenticated && (
                            <Card>
                              <CardContent className="pt-6">
                                <AIResponse response={aiRag} />
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      );
                    }
                    return (
                      aiResponses.length === 0 ? (
                        <div className="text-center text-muted-foreground py-12">
                          <p>Analysis will appear every 20 seconds.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {(() => {
                            const filtered = aiResponses.filter(response => {
                              // Hide Document-Enhanced responses if not authenticated
                              if (response.analysisType === 'document-enhanced' && !ragAuthenticated) {
                                return false;
                              }
                              // Filter by selected analysis type
                              if (useRAG && response.analysisType !== 'document-enhanced') {
                                console.log(`[CLIENT] Filtering out ${response.analysisType} response (user wants Document-Enhanced)`);
                                return false; // User wants Document-Enhanced, hide Original
                              }
                              if (!useRAG && response.analysisType !== 'original') {
                                console.log(`[CLIENT] Filtering out ${response.analysisType} response (user wants Original)`);
                                return false; // User wants Original, hide Document-Enhanced
                              }
                              return true;
                            });
                            console.log(`[CLIENT] Filtered responses: ${filtered.length} of ${aiResponses.length} (useRAG=${useRAG})`);
                            return filtered;
                          })()
                            .map((response, index) => {
                            return (
                            <Card key={index}>
                              <CardContent className="pt-6">
                                <AIResponse response={response} />
                              </CardContent>
                            </Card>
                            );
                          })}
                        </div>
                      )
                    );
                  })()}
                  {isAiThinking && (
                    <Card className="mt-4">
                      <CardContent className="pt-6">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          Analyzing recent conversation...
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Footer debug floating button */}
      <div className="fixed bottom-4 right-4 flex items-center gap-2 z-50">
        <Button
          variant={debugPanelOpen ? 'destructive' : 'secondary'}
          size="icon"
          title="Debug tools"
          onClick={() => setDebugPanelOpen(v => !v)}
        >
          <Bug className="h-5 w-5 text-red-500" />
        </Button>
      </div>

      {/* Debug side panel */}
      {debugPanelOpen && (
        <div className="fixed bottom-16 right-4 w-[340px] max-h-[70vh] bg-background/95 backdrop-blur border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">ASR Debug</span>
            </div>
            <Badge variant="secondary">{selectedService || '—'}</Badge>
          </div>
          <div className="p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Audio level</span>
              <div className="w-40 h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.round(audioLevel*100))}%` }} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Uplink</span>
              <span>{audioKbps} kbps • {chunksPerSec} chunks/s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Interim / Final</span>
              <span>{debugStatsRef.current.interimCount} / {debugStatsRef.current.finalCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Avg transcript latency</span>
              <span>{avgLatencyMs} ms</span>
            </div>
            {dgMetadata && (
              <div className="mt-2">
                <div className="text-muted-foreground mb-1">Deepgram</div>
                <pre className="bg-muted/40 rounded p-2 overflow-auto max-h-40">{JSON.stringify(dgMetadata, null, 2)}</pre>
              </div>
            )}
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Overlay captions</span>
                <Button size="sm" variant={isOverlayVisible ? 'secondary' : 'outline'} onClick={() => setIsOverlayVisible(v => { const nv = !v; localStorage.setItem('overlay_visible', nv ? '1' : '0'); return nv; })}>
                  {isOverlayVisible ? 'On' : 'Off'}
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">Auto scroll</span>
                <Button size="sm" variant={isAutoScrollEnabled ? 'secondary' : 'outline'} onClick={() => setIsAutoScrollEnabled(v => !v)}>
                  {isAutoScrollEnabled ? 'On' : 'Off'}
                </Button>
              </div>
              {/* Advanced toggles (placeholders wiring) */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.maskedPrediction} onChange={(e)=>setDebugSettings(s=>({...s, maskedPrediction:e.target.checked}))} /> Masked prediction</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.multiScale} onChange={(e)=>setDebugSettings(s=>({...s, multiScale:e.target.checked}))} /> Multi-scale</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.adaptiveGating} onChange={(e)=>setDebugSettings(s=>({...s, adaptiveGating:e.target.checked}))} /> Adaptive gating</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.crossModalAttention} onChange={(e)=>setDebugSettings(s=>({...s, crossModalAttention:e.target.checked}))} /> Cross-modal attention</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.realWorldConditions} onChange={(e)=>setDebugSettings(s=>({...s, realWorldConditions:e.target.checked}))} /> Real-world conditions</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.memoryEfficient} onChange={(e)=>setDebugSettings(s=>({...s, memoryEfficient:e.target.checked}))} /> Memory efficient</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.inferenceSpeedup} onChange={(e)=>setDebugSettings(s=>({...s, inferenceSpeedup:e.target.checked}))} /> Inference speedup</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.enableAdvancedWER} onChange={(e)=>setDebugSettings(s=>({...s, enableAdvancedWER:e.target.checked}))} /> Advanced WER</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.runNoiseRobustness} onChange={(e)=>setDebugSettings(s=>({...s, runNoiseRobustness:e.target.checked}))} /> Noise robustness</label>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={debugSettings.enableLatencyProfiling} onChange={(e)=>setDebugSettings(s=>({...s, enableLatencyProfiling:e.target.checked}))} /> Latency profiling</label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span>Noise mix level</span>
                  <input type="range" min="0" max="100" value={debugSettings.noiseMixLevel} onChange={(e)=>setDebugSettings(s=>({...s, noiseMixLevel: Number(e.target.value)}))} />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span>Latency target</span>
                  <input className="w-16 bg-transparent border rounded px-1 py-0.5" type="number" min="100" max="3000" value={debugSettings.latencyTargetMs} onChange={(e)=>setDebugSettings(s=>({...s, latencyTargetMs: Number(e.target.value)}))} />
                </div>
                <div className="flex items-center justify-between text-[11px] col-span-2">
                  <span>Environment</span>
                  <select className="bg-transparent border rounded px-1 py-0.5" value={debugSettings.environmentProfile} onChange={(e)=>setDebugSettings(s=>({...s, environmentProfile:e.target.value}))}>
                    <option value="none">None</option>
                    <option value="office">Office</option>
                    <option value="cafe">Cafe</option>
                    <option value="street">Street</option>
                    <option value="car">Car</option>
                  </select>
                </div>
                <div className="flex items-center justify-between text-[11px] col-span-2">
                  <span>Quantization</span>
                  <select className="bg-transparent border rounded px-1 py-0.5" value={debugSettings.quantization} onChange={(e)=>setDebugSettings(s=>({...s, quantization:e.target.value}))}>
                    <option value="none">None</option>
                    <option value="int8">INT8</option>
                    <option value="fp16">FP16</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptionRoom; 