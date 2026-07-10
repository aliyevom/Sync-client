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
  Activity,
  Columns3,
  ArrowLeft,
  Terminal,
  Network,
  Users,
  Eye,
  EyeOff
} from 'lucide-react';
import AIResponse from './AIResponse';
import Settings from './Settings/Settings.jsx';
import CodeDeepDive from './CodeDeepDive';
import SystemDesignViewer from './SystemDesignViewer';

// ── Speaker roles + capture modes (Phase 3/4) ──────────────────────────────
const SPEAKER_ROLES = ['unknown', 'me', 'interviewer', 'customer', 'instructor', 'student'];
const CAPTURE_MODES = [
  { id: 'everyone', label: 'Capture everyone' },
  { id: 'ignore_self', label: 'Ignore myself' },
  { id: 'only_interviewer', label: 'Only interviewer/customer' },
  { id: 'coach', label: 'Private coach mode' },
];
const DEFAULT_TRANSCRIPTION_SERVICE = 'speechmatics';

const getServiceLabel = (service) => ({
  speechmatics: 'Speechmatics',
  deepgram: 'Deepgram',
  openai: 'OpenAI',
  google: 'Google Cloud',
}[service] || 'No provider');

const isSelfSpeakerId = (id) => String(id || '').toLowerCase() === 'me';

const formatSpeakerDisplayName = (id, fallbackIndex = 0) => {
  const value = String(id ?? '');
  if (isSelfSpeakerId(value)) return 'Me';
  if (/^S\d+$/i.test(value)) return `Speaker ${value.slice(1)}`;
  if (/^\d+$/.test(value)) return `Speaker ${(parseInt(value, 10) || 0) + 1}`;
  return `Speaker ${fallbackIndex + 1}`;
};

const speakerSortValue = (id) => {
  const value = String(id ?? '');
  if (isSelfSpeakerId(value)) return -1;
  if (/^S\d+$/i.test(value)) return parseInt(value.slice(1), 10);
  if (/^\d+$/.test(value)) return parseInt(value, 10) + 1;
  return Number.MAX_SAFE_INTEGER;
};

// Cheap stable hash for duplicate-turn protection
const hashText = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; }
  return String(h);
};

const QUESTION_START_RE = /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|walk|describe)\b/i;
const ACTIONABLE_RE = /\b(can you|could you|would you|tell me|explain|walk me|describe|how would|what would|why would|do you|have you|show me|prove to me|design|debug|fix|implement|compare|recommend|help me|what's your|what is your)\b/i;
const TRAILING_FRAGMENT_RE = /(\b(and|or|but|because|so|then|if|when|where|which|that|to|for|with|about|like|as|from|by|of|in|on|at|the|a|an)\b|[,;:])$/i;
const MEANING_FAST_DELAY_MS = 850;
const MEANING_NORMAL_DELAY_MS = 1800;
const MEANING_LONG_PAUSE_MS = 5200;
const MEANING_MAX_WAIT_MS = 12000;

const analyzeMeaningReadiness = (text, { pauseMs = 0, elapsedMs = 0, boundary = false } = {}) => {
  const t = (text || '').trim();
  const words = t ? t.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const completeEnding = /[.?!]["')\]]*$/.test(t);
  const questionLike = /\?["')\]]*$/.test(t) || QUESTION_START_RE.test(t) || ACTIONABLE_RE.test(t);
  const actionable = questionLike || ACTIONABLE_RE.test(t);
  const fragmentEnding = TRAILING_FRAGMENT_RE.test(t);

  if (wordCount < 4) {
    return { analyze: false, releaseTranscript: false, delayMs: MEANING_NORMAL_DELAY_MS };
  }

  if (fragmentEnding && elapsedMs < MEANING_MAX_WAIT_MS) {
    return { analyze: false, releaseTranscript: false, delayMs: MEANING_NORMAL_DELAY_MS };
  }

  if (questionLike && wordCount >= 6 && (completeEnding || pauseMs >= 900 || boundary)) {
    return { analyze: true, releaseTranscript: true, delayMs: MEANING_FAST_DELAY_MS };
  }

  if (actionable && wordCount >= 8 && (pauseMs >= 1300 || boundary || (completeEnding && wordCount >= 12))) {
    return { analyze: true, releaseTranscript: true, delayMs: MEANING_FAST_DELAY_MS };
  }

  if (wordCount >= 24 && completeEnding && pauseMs >= 2200) {
    return { analyze: true, releaseTranscript: true, delayMs: MEANING_NORMAL_DELAY_MS };
  }

  if (elapsedMs >= MEANING_MAX_WAIT_MS && wordCount >= 10 && !fragmentEnding) {
    return { analyze: true, releaseTranscript: true, delayMs: MEANING_FAST_DELAY_MS };
  }

  if (pauseMs >= MEANING_LONG_PAUSE_MS && completeEnding) {
    return { analyze: false, releaseTranscript: true, delayMs: MEANING_FAST_DELAY_MS };
  }

  return { analyze: false, releaseTranscript: false, delayMs: questionLike ? MEANING_FAST_DELAY_MS : MEANING_NORMAL_DELAY_MS };
};

const getFocusableHistoryEntries = (blocks) =>
  blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block && !block.hidden);

const resolveFocusableHistoryIndex = (blocks, requestedIndex = null) => {
  const entries = getFocusableHistoryEntries(blocks);
  if (entries.length === 0) return null;

  if (requestedIndex !== null && requestedIndex !== undefined) {
    const exact = entries.find(({ index }) => index === requestedIndex);
    if (exact) return exact.index;

    const previous = [...entries].reverse().find(({ index }) => index < requestedIndex);
    if (previous) return previous.index;
  }

  return entries[entries.length - 1].index;
};

const TranscriptionRoom = ({ initialService }) => {
  const defaultService = initialService || DEFAULT_TRANSCRIPTION_SERVICE;
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [aiResponses, setAiResponses] = useState([]);
  const processedBlocksRef = useRef(new Set()); // Track blocks that have triggered AI analysis
  const transcriptsByRoomClientRef = useRef([]); // Rolling recent block texts for system design context
  const [isAiThinking, setIsAiThinking] = useState(false);
  const socketRef = useRef();
  const serverUrlRef = useRef('http://localhost:5002'); // Store server URL for error messages
  const audioContextRef = useRef(null);
  const screenStreamRef = useRef(null);
  const micStreamRef = useRef(null);
  const lastAnalysisTimeRef = useRef(null);
  const ANALYSIS_INTERVAL = 20000; // 20 seconds
  const [currentSegment, setCurrentSegment] = useState({
    text: '',
    startTime: null,
    timeLeft: 20
  });
  const [screenPreview, setScreenPreview] = useState(null);
  const [selectedService, setSelectedService] = useState(defaultService);
  const [currentStep, setCurrentStep] = useState(defaultService ? 'recording' : 'provider'); // 'provider', 'recording', 'transcribing'
  const [meetingMode, setMeetingMode] = useState(() => {
    try {
      const saved = localStorage.getItem('meeting_mode');
      if (saved === 'one-on-one' || saved === 'group') return saved;
      return 'group';
    } catch {
      return 'group';
    }
  });
  const [isProviderLocked, setIsProviderLocked] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [isAiAnalysisEnabled, setIsAiAnalysisEnabled] = useState(() => {
    // Try to load from localStorage, default to true (enabled)
    try {
      const saved = localStorage.getItem('ai_analysis_enabled');
      return saved !== 'false'; // Default to true if not set
    } catch {
      return true;
    }
  });
  const [useRAG, setUseRAG] = useState(() => {
    // Try to load from localStorage, default to false (Original)
    try {
      const saved = localStorage.getItem('ai_analysis_type');
      return saved === 'rag';
    } catch {
      return false;
    }
  }); // false = Original only, true = Document-Enhanced only
  
  // ── Code Deep Dive toggle ────────────────────────────────────────────────
  const [isCodeDeepDiveEnabled, setIsCodeDeepDiveEnabled] = useState(() => {
    try { return localStorage.getItem('code_deep_dive_enabled') !== 'false'; } catch { return true; }
  });
  const [codeDeepDiveResponses, setCodeDeepDiveResponses] = useState([]);
  const isCodeDeepDiveEnabledRef = useRef(isCodeDeepDiveEnabled);

  // ── System Design Viewer toggle ──────────────────────────────────────────
  const [isSystemDesignEnabled, setIsSystemDesignEnabled] = useState(() => {
    try { return localStorage.getItem('system_design_enabled') !== 'false'; } catch { return true; }
  });
  const [systemDesignResponses, setSystemDesignResponses] = useState([]);
  const isSystemDesignEnabledRef = useRef(isSystemDesignEnabled);

  // ── Full-view triple-panel mode ──────────────────────────────────────────
  const [isFullView, setIsFullView] = useState(false);
  // Index of the block shown in full-view (null = latest)
  const [fullViewBlockIdx, setFullViewBlockIdx] = useState(null);

  // When entering full view, snap to the latest block
  const openFullView = () => {
    setFullViewBlockIdx(resolveFocusableHistoryIndex(transcriptBlocks));
    setIsFullView(true);
  };

  // Persist to localStorage + keep refs in sync
  useEffect(() => {
    isCodeDeepDiveEnabledRef.current = isCodeDeepDiveEnabled;
    try { localStorage.setItem('code_deep_dive_enabled', isCodeDeepDiveEnabled ? 'true' : 'false'); } catch (_) {}
  }, [isCodeDeepDiveEnabled]);

  useEffect(() => {
    isSystemDesignEnabledRef.current = isSystemDesignEnabled;
    try { localStorage.setItem('system_design_enabled', isSystemDesignEnabled ? 'true' : 'false'); } catch (_) {}
  }, [isSystemDesignEnabled]);

  // Use ref to always have current useRAG value (avoids closure issues)
  const useRAGRef = useRef(useRAG);
  const isAiAnalysisEnabledRef = useRef(isAiAnalysisEnabled);
  
  // Update refs when state changes
  useEffect(() => {
    useRAGRef.current = useRAG;
    try {
      localStorage.setItem('ai_analysis_type', useRAG ? 'rag' : 'original');
      console.log(`[CLIENT] Saved analysis type preference: ${useRAG ? 'Document-Enhanced' : 'Original'}`);
    } catch (err) {
      console.warn('Failed to save analysis type preference:', err);
    }
  }, [useRAG]);

  useEffect(() => {
    isAiAnalysisEnabledRef.current = isAiAnalysisEnabled;
    try {
      localStorage.setItem('ai_analysis_enabled', isAiAnalysisEnabled ? 'true' : 'false');
      console.log(`[CLIENT] Saved AI Analysis enabled preference: ${isAiAnalysisEnabled}`);
    } catch (err) {
      console.warn('Failed to save AI Analysis enabled preference:', err);
    }
  }, [isAiAnalysisEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('meeting_mode', meetingMode);
    } catch (err) {
      console.warn('Failed to save meeting mode preference:', err);
    }
  }, [meetingMode]);
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Generate a room ID immediately (will be replaced by socket ID when connected)
  const generateRoomId = () => {
    if (typeof window === 'undefined') return 'room-loading';
    const saved = sessionStorage.getItem('desired_room_id');
    if (saved && saved.trim() !== '') {
      console.log('[Room ID] Using saved room ID:', saved);
      return saved;
    }
    // Generate a more stable, production-ready room ID
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const newId = `${timestamp}-${random}`;
    try {
      sessionStorage.setItem('desired_room_id', newId);
      console.log('[Room ID] Generated new room ID:', newId);
    } catch (err) {
      console.warn('[Room ID] Failed to save to sessionStorage:', err);
    }
    return newId;
  };
  const [roomId, setRoomId] = useState(() => {
    const id = generateRoomId();
    console.log('[Room ID] Initial room ID state:', id);
    return id;
  });
  const [socketConnected, setSocketConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [transcriptBlocks, setTranscriptBlocks] = useState([]);
  const [currentBlock, setCurrentBlock] = useState({
    text: '',
    interim: '',
    startTime: null,
    updatedAt: null,
    isComplete: false,
    id: null,
    speakerId: null
  });
  const [selectedAgent, setSelectedAgent] = useState('MEETING_ANALYST');
  useEffect(() => { selectedAgentRef.current = selectedAgent; }, [selectedAgent]);
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
  const [transcriptCopied, setTranscriptCopied] = useState(false);
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

  // ── Phase 3/5: Speaker-aware model + session memory ──────────────────────
  const [speakerProfiles, setSpeakerProfiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('speaker_profiles') || '{}'); } catch { return {}; }
  });
  const speakerProfilesRef = useRef(speakerProfiles);
  const [captureMode, setCaptureMode] = useState(() => {
    try { return localStorage.getItem('capture_mode') || 'everyone'; } catch { return 'everyone'; }
  });
  const captureModeRef = useRef(captureMode);
  const selectedAgentRef = useRef('MEETING_ANALYST');

  // ── Phase 1/2: Semantic Incremental Turn-Taking Controller ───────────────
  const MAX_TURN_MS = 20000; // fallback max-turn cap
  const currentBlockRef = useRef({ text: '', interim: '', startTime: null, updatedAt: null, isComplete: false, id: null, speakerId: null });
  const meaningFlushTimerRef = useRef(null);
  const activeTurnIdRef = useRef(null);
  const pendingTurnsRef = useRef(new Set());      // turnIds awaiting an AI response
  const supersededTurnsRef = useRef(new Set());   // turnIds whose answers must be dropped (revise/barge-in)
  const lastFinalizeRef = useRef(null);           // { turnId, speakerId, at }
  const lastFinalizedHashRef = useRef(null);      // duplicate protection

  // Phase 5: persist speaker profiles + capture mode, keep refs in sync
  useEffect(() => {
    speakerProfilesRef.current = speakerProfiles;
    try { localStorage.setItem('speaker_profiles', JSON.stringify(speakerProfiles)); } catch (_) {}
  }, [speakerProfiles]);
  useEffect(() => {
    captureModeRef.current = captureMode;
    try { localStorage.setItem('capture_mode', captureMode); } catch (_) {}
  }, [captureMode]);

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

    // Always use explicit server URL - don't infer from current page (which might be React dev server on 3000)
    // The server is always on port 5002, not the same port as the React app
    const serverUrl = process.env.PUBLIC_SERVER_URL || process.env.REACT_APP_SERVER_URL || 'http://localhost:5002';
    serverUrlRef.current = serverUrl; // Update ref for error handlers
    console.log('[Socket] Connecting to server:', serverUrl);
    
    socketRef.current = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      timeout: 10000,
      query: {
        desiredRoomId: (typeof window !== 'undefined' && sessionStorage.getItem('desired_room_id')) || ''
      }
    });

    socketRef.current.on('connect', () => {
      const socketId = socketRef.current.id;
      console.log('[Socket] ✅ Connected with ID:', socketId);
      console.log('[Room ID] Setting room ID to socket ID:', socketId);
      setSocketConnected(true);
      setConnectionError(null);
      setRoomId(socketId);
      try { 
        sessionStorage.setItem('desired_room_id', socketId);
        console.log('[Room ID] Saved socket ID to sessionStorage');
      } catch (err) {
        console.warn('[Room ID] Failed to save socket ID:', err);
      }
      window.history.pushState({}, '', `/${socketId}`);
    });
    
    // Listen for room_alias event from server (if desiredRoomId was provided)
    socketRef.current.on('room_alias', ({ roomId: aliasRoomId }) => {
      console.log('[Room ID] Server assigned room alias:', aliasRoomId);
      if (aliasRoomId && aliasRoomId !== roomId) {
        setRoomId(aliasRoomId);
        try {
          sessionStorage.setItem('desired_room_id', aliasRoomId);
        } catch (_) {}
      }
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('[Socket] ❌ Connection error:', error);
      console.error('[Socket] Error details:', {
        message: error.message,
        type: error.type,
        description: error.description
      });
      setSocketConnected(false);
      const currentServerUrl = serverUrlRef.current || 'http://localhost:5002';
      setConnectionError(`Cannot connect to server at ${currentServerUrl}. Make sure the server is running on port 5002.`);
      
      // Only use temporary room ID if we don't have a saved one
      const savedRoomId = sessionStorage.getItem('desired_room_id');
      if (!savedRoomId || savedRoomId.startsWith('temp-')) {
        const tempRoomId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setRoomId(tempRoomId);
        console.warn('[Socket] Using temporary room ID:', tempRoomId);
      } else {
        // Keep using saved room ID even if connection fails
        console.warn('[Socket] Keeping saved room ID:', savedRoomId);
      }
    });
    
    socketRef.current.on('reconnect', (attemptNumber) => {
      console.log('[Socket] ✅ Reconnected after', attemptNumber, 'attempts');
      setSocketConnected(true);
      setConnectionError(null);
    });
    
    socketRef.current.on('reconnect_attempt', (attemptNumber) => {
      console.log('[Socket] 🔄 Reconnection attempt', attemptNumber);
      const currentServerUrl = serverUrlRef.current || 'http://localhost:5002';
      setConnectionError(`Reconnecting to ${currentServerUrl}... (attempt ${attemptNumber})`);
    });
    
    socketRef.current.on('reconnect_failed', () => {
      console.error('[Socket] ❌ Reconnection failed after all attempts');
      const currentServerUrl = serverUrlRef.current || 'http://localhost:5002';
      setConnectionError(`Failed to connect to server at ${currentServerUrl}. Please check if the server is running on port 5002.`);
    });

    socketRef.current.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
      setSocketConnected(false);
      if (reason === 'io server disconnect') {
        setConnectionError('Server disconnected. Please refresh the page.');
      } else if (reason === 'io client disconnect') {
        // Client initiated disconnect, don't show error
      } else {
        setConnectionError('Connection lost. Attempting to reconnect...');
      }
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

    // ── Phase 3/5: speaker profile helpers ───────────────────────────────
    const ensureSpeakerProfile = (speakerId) => {
      const id = String(speakerId ?? 0);
      if (speakerProfilesRef.current[id]) return;
      const idx = Object.keys(speakerProfilesRef.current).length;
      const isSelf = isSelfSpeakerId(id);
      const def = {
        speakerId: id,
        displayName: isSelf ? 'Me' : formatSpeakerDisplayName(id, idx),
        role: isSelf ? 'me' : 'unknown',
        hidden: isSelf,
        confidence: 0,
        lastSeenAt: Date.now(),
        totalSpeechMs: 0,
      };
      // mutate ref immediately so same-tick lookups see it; state for UI
      speakerProfilesRef.current = { ...speakerProfilesRef.current, [id]: def };
      setSpeakerProfiles(p => (p[id] ? p : { ...p, [id]: def }));
    };

    // Resolve display + effective hidden flag (explicit flag + capture mode).
    const resolveSpeaker = (speakerId) => {
      const id = String(speakerId ?? 0);
      const fallback = { displayName: formatSpeakerDisplayName(id), role: isSelfSpeakerId(id) ? 'me' : 'unknown', hidden: isSelfSpeakerId(id) };
      const p = speakerProfilesRef.current[id] || fallback;
      const mode = captureModeRef.current;
      let hidden = !!p.hidden;
      if (mode === 'ignore_self' || mode === 'coach') {
        if (p.role === 'me') hidden = true;
      }
      if (mode === 'only_interviewer') {
        if (!['interviewer', 'customer', 'instructor'].includes(p.role)) hidden = true;
      }
      return { id, displayName: p.displayName || formatSpeakerDisplayName(id), role: p.role || 'unknown', hidden };
    };

    const touchSpeaker = (id, block) => {
      const ms = block.startTime ? (Date.now() - block.startTime) : 0;
      setSpeakerProfiles(p => {
        const cur = p[id];
        if (!cur) return p;
        return { ...p, [id]: { ...cur, lastSeenAt: Date.now(), totalSpeechMs: (cur.totalSpeechMs || 0) + ms } };
      });
    };

    const clearMeaningFlushTimer = () => {
      if (meaningFlushTimerRef.current) {
        clearTimeout(meaningFlushTimerRef.current);
        meaningFlushTimerRef.current = null;
      }
    };

    const emitAnalysisForBlock = (block, reason) => {
      if (!block || !block.text || block.hidden) return;
      if (!isAiAnalysisEnabledRef.current) return;
      if (processedBlocksRef.current.has(block.turnId)) return;
      processedBlocksRef.current.add(block.turnId);

      const now = Date.now();
      const last = lastFinalizeRef.current;
      if (last && last.speakerId === block.speakerId && (now - last.at) < 2000 && pendingTurnsRef.current.has(last.turnId)) {
        supersededTurnsRef.current.add(last.turnId);
        console.log(`[CLIENT] Superseding stale turn ${last.turnId} (continued by ${block.displayName})`);
      }
      lastFinalizeRef.current = { turnId: block.turnId, speakerId: block.speakerId, at: now };
      activeTurnIdRef.current = block.turnId;
      pendingTurnsRef.current.add(block.turnId);

      setTranscriptBlocks(blocks =>
        blocks.map(item => item.turnId === block.turnId ? { ...item, aiTriggered: true, analysisReason: reason } : item)
      );

      const currentRoomId = socketRef.current?.id || roomId;
      const clientHistory = transcriptsByRoomClientRef.current;
      clientHistory.push(block.text);
      if (clientHistory.length > 20) clientHistory.splice(0, clientHistory.length - 20);

      try {
        setIsAiThinking(true);
        socketRef.current.emit('process_with_ai', {
          text: block.text,
          roomId: currentRoomId,
          agentType: selectedAgentRef.current,
          blockId: block.turnId,
          turnId: block.turnId,
          speakerId: block.speakerId,
          displayName: block.displayName,
          hidden: false,
          useRAG: Boolean(useRAGRef.current),
        });
        if (isCodeDeepDiveEnabledRef.current) {
          socketRef.current.emit('process_code_deep_dive', { text: block.text, roomId: currentRoomId, blockId: block.turnId });
        }
        if (isSystemDesignEnabledRef.current) {
          socketRef.current.emit('process_system_design', { text: block.text, roomId: currentRoomId, blockId: block.turnId, recentBlocks: transcriptsByRoomClientRef.current || [] });
        }
      } catch (err) {
        console.error('[X] [CLIENT] Error emitting process_with_ai:', err);
      }
    };

    // ── Phase 1/2: finalize the current meaning unit, optionally trigger AI ─
    const finalizeAndAnalyze = (reason, { analyze = false } = {}) => {
      clearMeaningFlushTimer();
      const prev = currentBlockRef.current;
      if (!prev || (!prev.text && !prev.interim)) return;
      const blockText = (prev.text + (prev.interim ? ` ${prev.interim}` : '')).trim();
      if (!blockText) return;

      const turnId = prev.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const textHash = hashText(blockText);
      if (lastFinalizedHashRef.current === textHash) {
        // identical to last finalized turn — reset and bail (duplicate protection)
        const empty = { text: '', interim: '', startTime: null, updatedAt: null, isComplete: false, id: null, speakerId: null };
        currentBlockRef.current = empty; setCurrentBlock(empty);
        return;
      }
      lastFinalizedHashRef.current = textHash;

      const speaker = resolveSpeaker(prev.speakerId);

      const shouldFocusTurn = !speaker.hidden;
      const finalizedBlock = {
        ...prev,
        text: blockText,
        interim: '',
        isComplete: true,
        id: turnId,
        turnId,
        speakerId: speaker.id,
        displayName: speaker.displayName,
        role: speaker.role,
        hidden: speaker.hidden,
        aiTriggered: false,
        analysisReason: null,
        finalizedReason: reason,
      };

      // Append finalized turn to the visible transcript (with speaker metadata)
      setTranscriptBlocks(blocks => {
        const next = [...blocks, finalizedBlock];
        if (shouldFocusTurn) {
          setHistoryIdx(next.length - 1);
          setHistoryStage('new');
          setTimeout(() => setHistoryStage('warn'), 1500);
        }
        return next;
      });
      touchSpeaker(speaker.id, prev);

      // Reset current block for the next turn
      const empty = { text: '', interim: '', startTime: null, updatedAt: null, isComplete: false, id: null, speakerId: null };
      currentBlockRef.current = empty; setCurrentBlock(empty);

      // Hidden speaker: show transcript only — never send to AI or rolling context
      if (speaker.hidden) {
        console.log(`[CLIENT] Hidden speaker (${speaker.displayName}) — turn ${turnId} not analyzed [${reason}]`);
        return;
      }

      if (analyze) {
        emitAnalysisForBlock(finalizedBlock, reason);
      }
    };

    const scheduleMeaningFlush = (reason, { boundary = false } = {}) => {
      clearMeaningFlushTimer();
      const block = currentBlockRef.current;
      const text = (block?.text + (block?.interim ? ` ${block.interim}` : '')).trim();
      if (!text) return;

      const speaker = resolveSpeaker(block.speakerId);
      const now = Date.now();
      const pauseMs = now - (block.updatedAt || block.startTime || now);
      const elapsedMs = now - (block.startTime || now);
      const readiness = analyzeMeaningReadiness(text, { pauseMs, elapsedMs, boundary });

      if (speaker.hidden) {
        meaningFlushTimerRef.current = setTimeout(() => finalizeAndAnalyze(`hidden_${reason}`, { analyze: false }), 700);
        return;
      }

      if (readiness.analyze || readiness.releaseTranscript) {
        const delayMs = boundary ? 250 : readiness.delayMs;
        meaningFlushTimerRef.current = setTimeout(() => {
          const latest = currentBlockRef.current;
          if (!latest || (!latest.text && !latest.interim)) return;
          const latestText = (latest?.text + (latest?.interim ? ` ${latest.interim}` : '')).trim();
          const latestNow = Date.now();
          const latestDecision = analyzeMeaningReadiness(latestText, {
            pauseMs: latestNow - (latest.updatedAt || latest.startTime || latestNow),
            elapsedMs: latestNow - (latest.startTime || latestNow),
            boundary,
          });
          finalizeAndAnalyze(reason, { analyze: latestDecision.analyze });
        }, delayMs);
        return;
      }

      meaningFlushTimerRef.current = setTimeout(() => {
        const latest = currentBlockRef.current;
        if (!latest || (!latest.text && !latest.interim)) return;
        const latestText = (latest.text + (latest.interim ? ` ${latest.interim}` : '')).trim();
        const latestNow = Date.now();
        const latestDecision = analyzeMeaningReadiness(latestText, {
          pauseMs: latestNow - (latest.updatedAt || latest.startTime || latestNow),
          elapsedMs: latestNow - (latest.startTime || latestNow),
          boundary: false,
        });
        if (latestDecision.analyze || latestDecision.releaseTranscript) {
          finalizeAndAnalyze(reason, { analyze: latestDecision.analyze });
        } else {
          scheduleMeaningFlush('meaning_wait');
        }
      }, readiness.delayMs);
    };

    // ── Phase 1: end-of-turn signal from Deepgram (UtteranceEnd) ─────────
    socketRef.current.on('utterance_end', () => {
      const cur = currentBlockRef.current;
      if (!cur || (!cur.text && !cur.interim)) return;
      scheduleMeaningFlush('utterance_end', { boundary: true });
    });

    socketRef.current.on('transcription', (transcription) => {
      if (!transcription?.text) return;

      const isFinal = Boolean(transcription.isFinal);
      const speechFinal = Boolean(transcription.speechFinal);
      const txt = transcription.text.trim();
      if (!txt) return;
      const speakerId = String(transcription.speakerTag ?? transcription.speaker ?? 0);
      ensureSpeakerProfile(speakerId);

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

      const now = Date.now();
      const prev = currentBlockRef.current;
      const hasContent = prev.startTime && (prev.text || prev.interim);
      const speakerChanged = hasContent && prev.speakerId !== null && prev.speakerId !== speakerId;
      const tooOld = prev.startTime && (now - prev.startTime > MAX_TURN_MS);

      // Speaker boundary or max-turn cap → finalize the previous turn first
      if (speakerChanged || tooOld) {
        const prevText = (prev.text + (prev.interim ? ` ${prev.interim}` : '')).trim();
        const prevDecision = analyzeMeaningReadiness(prevText, {
          pauseMs: now - (prev.updatedAt || prev.startTime || now),
          elapsedMs: now - (prev.startTime || now),
          boundary: true,
        });
        finalizeAndAnalyze(speakerChanged ? 'speaker_change' : 'max_turn', { analyze: prevDecision.analyze });
      }

      // Accumulate into the current turn
      const cur = currentBlockRef.current;
      let updated;
      if (!cur.startTime || cur.id === null) {
        updated = {
          text: isFinal ? txt : '',
          interim: isFinal ? '' : txt,
          startTime: now,
          updatedAt: now,
          isComplete: false,
          id: `${now}_${Math.random().toString(36).slice(2, 8)}`,
          speakerId,
        };
      } else if (isFinal || speechFinal) {
        const combined = cur.text ? `${cur.text} ${txt}` : txt;
        updated = { ...cur, text: combined, interim: '', speakerId: cur.speakerId ?? speakerId, updatedAt: now };
      } else {
        updated = { ...cur, interim: txt, speakerId: cur.speakerId ?? speakerId, updatedAt: now };
      }
      currentBlockRef.current = updated;
      setCurrentBlock(updated);

      // Stable ASR chunks feed the meaning gate; they do not automatically trigger AI.
      if (isFinal || speechFinal) {
        const isSpeechmaticsStableChunk = transcription.service === 'speechmatics';
        scheduleMeaningFlush('endpoint_score', { boundary: Boolean(speechFinal && !isSpeechmaticsStableChunk) });
      }
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
      // Phase 2: drop stale/superseded turns (barge-in / revise)
      if (response.turnId) {
        pendingTurnsRef.current.delete(response.turnId);
        if (supersededTurnsRef.current.has(response.turnId)) {
          supersededTurnsRef.current.delete(response.turnId);
          console.log(`[CLIENT] Dropping superseded ai_response for turn ${response.turnId}`);
          if (pendingTurnsRef.current.size === 0) setIsAiThinking(false);
          return;
        }
      }
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

    // ── Code Deep Dive response listener ──────────────────────────────────
    socketRef.current.on('code_deep_dive_response', (response) => {
      setCodeDeepDiveResponses(prev => {
        const entry = {
          text: response.text,
          blockId: response.blockId,
          timestamp: response.timestamp || new Date().toISOString(),
          agent: response.agent,
          isError: response.isError || false
        };
        // Replace if same blockId already exists, otherwise append
        const idx = prev.findIndex(r => r.blockId === response.blockId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = entry;
          return updated;
        }
        return [...prev, entry];
      });
    });

    // ── System Design response listener ───────────────────────────────────
    socketRef.current.on('system_design_response', (response) => {
      setSystemDesignResponses(prev => {
        const entry = {
          text: response.text,
          blockId: response.blockId,
          timestamp: response.timestamp || new Date().toISOString(),
          agent: response.agent,
          counter: response.counter,
          isError: response.isError || false
        };
        const idx = prev.findIndex(r => r.blockId === response.blockId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = entry;
          return updated;
        }
        return [...prev, entry];
      });
    });

    return () => {
      cleanupAudioContext();
      clearInterval(countdownInterval);
      if (analysisInterval) clearInterval(analysisInterval); // Safely clear if exists
      clearInterval(dbgTicker);
      clearMeaningFlushTimer();
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

  const beginTranscriptionSession = () => {
    setIsProviderLocked(true);
    setCurrentStep('transcribing');
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
  };

  const resetTranscriptionSession = () => {
    setIsAiThinking(false);
    setCurrentSegment({
      text: '',
      startTime: null,
      timeLeft: 20
    });

    socketRef.current.emit('stop_transcription', roomId);
    socketRef.current.emit('stop_ai_processing', roomId);

    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    sessionTimerRef.current = null;
    sessionStartRef.current = null;
    setSessionElapsedMs(0);

    setIsProviderLocked(false);
    setCurrentStep('provider');
    setSelectedService('');
  };

  const startOneOnOneMeeting = async () => {
    try {
      beginTranscriptionSession();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1
        }
      });
      micStreamRef.current = stream;

      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);

      const noiseGate = audioContextRef.current.createDynamicsCompressor();
      noiseGate.threshold.value = -50;
      noiseGate.knee.value = 40;
      noiseGate.ratio.value = 12;
      noiseGate.attack.value = 0;
      noiseGate.release.value = 0.25;

      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = 1.5;

      await audioContextRef.current.audioWorklet.addModule('/audio-processor.worklet.js');
      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');

      source.connect(noiseGate);
      noiseGate.connect(gainNode);
      gainNode.connect(workletNode);
      workletNode.connect(audioContextRef.current.destination);

      workletNode.port.onmessage = (event) => {
        const { audioData } = event.data;
        if (audioData) {
          const float32Array = new Float32Array(audioData);
          const int16Array = new Int16Array(float32Array.length);

          for (let i = 0; i < float32Array.length; i++) {
            let sample = float32Array[i];
            if (Math.abs(sample) < 0.01) {
              sample = 0;
            }
            const s = Math.max(-1, Math.min(1, sample));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          debugStatsRef.current.bytesSent += int16Array.byteLength;
          debugStatsRef.current.chunksSent += 1;
          debugStatsRef.current.lastEmitTs = Date.now();

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
            isScreenShare: false,
            service: selectedService
          });
        }
      };

      socketRef.current.emit('start_transcription', {
        roomId,
        service: selectedService,
        meetingMode: 'one-on-one'
      });
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting 1:1 meeting:', error);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
      cleanupAudioContext();
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
      sessionStartRef.current = null;
      setSessionElapsedMs(0);
      setIsProviderLocked(false);
      setCurrentStep('recording');
      alert('Error starting microphone: ' + error.message);
    }
  };

  const stopOneOnOneMeeting = () => {
    try {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }

      cleanupAudioContext();
      resetTranscriptionSession();
      setIsRecording(false);
    } catch (error) {
      console.error('Error stopping 1:1 meeting:', error);
    }
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

      beginTranscriptionSession();

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
      
      resetTranscriptionSession();
      
      setIsScreenSharing(false);
      setScreenPreview(null);
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

  const copyTranscript = async () => {
    // Combine all completed blocks and current block
    const allBlocks = [...transcriptBlocks];
    if (currentBlock.text) {
      allBlocks.push(currentBlock);
    }
    
    const text = allBlocks.map(block => block.text).join('\n\n');
    
    try {
      await navigator.clipboard.writeText(text);
      setTranscriptCopied(true);
      setTimeout(() => setTranscriptCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy transcript:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setTranscriptCopied(true);
        setTimeout(() => setTranscriptCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy also failed:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
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

  // Phase 4: speaker profile editing (rename / role / hide)
  const updateSpeakerProfile = (id, patch) => {
    setSpeakerProfiles(p => {
      const cur = p[id] || {
        speakerId: id,
        displayName: formatSpeakerDisplayName(id),
        role: isSelfSpeakerId(id) ? 'me' : 'unknown',
        hidden: isSelfSpeakerId(id),
        confidence: 0,
        lastSeenAt: Date.now(),
        totalSpeechMs: 0,
      };
      const nextProfile = { ...cur, ...patch };
      const next = { ...p, [id]: nextProfile };
      speakerProfilesRef.current = next;
      return next;
    });
  };

  const renderSpeakerControls = () => {
    const ids = Object.keys(speakerProfiles).sort((a, b) => speakerSortValue(a) - speakerSortValue(b));
    return (
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2">
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> Speakers
          </span>
          <select
            value={captureMode}
            onChange={(e) => setCaptureMode(e.target.value)}
            className="text-[11px] bg-background border border-white/15 rounded px-1.5 py-0.5 text-foreground"
            title="Capture mode"
          >
            {CAPTURE_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        {ids.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No speakers detected yet. Diarization labels appear as people speak.</p>
        ) : (
          <div className="space-y-1.5">
            {ids.map(id => {
              const p = speakerProfiles[id];
              return (
                <div key={id} className="flex items-center gap-1.5">
                  <input
                    value={p.displayName}
                    onChange={(e) => updateSpeakerProfile(id, { displayName: e.target.value })}
                    className="flex-1 min-w-0 text-[11px] bg-background border border-white/15 rounded px-1.5 py-0.5 text-foreground"
                    placeholder={formatSpeakerDisplayName(id)}
                  />
                  <select
                    value={p.role}
                    onChange={(e) => updateSpeakerProfile(id, { role: e.target.value })}
                    className="text-[11px] bg-background border border-white/15 rounded px-1 py-0.5 text-foreground"
                    title="Role"
                  >
                    {SPEAKER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => updateSpeakerProfile(id, { hidden: !p.hidden })}
                    className={cn(
                      'flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border transition-colors',
                      p.hidden
                        ? 'border-red-500/30 text-red-300 bg-red-500/10'
                        : 'border-white/15 text-white/60 hover:text-white'
                    )}
                    title={p.hidden ? 'Hidden from AI — click to show' : 'Visible to AI — click to hide'}
                  >
                    {p.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {p.hidden ? 'Hidden' : 'Active'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderTranscripts = () => {
    if (transcriptBlocks.length === 0 && !currentBlock.text) {
      return (
        <div className="text-center text-muted-foreground py-12">
          <p>
            {meetingMode === 'one-on-one'
              ? 'Start with your laptop microphone to begin transcription...'
              : 'Start recording or share your screen to begin transcription...'}
          </p>
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

    const roleColor = (role) => (
      role === 'me' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
      : role === 'interviewer' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : role === 'customer' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-white/5 text-white/60 border-white/15'
    );

    return (
      <>
        {transcriptBlocks.map((block, index) => {
          const label = block.displayName || (block.speakerId != null ? `Speaker ${(parseInt(block.speakerId, 10) || 0) + 1}` : null);
          if (block.hidden) {
            // Collapsed marker — hidden speaker is never analyzed
            return (
              <div key={index} className="mb-2 px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.02] text-[11px] text-muted-foreground flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                {label || 'Hidden speaker'} spoke — hidden from AI
              </div>
            );
          }
          return (
            <Card key={index} className="mb-4 relative">
              <CardContent className="pt-6">
                {label && (
                  <Badge variant="outline" className={cn('mb-2 text-[11px]', roleColor(block.role))}>
                    {label}{block.role && block.role !== 'unknown' ? ` · ${block.role}` : ''}
                  </Badge>
                )}
                {renderFormattedText(block.text)}
              </CardContent>
              <CopyButton text={block.text} />
            </Card>
          );
        })}
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

  const historyEntries = getFocusableHistoryEntries(transcriptBlocks);
  const selectedHistoryIdx = resolveFocusableHistoryIndex(transcriptBlocks, historyIdx);
  const selectedHistoryOrdinal = historyEntries.findIndex(({ index }) => index === selectedHistoryIdx);
  const selectedHistoryBlock = selectedHistoryIdx !== null ? transcriptBlocks[selectedHistoryIdx] : null;
  const selectHistoryByOffset = (offset) => {
    if (historyEntries.length === 0) return;
    const currentOrdinal = selectedHistoryOrdinal >= 0 ? selectedHistoryOrdinal : historyEntries.length - 1;
    const nextOrdinal = Math.max(0, Math.min(historyEntries.length - 1, currentOrdinal + offset));
    setHistoryIdx(historyEntries[nextOrdinal].index);
    setHistoryStage('idle');
  };

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="max-w-[1600px] mx-auto">
        {/* Connection Status Banner */}
        {connectionError && !socketConnected && (
          <div className="mb-4 p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-orange-500">⚠️</span>
              <span className="text-sm text-orange-700 dark:text-orange-400">
                {connectionError}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (socketRef.current) {
                  socketRef.current.disconnect();
                  socketRef.current.connect();
                }
              }}
            >
              Retry Connection
            </Button>
          </div>
        )}
        {/* ── App Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">

          {/* LEFT — brand + status strip */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Wordmark */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="h-7 w-7 rounded-lg bg-primary/90 flex items-center justify-center">
                <Mic className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <span className="text-base font-bold tracking-tight">SyncScribe</span>
            </div>

            {/* Divider */}
            <span className="text-border select-none hidden sm:block">|</span>

            {/* Provider pill */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/15 text-[11px]">
              {selectedService === 'deepgram' && <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />}
              {selectedService === 'speechmatics' && <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 shrink-0" />}
              {selectedService === 'openai'   && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />}
              {selectedService === 'google'   && <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 shrink-0" />}
              {!selectedService               && <span className="h-1.5 w-1.5 rounded-full bg-white/30 shrink-0" />}
              <span className="font-bold text-[#f5f0e8]">
                {getServiceLabel(selectedService)}
              </span>
            </div>

            {/* Live / Idle + timer */}
            <div className={cn(
              'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border',
              isRecording || isScreenSharing
                ? 'bg-red-950/50 border-red-500/50 text-red-200'
                : 'bg-white/[0.06] border-white/15 text-[#f5f0e8]'
            )}>
              <span className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                isRecording || isScreenSharing ? 'bg-red-400 animate-pulse' : 'bg-[#f5f0e8]/50'
              )} />
              {isRecording || isScreenSharing ? 'Live' : 'Idle'}
              {sessionElapsedMs > 0 && (
                <span className="tabular-nums ml-0.5 font-mono text-[#f5f0e8]/70">{formatDuration(sessionElapsedMs)}</span>
              )}
            </div>

            {/* Room ID chip */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/15 text-[10px] font-mono max-w-[210px]">
              <span className="text-[#f5f0e8]/40 shrink-0 font-bold not-italic">Room</span>
              <span className="text-[#f5f0e8] font-bold tracking-wide truncate">
                {(roomId || socketRef.current?.id || '—').substring(0, 20)}
              </span>
              {socketConnected
                ? <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
                : <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />}
            </div>
          </div>

          {/* RIGHT — action buttons */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* Copy Link */}
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 1500);
                } catch (_) {}
              }}
              title="Copy room link"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                linkCopied
                  ? 'bg-green-950/40 border-green-500/40 text-green-300'
                  : 'border-white/15 text-white/50 hover:text-white hover:border-white/35 bg-white/[0.03]'
              )}
            >
              {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {linkCopied ? 'Copied!' : 'Copy Link'}
            </button>

            {/* Copy Transcript — only when there's content */}
            {(transcriptBlocks.length > 0 || currentBlock.text) && (
              <button
                onClick={copyTranscript}
                title="Copy transcript to clipboard"
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  transcriptCopied
                    ? 'bg-green-950/40 border-green-500/40 text-green-300'
                    : 'border-white/15 text-white/50 hover:text-white hover:border-white/35 bg-white/[0.03]'
                )}
              >
                {transcriptCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {transcriptCopied ? 'Copied!' : 'Copy Transcript'}
              </button>
            )}

            {/* Export Transcript — only when there's content */}
            {(transcriptBlocks.length > 0 || currentBlock.text) && (
              <button
                onClick={exportTranscript}
                title="Export transcript as text file"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/15 text-white/50 hover:text-white hover:border-white/35 bg-white/[0.03] transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                Export Transcript
              </button>
            )}

            {/* Settings */}
            <Settings
              selectedService={selectedService}
              setSelectedService={setSelectedService}
              currentStep={currentStep}
              setCurrentStep={setCurrentStep}
              isProviderLocked={isProviderLocked}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              meetingMode={meetingMode}
              setMeetingMode={setMeetingMode}
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
                {renderSpeakerControls()}
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
                              {getServiceLabel(selectedService)}
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
                      ) : isRecording && meetingMode === 'one-on-one' ? (
                        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                          <div className="relative mb-4">
                            <Mic className="h-16 w-16 text-primary" />
                            <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full animate-pulse" />
                          </div>
                          <Badge variant="destructive" className="mb-2">
                            <span className="h-2 w-2 bg-red-500 rounded-full mr-2 animate-pulse" />
                            Live — 1:1 Microphone
                          </Badge>
                          <p className="text-sm text-muted-foreground mb-4">
                            Transcribing from your laptop microphone
                          </p>
                          <Badge variant="secondary" className="mb-4">
                            {getServiceLabel(selectedService)}
                          </Badge>
                          <Button size="sm" variant="secondary" onClick={stopOneOnOneMeeting}>
                            <StopCircle className="h-4 w-4 mr-1" />
                            Stop
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          {currentStep === 'provider' ? (
                            <div className="text-center p-4">
                              <SettingsIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                              <p className="text-muted-foreground">Please select a provider first</p>
                            </div>
                          ) : meetingMode === 'one-on-one' ? (
                            <div className="text-center p-4 space-y-4">
                              <Mic className="h-12 w-12 mx-auto text-primary" />
                              <p className="text-sm text-muted-foreground max-w-xs">
                                1:1 mode uses your laptop microphone — no screen or tab selection needed.
                              </p>
                              <Button
                                onClick={startOneOnOneMeeting}
                                disabled={!selectedService}
                                size="lg"
                              >
                                <Mic className="h-5 w-5 mr-2" />
                                Start with Microphone
                              </Button>
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
                            {getServiceLabel(selectedService)}
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
                  {historyEntries.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">History</span>
                        <div className="flex gap-2">
                          <Badge variant="secondary" className="text-xs">{(selectedHistoryOrdinal >= 0 ? selectedHistoryOrdinal + 1 : historyEntries.length)} / {historyEntries.length}</Badge>
                          <Button variant="secondary" size="sm" disabled={selectedHistoryOrdinal <= 0} onClick={() => selectHistoryByOffset(-1)}>Prev</Button>
                          <Button variant="secondary" size="sm" disabled={selectedHistoryOrdinal < 0 || selectedHistoryOrdinal >= historyEntries.length - 1} onClick={() => selectHistoryByOffset(1)}>Next</Button>
                        </div>
                      </div>
                      <Card
                        className={`relative group cursor-pointer transition-colors duration-500 ${historyStage==='new' ? 'border-green-400' : historyStage==='warn' ? 'border-yellow-400' : ''}`}
                        onClick={async () => {
                          const text = selectedHistoryBlock?.text || '';
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
                              {selectedHistoryBlock?.text}
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

                {/* Export and Copy Buttons */}
                {(transcriptBlocks.length > 0 || currentBlock.text) && (
                  <div className="mt-4 flex gap-2">
                    <Button 
                      onClick={copyTranscript} 
                      variant="secondary"
                      className="flex-1"
                    >
                      {transcriptCopied ? (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-2" />
                          Copy Transcript
                        </>
                      )}
                    </Button>
                    <Button 
                      onClick={exportTranscript} 
                      variant="secondary"
                      className="flex-1"
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
          <div className="lg:col-span-8 min-w-0 overflow-hidden">
            <Card className="h-[calc(100vh-8rem)] overflow-hidden">
              <CardHeader className="pb-2 border-b border-border/50">
                {/* ── Top row: title + all controls ── */}
                <div className="flex items-center gap-3 flex-wrap">
                  <CardTitle className="text-base font-semibold shrink-0">AI Analysis</CardTitle>

                  {/* countdown pill */}
                  {currentSegment.startTime && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground tabular-nums">{currentSegment.timeLeft}s</span>
                      <div className="w-14 h-1 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-1000 ease-linear" style={{ width: `${(currentSegment.timeLeft / 20) * 100}%` }} />
                      </div>
                    </div>
                  )}

                  {/* divider */}
                  <span className="text-white/10 select-none hidden sm:block">|</span>

                  {/* Auto Scroll toggle pill */}
                  <button
                    onClick={() => setIsAutoScrollEnabled(v => !v)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                      isAutoScrollEnabled
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'border-white/10 text-white/30 hover:text-white/60 hover:border-white/25'
                    )}
                  >
                    <Maximize2 className="h-3 w-3" />
                    Auto Scroll
                  </button>

                  {/* AI Analysis toggle pill */}
                  <button
                    onClick={() => setIsAiAnalysisEnabled(v => !v)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                      isAiAnalysisEnabled
                        ? 'bg-blue-950/60 border-blue-500/50 text-blue-300'
                        : 'border-white/10 text-white/30 hover:text-white/60 hover:border-white/25'
                    )}
                  >
                    <Activity className="h-3 w-3" />
                    AI Analysis
                  </button>

                  {/* Type select — only when AI enabled */}
                  {isAiAnalysisEnabled && (
                    <select
                      value={useRAG ? 'rag' : 'original'}
                      onChange={(e) => setUseRAG(e.target.value === 'rag')}
                      className={cn(
                        'text-[11px] rounded-full px-2.5 py-1 border cursor-pointer transition-all outline-none',
                        useRAG
                          ? 'bg-purple-950/50 border-purple-500/40 text-purple-300'
                          : 'bg-white/5 border-white/15 text-white/50 hover:border-white/30'
                      )}
                    >
                      <option value="original">Original</option>
                      <option value="rag">Doc-Enhanced</option>
                    </select>
                  )}

                  {/* divider */}
                  <span className="text-white/10 select-none hidden sm:block">|</span>

                  {/* Code Deep Dive pill */}
                  <button
                    onClick={() => setIsCodeDeepDiveEnabled(v => !v)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                      isCodeDeepDiveEnabled
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                        : 'border-white/10 text-white/30 hover:text-emerald-400 hover:border-emerald-500/40'
                    )}
                  >
                    <Terminal className="h-3 w-3" />
                    Code Dive
                  </button>

                  {/* System Design pill */}
                  <button
                    onClick={() => setIsSystemDesignEnabled(v => !v)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                      isSystemDesignEnabled
                        ? 'bg-violet-950/60 border-violet-500/50 text-violet-300'
                        : 'border-white/10 text-white/30 hover:text-violet-400 hover:border-violet-500/40'
                    )}
                  >
                    <Network className="h-3 w-3" />
                    Sys Design
                  </button>

                  {/* Full View button */}
                  <button
                    onClick={openFullView}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-white/20 text-white/50 hover:text-white hover:border-white/50 transition-all ml-auto"
                  >
                    <Columns3 className="h-3 w-3" />
                    Full View
                  </button>
                </div>

                <CardDescription className="mt-1.5 text-xs">
                  {currentSegment.startTime
                    ? 'Collecting conversation context…'
                    : 'Waiting for conversation to begin…'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[calc(100vh-16rem)]" ref={aiResponsesRef}>
                <div className="pr-4 min-w-0">
                  {!isAiAnalysisEnabled ? (
                    <div className="text-center text-muted-foreground py-12">
                      <p className="mb-2">AI Analysis is currently disabled.</p>
                      <p className="text-sm">Enable the toggle above to start receiving AI analysis of your conversations.</p>
                    </div>
                  ) : (
                    (() => {
                      const block = selectedHistoryBlock;
                      const ai = block?.ai;
                      const aiRag = block?.aiRag;

                      if (!block) {
                        return (
                          <div className="text-center text-muted-foreground py-12">
                            <p>Waiting for an active speaker turn.</p>
                          </div>
                        );
                      }
                      
                      if (ai || aiRag) {
                        return (
                          <div className="space-y-4 min-w-0">
                            {ai && <AIResponse response={ai} />}
                            {aiRag && ragAuthenticated && <AIResponse response={aiRag} />}
                          </div>
                        );
                      }
                      return (
                        aiResponses.length === 0 ? (
                          <div className="text-center text-muted-foreground py-12">
                            <p>Analysis will appear every 20 seconds.</p>
                          </div>
                        ) : (
                          <div className="space-y-4 min-w-0">
                            {aiResponses
                              .filter(response => {
                                if (response.analysisType === 'document-enhanced' && !ragAuthenticated) return false;
                                if (useRAG && response.analysisType !== 'document-enhanced') return false;
                                if (!useRAG && response.analysisType !== 'original') return false;
                                return true;
                              })
                              .map((response, index) => (
                                <AIResponse key={index} response={response} />
                              ))}
                          </div>
                        )
                      );
                    })()
                  )}
                  {isAiThinking && isAiAnalysisEnabled && (
                    <div className="mt-4 flex items-center gap-2 text-muted-foreground px-1">
                      <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">Analyzing recent conversation...</span>
                    </div>
                  )}
                </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Bottom row: Code Deep Dive + System Design Viewer ───────── */}
        {(isCodeDeepDiveEnabled || isSystemDesignEnabled) && (
          <div className={cn(
            'grid gap-6 mt-4',
            isCodeDeepDiveEnabled && isSystemDesignEnabled
              ? 'grid-cols-1 lg:grid-cols-2'
              : 'grid-cols-1'
          )}>

            {/* Code Deep Dive Panel */}
            {isCodeDeepDiveEnabled && (
              <div className="min-w-0 overflow-hidden">
                <Card className="overflow-hidden border-emerald-500/30" style={{ height: '75vh' }}>
                  <CardHeader className="py-3 px-4 border-b border-emerald-500/20 shrink-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-emerald-400" />
                        <CardTitle className="text-sm font-semibold text-emerald-300">Code Deep Dive</CardTitle>
                      </div>
                      <button
                        onClick={() => setIsCodeDeepDiveEnabled(false)}
                        className="text-[11px] text-white/25 hover:text-white/60 transition-colors px-1"
                      >
                        ✕
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0" style={{ height: 'calc(75vh - 3.5rem)', overflowY: 'auto', overflowX: 'hidden' }}>
                    <div className="p-4 space-y-3" style={{ minWidth: 0 }}>
                      {codeDeepDiveResponses.length === 0 ? (
                        <div className="text-center text-muted-foreground py-16">
                          <Terminal className="h-8 w-8 mx-auto mb-3 text-emerald-800" />
                          <p className="text-sm">Code Deep Dive responses appear here</p>
                        </div>
                      ) : (
                        [...codeDeepDiveResponses].reverse().map((r, i) => (
                          <CodeDeepDive key={r.blockId || i} response={r} />
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* System Design Viewer Panel */}
            {isSystemDesignEnabled && (
              <div className="min-w-0 overflow-hidden">
                <Card className="overflow-hidden border-violet-500/30" style={{ height: '75vh' }}>
                  <CardHeader className="py-3 px-4 border-b border-violet-500/20 shrink-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Network className="h-4 w-4 text-violet-400" />
                        <CardTitle className="text-sm font-semibold text-violet-300">System Design Viewer</CardTitle>
                      </div>
                      <button
                        onClick={() => setIsSystemDesignEnabled(false)}
                        className="text-[11px] text-white/25 hover:text-white/60 transition-colors px-1"
                      >
                        ✕
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0" style={{ height: 'calc(75vh - 3.5rem)', overflow: 'hidden' }}>
                    <ScrollArea className="h-full">
                      <div className="p-4 min-w-0 space-y-3">
                        {systemDesignResponses.length === 0 ? (
                          <div className="text-center text-muted-foreground py-16">
                            <Network className="h-8 w-8 mx-auto mb-3 text-violet-800" />
                            <p className="text-sm">System Design diagrams appear here</p>
                          </div>
                        ) : (
                          [...systemDesignResponses].reverse().map((r, i) => (
                            <SystemDesignViewer key={r.blockId || i} response={r} counter={r.counter} />
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            )}

          </div>
        )}

      </div>

      {/* ── Full-View Triple Panel Overlay ────────────────────────────────── */}
      {isFullView && (() => {
        // Resolve the block to display
        const fvEntries = getFocusableHistoryEntries(transcriptBlocks);
        const requestedFvIdx = fullViewBlockIdx !== null
          ? fullViewBlockIdx
          : resolveFocusableHistoryIndex(transcriptBlocks);
        const fvIdx = resolveFocusableHistoryIndex(transcriptBlocks, requestedFvIdx);
        const fvBlock = fvIdx !== null ? transcriptBlocks[fvIdx] : null;
        const fvOrdinal = fvEntries.findIndex(({ index }) => index === fvIdx);
        const canPrev = fvOrdinal > 0;
        const canNext = fvOrdinal >= 0 && fvOrdinal < fvEntries.length - 1;

        // Per-block code deep dive and system design (matched by blockId)
        const fvBlockId = fvBlock?.id;
        const fvCode = codeDeepDiveResponses.find(r => r.blockId === fvBlockId);
        const fvDesign = systemDesignResponses.find(r => r.blockId === fvBlockId);

        // Fallback: show most recent responses if no block match
        const displayCode = fvCode || codeDeepDiveResponses[codeDeepDiveResponses.length - 1];
        const displayDesign = fvDesign || systemDesignResponses[systemDesignResponses.length - 1];

        // AI responses filtered for this block
        const fvAi = fvBlock?.ai;
        const fvAiRag = fvBlock?.aiRag;

        return (
          <div className="fixed inset-0 z-[60] bg-background flex flex-col" style={{ minWidth: 0 }}>

            {/* ── Header: single compact row, never wraps ─────────────── */}
            <div
              className="shrink-0 border-b border-border bg-background"
              style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '0', minHeight: '2.75rem' }}
            >
              {/* LEFT — Back + title */}
              <div className="flex items-center gap-2 pl-4 pr-3 border-r border-border/50 h-full">
                <button
                  onClick={() => setIsFullView(false)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <span className="text-white/15 select-none">|</span>
                <span className="text-xs font-medium text-white/50 whitespace-nowrap hidden sm:block">Full Analysis View</span>
              </div>

              {/* CENTER — Block navigation (takes all available space, centres itself) */}
              <div className="flex items-center justify-center gap-1.5 px-3">
                <button
                  onClick={() => {
                    if (canPrev) setFullViewBlockIdx(fvEntries[fvOrdinal - 1].index);
                  }}
                  disabled={!canPrev}
                  className={cn(
                    'flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] border transition-all whitespace-nowrap',
                    canPrev ? 'border-white/20 text-white/60 hover:text-white hover:border-white/50' : 'border-white/5 text-white/20 cursor-not-allowed'
                  )}
                >
                  <ArrowLeft className="h-2.5 w-2.5" />
                  Prev
                </button>

                <div className="flex items-center gap-1 px-2.5 py-0.5 bg-white/5 rounded border border-white/10 text-[11px] tabular-nums whitespace-nowrap">
                  <span className="text-white/30">Block</span>
                  <span className="font-mono font-semibold text-white/80">{fvOrdinal >= 0 ? fvOrdinal + 1 : '—'}</span>
                  <span className="text-white/20">/ {fvEntries.length}</span>
                </div>

                <button
                  onClick={() => {
                    if (canNext) setFullViewBlockIdx(fvEntries[fvOrdinal + 1].index);
                  }}
                  disabled={!canNext}
                  className={cn(
                    'flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] border transition-all whitespace-nowrap',
                    canNext ? 'border-white/20 text-white/60 hover:text-white hover:border-white/50' : 'border-white/5 text-white/20 cursor-not-allowed'
                  )}
                >
                  Next
                  <ArrowLeft className="h-2.5 w-2.5 rotate-180" />
                </button>

                <button
                  onClick={() => {
                    if (fvEntries.length > 0) setFullViewBlockIdx(fvEntries[fvEntries.length - 1].index);
                  }}
                  disabled={!canNext}
                  className={cn(
                    'px-2 py-0.5 rounded text-[11px] border transition-all whitespace-nowrap',
                    canNext ? 'border-white/20 text-white/35 hover:text-white hover:border-white/40' : 'border-white/5 text-white/15 cursor-not-allowed'
                  )}
                >
                  Latest
                </button>
              </div>

              {/* RIGHT — legend dots (shrinks gracefully, hides labels at small widths) */}
              <div className="flex items-center gap-2 pr-4 pl-3 border-l border-border/50 h-full">
                <span className="flex items-center gap-1 text-[10px] text-white/30 whitespace-nowrap">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span className="hidden md:inline">AI Analysis</span>
                </span>
                <span className="flex items-center gap-1 text-[10px] text-white/30 whitespace-nowrap">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="hidden md:inline">Code Deep Dive</span>
                </span>
                <span className="flex items-center gap-1 text-[10px] text-white/30 whitespace-nowrap">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                  <span className="hidden md:inline">System Design</span>
                </span>
              </div>
            </div>

            {/* ── Transcript ticker — marquee / news-banner ──────────────── */}
            {fvBlock?.text && (
              <div className="shrink-0 border-b border-border bg-white/[0.015]" style={{ height: '2rem', display: 'flex', alignItems: 'center' }}>
                <span className="shrink-0 px-3 text-[10px] text-white/20 font-mono border-r border-white/10 h-full flex items-center select-none">
                  TRANSCRIPT
                </span>
                <div className="marquee-outer flex-1 h-full flex items-center">
                  {/* Duplicate text so the loop is seamless */}
                  <div className="marquee-track">
                    <span className="text-[11px] text-white/40 px-6">
                      {fvBlock.text}&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;{fvBlock.text}
                    </span>
                    <span className="text-[11px] text-white/40 px-6" aria-hidden>
                      {fvBlock.text}&nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;{fvBlock.text}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Three equal columns ────────────────────────────────────── */}
            {/*
              Each column: flex-col, exact 1/3 width via CSS grid to guarantee equal sizing.
              overflow:hidden on the col prevents content escaping.
              ScrollArea inside each col takes the remaining height.
            */}
            <div
              className="flex-1 overflow-hidden"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', minHeight: 0 }}
            >

              {/* Column 1 — AI Analysis */}
              <div className="flex flex-col border-r border-border overflow-hidden" style={{ minWidth: 0 }}>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-blue-950/10 shrink-0">
                  <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                  <span className="text-xs font-semibold text-blue-300 truncate">AI Analysis</span>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ minHeight: 0 }}>
                  <div className="p-4 space-y-3" style={{ minWidth: 0 }}>
                    {fvAi || fvAiRag ? (
                      <>
                        {fvAi && <AIResponse response={fvAi} />}
                        {fvAiRag && ragAuthenticated && <AIResponse response={fvAiRag} />}
                      </>
                    ) : (
                      <div className="text-center text-muted-foreground py-16 text-sm">
                        No analysis for this block yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Column 2 — Code Deep Dive */}
              <div className="flex flex-col border-r border-border overflow-hidden" style={{ minWidth: 0 }}>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-emerald-950/10 shrink-0">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-xs font-semibold text-emerald-300 truncate">Code Deep Dive</span>
                  {!fvCode && displayCode && (
                    <span className="text-[10px] text-white/20 ml-auto shrink-0">latest</span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ minHeight: 0 }}>
                  <div className="p-4 space-y-3" style={{ minWidth: 0 }}>
                    {displayCode ? (
                      <CodeDeepDive response={displayCode} />
                    ) : (
                      <div className="text-center text-muted-foreground py-16">
                        <Terminal className="h-8 w-8 mx-auto mb-3 text-emerald-800" />
                        <p className="text-sm">No Code Deep Dive yet</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Column 3 — System Design Viewer */}
              <div className="flex flex-col overflow-hidden" style={{ minWidth: 0 }}>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-violet-950/10 shrink-0">
                  <span className="h-2 w-2 rounded-full bg-violet-500 shrink-0" />
                  <span className="text-xs font-semibold text-violet-300 truncate">System Design Viewer</span>
                  {!fvDesign && displayDesign && (
                    <span className="text-[10px] text-white/20 ml-auto shrink-0">latest</span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ minHeight: 0 }}>
                  <div className="p-4 space-y-3" style={{ minWidth: 0 }}>
                    {displayDesign ? (
                      <SystemDesignViewer response={displayDesign} counter={displayDesign.counter} />
                    ) : (
                      <div className="text-center text-muted-foreground py-16">
                        <Network className="h-8 w-8 mx-auto mb-3 text-violet-800" />
                        <p className="text-sm">No System Design yet</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        );
      })()}

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
              <div className="mt-2 flex items-center justify-between">
                <span className="text-muted-foreground">AI Analysis</span>
                <Button size="sm" variant={isAiAnalysisEnabled ? 'secondary' : 'outline'} onClick={() => setIsAiAnalysisEnabled(v => !v)}>
                  {isAiAnalysisEnabled ? 'On' : 'Off'}
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
