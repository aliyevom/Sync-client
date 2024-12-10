import React, { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { saveAs } from 'file-saver';
import './TranscriptionRoom.css';
import AIResponse from './AIResponse';
import Settings from './Settings/Settings';

const TranscriptionRoom = ({ initialService }) => {
  const [transcripts, setTranscripts] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [aiResponses, setAiResponses] = useState([]);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [pendingTranscripts, setPendingTranscripts] = useState([]);
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
    startTime: null,
    isComplete: false
  });

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
      if (transcription.isFinal) {
        // Clean up the transcription text by removing leading "you" if it's the first word
        const cleanedText = transcription.text.replace(/^you\s*/i, '').trim();
        
        // Only update if there's actual content after cleaning
        if (cleanedText) {
          setCurrentBlock(prev => {
            const now = Date.now();
            
            // If no current block or block is complete, start a new one
            if (!prev.startTime || prev.isComplete) {
              return {
                text: cleanedText,
                startTime: now,
                isComplete: false
              };
            }
            
            // Check if 20 seconds have passed
            const blockAge = now - prev.startTime;
            if (blockAge >= 20000) {
              // Complete current block and start new one
              setTranscriptBlocks(blocks => [...blocks, {
                ...prev,
                isComplete: true
              }]);
              
              return {
                text: cleanedText,
                startTime: now,
                isComplete: false
              };
            }
            
            // Add to current block
            return {
              ...prev,
              text: prev.text + ' ' + cleanedText
            };
          });

          // Update current segment for AI analysis with cleaned text
          setCurrentSegment(prev => {
            if (!prev.startTime) {
              return {
                text: cleanedText,
                startTime: Date.now(),
                timeLeft: 20
              };
            }
            return {
              ...prev,
              text: prev.text + ' ' + cleanedText
            };
          });
        }
      }
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
        isMock: response.isMock
      }]);
      setIsAiThinking(false);
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
    socketRef.current.emit('process_with_ai', { text, roomId });
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
          channelCount: 1
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
      const processor = audioContextRef.current.createScriptProcessor(8192, 1, 1);
      
      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const resampledData = new Float32Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          resampledData[i] = inputData[i];
        }
        
        const pcmData = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          const s = Math.max(-1, Math.min(1, resampledData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        socketRef.current.emit('audio_data', {
          roomId,
          audio: pcmData.buffer,
          isScreenShare: true,
          service: selectedService
        });
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
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(1024, 1, 1);
      
      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      processor.onaudioprocess = (e) => {
        const audioData = e.inputBuffer.getChannelData(0);
        const int16Array = new Int16Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
          int16Array[i] = audioData[i] * 0x7FFF;
        }
        
        socketRef.current.emit('audio_data', {
          roomId,
          audio: int16Array.buffer,
          isScreenShare: !!existingStream,
          service: selectedService
        });
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
    const text = transcripts.map(t => t.text).join('\n\n');
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
      <div className="step-indicator">
        <div className={`step ${currentStep === 'provider' ? 'active' : ''}`}>
          <div className="step-number">1</div>
          <div className="step-label">Select Provider</div>
        </div>
        <div className={`step ${currentStep === 'recording' ? 'active' : ''}`}>
          <div className="step-number">2</div>
          <div className="step-label">Start Recording</div>
        </div>
        <div className={`step ${currentStep === 'transcribing' ? 'active' : ''}`}>
          <div className="step-number">3</div>
          <div className="step-label">Transcribing</div>
        </div>
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
  }, [aiResponses, transcripts]);

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
      <button 
        className={`copy-button ${copied ? 'copied' : ''}`} 
        onClick={handleCopy}
        title="Copy to clipboard"
      >
        {copied ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy
          </>
        )}
      </button>
    );
  };

  const renderTranscripts = () => {
    if (transcriptBlocks.length === 0 && !currentBlock.text) {
      return (
        <div className="transcript empty">
          <span className="text">Start recording or share your screen to begin transcription...</span>
        </div>
      );
    }

    return (
      <>
        {transcriptBlocks.map((block, index) => (
          <div key={index} className="transcript-block">
            <div className="content">{block.text}</div>
            <CopyButton text={block.text} />
          </div>
        ))}
        {currentBlock.text && (
          <div className="transcript-block active">
            <div className="content">{currentBlock.text}</div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="transcription-room">
      <div className="floating-element"></div>
      <div className="floating-element"></div>
      <div className="floating-element"></div>
      <div className="header">
        <Settings 
          selectedService={selectedService}
          setSelectedService={setSelectedService}
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
          isProviderLocked={isProviderLocked}
        />
      </div>
      <StepIndicator />

      <div className="split-view">
        <div className="left-panel">
          <div className="transcription-panel">
            <h2>
              <span>Live Transcription</span>
              {(isRecording || isScreenSharing) ? (
                <div className="header-status recording">
                  <div className="recording-dot"></div>
                  <span>Recording...</span>
                </div>
              ) : (
                <div className="header-status ready">
                  <div className="recording-dot"></div>
                  <span>Ready</span>
                </div>
              )}
            </h2>

            <div className="controls-container">
              <div className="lock-overlay" style={{ display: currentStep === 'provider' ? 'flex' : 'none' }}>
                <span className="lock-icon">🔒</span>
                <p>Please select a provider first</p>
              </div>
              
              <div className="screen-preview-container">
                <div className={`screen-preview ${isFullscreen ? 'fullscreen' : ''}`}>
                  {screenPreview ? (
                    <>
                      <video 
                        ref={videoRef}
                        autoPlay 
                        muted 
                        playsInline
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                      <div className="stream-status">
                        <div className="status-dot"></div>
                        <span>Live</span>
                      </div>
                      <div className="video-controls">
                        <div className="time-display">
                          <span className="recording-time">
                            {/* Add recording time display if needed */}
                          </span>
                        </div>
                        <div className="floating-controls">
                          <button 
                            onClick={stopScreenShare}
                            className="stop-screen"
                          >
                            Stop
                          </button>
                          <button
                            onClick={toggleFullscreen}
                            className="fullscreen-button"
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16">
                              <path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                            </svg>
                          </button>
                          {transcripts.length > 0 && (
                            <button 
                              onClick={exportTranscript} 
                              className="export"
                            >
                              Export
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="preview-placeholder">
                      <div className="preview-overlay">
                        <div className="floating-controls">
                          <button 
                            onClick={startScreenShare}
                            className="start-screen"
                            disabled={currentStep === 'provider' || !selectedService}
                          >
                            Share Screen/Tab
                          </button>
                          {transcripts.length > 0 && (
                            <button 
                              onClick={exportTranscript} 
                              className="export"
                              disabled={transcripts.length === 0}
                            >
                              Export
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div 
              className="transcripts" 
              ref={transcriptsRef}
            >
              {renderTranscripts()}
            </div>
          </div>
        </div>

        <div className="ai-response-panel">
          <div className="panel-header">
            <h2>AI Analysis</h2>
            <div className="segment-status">
              <div className="status-indicator">
                <div className="progress-bar" style={{ 
                  width: `${(currentSegment.timeLeft / 20) * 100}%` 
                }}></div>
                {currentSegment.startTime ? (
                  <span>Collecting conversation... {currentSegment.timeLeft}s until analysis</span>
                ) : (
                  <span>Waiting for conversation to begin...</span>
                )}
              </div>
            </div>
            <div className="auto-scroll-toggle">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={isAutoScrollEnabled}
                  onChange={(e) => setIsAutoScrollEnabled(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
              <span className="toggle-label">Auto Scroll</span>
            </div>
          </div>
          <div className="ai-responses" ref={aiResponsesRef}>
            {aiResponses.length === 0 ? (
              <div className="ai-response">
                <span className="text">
                  Collecting conversation context... Analysis will appear every 20 seconds.
                </span>
              </div>
            ) : (
              aiResponses.map((response, index) => (
                <AIResponse 
                  key={index} 
                  text={response.text}
                />
              ))
            )}
            {isAiThinking && (
              <div className="ai-thinking">
                <div className="thinking-dots"></div>
                Analyzing recent conversation...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TranscriptionRoom;
