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
  Check
} from 'lucide-react';
import AIResponse from './AIResponse';
import Settings from './Settings/Settings.jsx';

const TranscriptionRoom = ({ initialService }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [aiResponses, setAiResponses] = useState([]);
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
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [transcriptBlocks, setTranscriptBlocks] = useState([]);
  const [currentBlock, setCurrentBlock] = useState({
    text: '',
    interim: '',
    startTime: null,
    isComplete: false
  });
  const [selectedAgent, setSelectedAgent] = useState('MEETING_ANALYST');
  const [roomContext, setRoomContext] = useState(null);
  const [historyIdx, setHistoryIdx] = useState(null);
  const [historyStage, setHistoryStage] = useState('idle'); // 'new' | 'warn' | 'idle'
  const [historyCopied, setHistoryCopied] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);

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

    socketRef.current = io('http://localhost:5002');

    socketRef.current.on('connect', () => {
      const socketId = socketRef.current.id;
      setRoomId(socketId);
      
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

      setCurrentBlock(prev => {
        // Start block if needed
        const now = Date.now();
        const shouldRotate = prev.startTime && now - prev.startTime > 20000;
        if (!prev.startTime || prev.isComplete || shouldRotate) {
          if (prev.text || prev.interim) {
            setTranscriptBlocks(blocks => {
              const next = [...blocks, { ...prev, isComplete: true }];
              setHistoryIdx(next.length - 1);
              // Flash green, then hold yellow until the next finalized item arrives
              setHistoryStage('new');
              setTimeout(() => setHistoryStage('warn'), 1500);
              return next;
            });
          }
          return {
            text: isFinal ? txt : '',
            interim: isFinal ? '' : txt,
            startTime: now,
            isComplete: false,
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

    // Set up interval for processing accumulated transcripts
    const analysisInterval = setInterval(() => {
      setCurrentSegment(prev => {
        if (prev.text.trim()) {
          processTranscriptionWithAI(prev.text);
          return { text: '', startTime: null, timeLeft: 20 };
        }
        return prev;
      });
    }, ANALYSIS_INTERVAL);

    socketRef.current.on('ai_response', (response) => {
      setAiResponses(prev => [...prev, {
        text: response.text,
        timestamp: new Date().toISOString(),
        isError: response.isError,
        isMock: response.isMock,
        agent: response.agent,
        roomContext: response.roomContext,
        isFormatted: response.isFormatted
      }]);
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
      clearInterval(analysisInterval);
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
      setIsProviderLocked(true);
      setCurrentStep('transcribing');
      
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
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <StepIndicator />
          <div className="flex items-center gap-4">
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
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isAutoScrollEnabled}
                        onChange={(e) => setIsAutoScrollEnabled(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-muted-foreground">Auto Scroll</span>
                    </label>
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
                  {aiResponses.length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                      <p>Analysis will appear every 20 seconds.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {aiResponses.map((response, index) => (
                        <Card key={index}>
                          <CardContent className="pt-6">
                            <AIResponse response={response} />
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
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
    </div>
  );
};

export default TranscriptionRoom; 