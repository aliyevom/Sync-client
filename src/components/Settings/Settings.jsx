import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { 
  Settings as SettingsIcon, 
  X, 
  Lock, 
  Bot, 
  Users, 
  Brain, 
  ListChecks,
  Building2,
  Info,
  ChevronRight,
  FileText,
  Database,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';

const AI_AGENTS = [
  {
    id: 'MEETING_ANALYST',
    name: 'Meeting Analyst',
    description: 'Analyzes conversations for actionable insights, decisions, and team context',
    icon: Bot,
    color: 'text-blue-600',
    features: ['Action items', 'Key decisions', 'Team dynamics', 'Meeting summaries']
  },
  {
    id: 'ONBOARDING_ASSISTANT',
    name: 'Onboarding Assistant',
    description: 'Helps new team members understand context and team structure',
    icon: Users,
    color: 'text-green-600',
    features: ['Term explanations', 'Team introductions', 'Learning resources', 'Next steps']
  },
  {
    id: 'TECHNICAL_ARCHITECT',
    name: 'Technical Architect',
    description: 'Focuses on technical decisions, architecture, and best practices',
    icon: Brain,
    color: 'text-purple-600',
    features: ['Architecture review', 'Tech recommendations', 'Risk assessment', 'Best practices']
  },
  {
    id: 'ACTION_TRACKER',
    name: 'Action Tracker',
    description: 'Tracks action items, decisions, and commitments',
    icon: ListChecks,
    color: 'text-orange-600',
    features: ['Action items', 'Decision tracking', 'Blockers', 'Commitments']
  },
  {
    id: 'SPOKEN_RESPONDER',
    name: 'Speaker Coach',
    description: 'Generates one-paragraph, human-sounding replies you can read aloud',
    icon: Bot,
    color: 'text-amber-600',
    features: ['Single paragraph', 'Human tone', 'Conversation flow']
  }
];

function Settings({ 
  selectedService, 
  setSelectedService, 
  currentStep, 
  setCurrentStep, 
  isProviderLocked,
  selectedAgent = 'MEETING_ANALYST',
  onAgentChange,
  roomContext,
  socket,
  roomId,
  onRAGAuthChange
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('provider');
  const [teamContext, setTeamContext] = useState(null);
  const [documentHealth, setDocumentHealth] = useState(null);
  const [isProcessingDocs, setIsProcessingDocs] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState(null); // 'n1', 'u1', or null for both
  const [ragPassword, setRagPassword] = useState('');
  const [ragAuthenticated, setRagAuthenticated] = useState(() => {
    // Check if already authenticated in this session
    return localStorage.getItem('rag_authenticated') === 'true';
  });
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);

  useEffect(() => {
    if (socket && roomId && activeTab === 'context') {
      socket.emit('get_room_context', roomId);
      
      const handleRoomContext = (context) => {
        setTeamContext(context);
      };
      
      socket.on('room_context', handleRoomContext);
      
      return () => {
        socket.off('room_context', handleRoomContext);
      };
    }
    
    // Fetch document health when Documents tab is active
    if (activeTab === 'documents') {
      fetchDocumentHealth();
    }
  }, [socket, roomId, activeTab]);

  const fetchDocumentHealth = async () => {
    try {
      const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5002';
      const response = await fetch(`${serverUrl}/api/document-health`);
      const data = await response.json();
      setDocumentHealth(data);
    } catch (error) {
      console.error('Error fetching document health:', error);
      setDocumentHealth({ error: 'Failed to fetch document status' });
    }
  };

  const handleProcessDocuments = async () => {
    setIsProcessingDocs(true);
    try {
      const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5002';
      const response = await fetch(`${serverUrl}/api/process-documents`, {
        method: 'POST'
      });
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to process documents');
      }
      
      alert(`Processed ${result.totalDocuments || 0} documents with ${result.totalChunks || 0} chunks`);
      await fetchDocumentHealth();
    } catch (error) {
      alert('Error processing documents: ' + error.message);
    } finally {
      setIsProcessingDocs(false);
    }
  };

  // Verify password (simple comparison)
  // IMPORTANT: REACT_APP_* values are bundled into the client and are NOT secrets.
  // Use this only as a UX gate, not real security.
  const verifyPassword = async (password) => {
    const correctPassword = process.env.REACT_APP_RAG_PASSWORD;

    // If no password is configured, always fail and log a warning in dev.
    if (!correctPassword) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[RAG] REACT_APP_RAG_PASSWORD is not set – password check will always fail.');
      }
      return false;
    }

    return password === correctPassword;
  };

  const handleLogout = () => {
    setRagAuthenticated(false);
    localStorage.removeItem('rag_authenticated');
    setShowPasswordPrompt(false);
    if (onRAGAuthChange) {
      onRAGAuthChange(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    const isValid = await verifyPassword(ragPassword);
    if (isValid) {
      setRagAuthenticated(true);
      localStorage.setItem('rag_authenticated', 'true');
      setShowPasswordPrompt(false);
      setRagPassword('');
      if (onRAGAuthChange) {
        onRAGAuthChange(true);
      }
    } else {
      alert('Incorrect password. Document-Enhanced AI Analysis will remain disabled.');
      setRagPassword('');
    }
  };

  // Notify parent of authentication status on mount
  useEffect(() => {
    if (onRAGAuthChange) {
      onRAGAuthChange(ragAuthenticated);
    }
  }, [ragAuthenticated, onRAGAuthChange]);

  const handleDocumentsTabClick = () => {
    if (!ragAuthenticated) {
      setShowPasswordPrompt(true);
    }
    setActiveTab('documents');
  };

  const handleBucketSelect = (bucket) => {
    setSelectedBucket(bucket);
    // Use socket ID directly if roomId prop is empty
    const currentRoomId = roomId || socket?.id;
    if (socket && currentRoomId) {
      console.log(`[CLIENT] Selecting bucket: ${bucket} for room: ${currentRoomId}`);
      socket.emit('select_document_bucket', { roomId: currentRoomId, bucket });
    } else {
      console.warn(`[X] [CLIENT] Cannot select bucket: socket=${!!socket}, roomId=${currentRoomId}`);
    }
  };

  const handleServiceSelect = (service) => {
    setSelectedService(service);
    setCurrentStep('recording');
  };

  const handleAgentSelect = (agentId) => {
    if (onAgentChange) {
      onAgentChange(agentId);
    }
    if (socket && roomId) {
      socket.emit('switch_agent', { roomId, agentType: agentId });
    }
  };

  const tabs = [
    { id: 'provider', label: 'Speech Provider', icon: SettingsIcon },
    { id: 'agent', label: 'AI Agent', icon: Bot },
    { id: 'context', label: 'Team Context', icon: Building2 },
    { id: 'documents', label: 'Documents', icon: FileText }
  ];

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsOpen(true)}
        aria-label="Settings"
      >
        <SettingsIcon className="h-5 w-5" />
      </Button>

      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center pt-20 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <Card className="w-full max-w-2xl mx-4 my-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Settings</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Tabs */}
              <div className="flex gap-2 mt-4">
                {tabs.map((tab) => (
                  <Button
                    key={tab.id}
                    variant={activeTab === tab.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      if (tab.id === 'documents') {
                        handleDocumentsTabClick();
                      } else {
                        setActiveTab(tab.id);
                      }
                    }}
                    className="flex items-center gap-2"
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            
            <CardContent>
              {/* Provider Tab */}
              {activeTab === 'provider' && (
                <>
                  <CardDescription className="mb-6">
                    Choose your preferred speech-to-text service
                  </CardDescription>
                  <div className="grid grid-cols-3 gap-4">
                    <button
                      className={`
                        relative p-6 rounded-lg border-2 transition-all
                        border-border opacity-60 cursor-not-allowed
                      `}
                      disabled
                    >
                      <img 
                        src="/images/gcp.png" 
                        alt="Google Cloud Platform"
                        className="w-full h-20 object-contain mb-2"
                      />
                      <p className="text-sm font-medium">Google Cloud</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Unavailable
                      </p>
                    </button>

                    <button
                      className={`
                        relative p-6 rounded-lg border-2 transition-all
                        border-border opacity-60 cursor-not-allowed
                      `}
                      disabled
                    >
                      <img 
                        src="/images/openai.png" 
                        alt="OpenAI"
                        className="w-full h-20 object-contain mb-2"
                      />
                      <p className="text-sm font-medium">OpenAI Whisper</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Unavailable
                      </p>
                    </button>

                    <button
                      className={`
                        relative p-6 rounded-lg border-2 transition-all
                        ${selectedService === 'deepgram' 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border hover:border-primary/50'}
                        ${currentStep === 'transcribing' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                      onClick={() => handleServiceSelect('deepgram')}
                      disabled={currentStep === 'transcribing'}
                    >
                      <Badge className="absolute top-2 right-2" variant="secondary">Available</Badge>
                      <img 
                        src="/images/deepgram.svg" 
                        alt="Deepgram"
                        className="w-full h-20 object-contain mb-2"
                      />
                      <p className="text-sm font-medium">Deepgram</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Low latency • High accuracy • Diarization
                      </p>
                    </button>
                  </div>

                  {currentStep === 'transcribing' && (
                    <div className="mt-4 p-4 bg-muted rounded-lg flex items-center gap-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Provider selection locked during transcription
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* AI Agent Tab */}
              {activeTab === 'agent' && (
                <>
                  <CardDescription className="mb-6">
                    Select an AI agent based on your meeting type and goals
                  </CardDescription>
                  <div className="space-y-3">
                    {AI_AGENTS.map((agent) => (
                      <button
                        key={agent.id}
                        className={`
                          w-full p-4 rounded-lg border-2 transition-all text-left
                          ${selectedAgent === agent.id 
                            ? 'border-primary bg-primary/10' 
                            : 'border-border hover:border-primary/50'}
                        `}
                        onClick={() => handleAgentSelect(agent.id)}
                      >
                        <div className="flex items-start gap-3">
                          <agent.icon className={`h-6 w-6 mt-0.5 ${agent.color}`} />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium">{agent.name}</h4>
                              {selectedAgent === agent.id && (
                                <Badge variant="default" className="text-xs">Active</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {agent.description}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {agent.features.map((feature, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {feature}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  
                  <div className="mt-6 p-4 bg-muted rounded-lg">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="text-sm text-muted-foreground">
                        <p className="font-medium mb-1">Pro tip:</p>
                        <ul className="space-y-1 ml-4">
                          <li>• Use <strong>Meeting Analyst</strong> for general team meetings</li>
                          <li>• Switch to <strong>Onboarding Assistant</strong> when training new members</li>
                          <li>• Use <strong>Technical Architect</strong> for design discussions</li>
                          <li>• Enable <strong>Action Tracker</strong> for planning sessions</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Team Context Tab */}
              {activeTab === 'context' && (
                <>
                  <CardDescription className="mb-6">
                    Current meeting context and team information
                  </CardDescription>
                  
                  {teamContext ? (
                    <div className="space-y-4">
                      {/* Meeting Type */}
                      <div className="p-4 bg-muted rounded-lg">
                        <h4 className="font-medium flex items-center gap-2 mb-2">
                          <Bot className="h-4 w-4" />
                          Meeting Type
                        </h4>
                        <Badge variant="outline" className="capitalize">
                          {teamContext.meetingType || 'General Meeting'}
                        </Badge>
                      </div>

                      {/* Participants */}
                      {teamContext.participants && teamContext.participants.length > 0 && (
                        <div className="p-4 bg-muted rounded-lg">
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Users className="h-4 w-4" />
                            Participants Mentioned
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {teamContext.participants.map((participant, idx) => (
                              <Badge key={idx} variant="secondary">
                                {participant}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Topics */}
                      {teamContext.topics && teamContext.topics.length > 0 && (
                        <div className="p-4 bg-muted rounded-lg">
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Brain className="h-4 w-4" />
                            Technologies & Topics
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {teamContext.topics.map((topic, idx) => (
                              <Badge key={idx} variant="outline">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Projects */}
                      {teamContext.projectsMentioned && teamContext.projectsMentioned.length > 0 && (
                        <div className="p-4 bg-muted rounded-lg">
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <Building2 className="h-4 w-4" />
                            Projects Mentioned
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {teamContext.projectsMentioned.map((project, idx) => (
                              <Badge key={idx} variant="default">
                                {project}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recent Action Items */}
                      {teamContext.actionItems && teamContext.actionItems.length > 0 && (
                        <div className="p-4 bg-muted rounded-lg">
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <ListChecks className="h-4 w-4" />
                            Recent Action Items
                          </h4>
                          <ul className="space-y-2">
                            {teamContext.actionItems.map((item, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-sm">
                                <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5" />
                                <span>{item.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No meeting context available yet.</p>
                      <p className="text-sm mt-2">Context will appear once the meeting starts.</p>
                    </div>
                  )}

                  <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <div className="text-sm text-blue-900 dark:text-blue-100">
                        <p className="font-medium mb-1">About Team Context</p>
                        <p>
                          The AI automatically identifies team members, projects, and technologies 
                          mentioned during your meeting. This helps provide more accurate and 
                          relevant analysis based on your organization's specific context.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Documents Tab */}
              {activeTab === 'documents' && (
                <>
                  <CardDescription className="mb-6">
                    Document knowledge base powered by Qwen3 Embeddings and GCS
                  </CardDescription>
                  
                  {/* Password Protection */}
                  {showPasswordPrompt && !ragAuthenticated && (
                    <div className="mb-6 p-4 bg-muted rounded-lg border-2 border-purple-500/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Lock className="h-5 w-5 text-purple-400" />
                        <h4 className="font-semibold">Password Required</h4>
                      </div>
                      <p className="text-sm text-muted-foreground mb-4">
                        Enter password to enable Document-Enhanced AI Analysis
                      </p>
                      <form onSubmit={handlePasswordSubmit} className="space-y-3">
                        <input
                          type="password"
                          value={ragPassword}
                          onChange={(e) => setRagPassword(e.target.value)}
                          placeholder="Enter password"
                          className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" className="bg-purple-600 hover:bg-purple-700">
                            Unlock
                          </Button>
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              setShowPasswordPrompt(false);
                              setRagPassword('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}

                  {ragAuthenticated && (
                    <div className="mb-4 p-2 bg-green-950/20 border border-green-500/30 rounded-md flex items-center justify-between">
                      <p className="text-xs text-green-300 flex items-center gap-2">
                        <CheckCircle className="h-3 w-3" />
                        Document-Enhanced AI Analysis enabled
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLogout}
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                      >
                        Logout
                      </Button>
                    </div>
                  )}
                  
                  {ragAuthenticated && documentHealth ? (
                    <div className="space-y-4">
                      {/* GCS Status */}
                      <div className="p-4 bg-muted rounded-lg">
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <Database className="h-4 w-4" />
                          Google Cloud Storage
                        </h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Status</span>
                            <Badge variant={documentHealth.gcs?.enabled ? "default" : "destructive"}>
                              {documentHealth.gcs?.enabled ? (
                                <><CheckCircle className="h-3 w-3 mr-1" />Connected</>
                              ) : (
                                <><XCircle className="h-3 w-3 mr-1" />Disconnected</>
                              )}
                            </Badge>
                          </div>
                          {documentHealth.gcs?.enabled && (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Project ID</span>
                                <span className="text-sm font-mono">{documentHealth.gcs.projectId}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Bucket N-1</span>
                                <span className="text-sm font-mono">{documentHealth.gcs.buckets?.n1}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Bucket U-1</span>
                                <span className="text-sm font-mono">{documentHealth.gcs.buckets?.u1}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Document Bucket Selection for RAG */}
                      <div className="p-4 bg-muted rounded-lg">
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <FileText className="h-4 w-4" />
                          Document Source Selection
                        </h4>
                        <p className="text-sm text-muted-foreground mb-3">
                          Choose which document bucket to use for AI analysis. The AI will search only the selected bucket(s) during meetings.
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          <Button
                            variant={selectedBucket === null ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleBucketSelect(null)}
                            className="flex flex-col items-center gap-1 h-auto py-3"
                          >
                            <span className="font-medium">Both</span>
                            <span className="text-xs opacity-80">N-1 + U-1</span>
                          </Button>
                          <Button
                            variant={selectedBucket === 'n1' ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleBucketSelect('n1')}
                            className="flex flex-col items-center gap-1 h-auto py-3"
                          >
                            <span className="font-medium">N-1 Only</span>
                            <span className="text-xs opacity-80">Bucket N-1</span>
                          </Button>
                          <Button
                            variant={selectedBucket === 'u1' ? "default" : "outline"}
                            size="sm"
                            onClick={() => handleBucketSelect('u1')}
                            className="flex flex-col items-center gap-1 h-auto py-3"
                          >
                            <span className="font-medium">U-1 Only</span>
                            <span className="text-xs opacity-80">Bucket U-1</span>
                          </Button>
                        </div>
                        {selectedBucket !== null && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Currently searching: <strong>{selectedBucket === 'n1' ? 'Bucket N-1' : selectedBucket === 'u1' ? 'Bucket U-1' : 'Both Buckets'}</strong>
                          </p>
                        )}
                      </div>

                      {/* Embeddings Status */}
                      <div className="p-4 bg-muted rounded-lg">
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <Brain className="h-4 w-4" />
                          Embedding Model
                        </h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Provider</span>
                            <Badge variant="outline">{documentHealth.embeddings?.provider}</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Model</span>
                            <span className="text-sm font-mono">{documentHealth.embeddings?.model}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Dimensions</span>
                            <span className="text-sm">{documentHealth.embeddings?.dimensions}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">API Key</span>
                            <Badge variant={documentHealth.embeddings?.configured ? "default" : "destructive"}>
                              {documentHealth.embeddings?.configured ? 'Configured' : 'Missing'}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      {/* Vector DB Status */}
                      <div className="p-4 bg-muted rounded-lg">
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <Database className="h-4 w-4" />
                          Vector Database
                        </h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Type</span>
                            <Badge variant="outline" className="capitalize">
                              {documentHealth.vectorDb?.type}
                            </Badge>
                          </div>
                          {documentHealth.vectorDb?.type !== 'memory' && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">URL</span>
                              <span className="text-sm font-mono">{documentHealth.vectorDb?.url}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Collection</span>
                            <span className="text-sm font-mono">{documentHealth.vectorDb?.collection}</span>
                          </div>
                          {documentHealth.vectorDb?.documentsCount !== 'N/A' && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Documents</span>
                              <Badge>{documentHealth.vectorDb?.documentsCount}</Badge>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Processing Status */}
                      <div className="p-4 bg-muted rounded-lg">
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <FileText className="h-4 w-4" />
                          Processing Status
                        </h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Last Processed</span>
                            <span className="text-sm">
                              {documentHealth.processing?.lastProcessed 
                                ? new Date(documentHealth.processing.lastProcessed).toLocaleString()
                                : 'Never'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Total Documents</span>
                            <Badge>{documentHealth.processing?.totalDocuments || 0}</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Total Chunks</span>
                            <Badge>{documentHealth.processing?.totalChunks || 0}</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Auto Processing</span>
                            <Badge variant={documentHealth.processing?.autoProcessing ? "success" : "secondary"}>
                              {documentHealth.processing?.autoProcessing ? 'Enabled' : 'Disabled'}
                            </Badge>
                          </div>
                          {documentHealth.processing?.autoProcessing && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Schedule</span>
                              <span className="text-sm font-mono">{documentHealth.processing?.schedule}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Recent Documents (show only a small sample to avoid huge lists) */}
                      {documentHealth.processing?.recentDocuments?.length > 0 && (
                        <div className="p-4 bg-muted rounded-lg">
                          <h4 className="font-medium flex items-center gap-2 mb-3">
                            <FileText className="h-4 w-4" />
                            Recently Processed
                          </h4>
                          {(() => {
                            const recentDocs = documentHealth.processing.recentDocuments || [];
                            const maxToShow = 5;
                            const visibleDocs = recentDocs.slice(0, maxToShow);
                            const hiddenCount = Math.max(0, recentDocs.length - visibleDocs.length);

                            return (
                              <>
                                <div className="space-y-2">
                                  {visibleDocs.map((doc, idx) => (
                                    <div key={idx} className="text-sm p-2 bg-background rounded border">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium truncate max-w-[55%]">{doc.filename}</span>
                                        <Badge variant="outline" className="text-xs">
                                          {doc.chunks} chunks
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                                        <span className="truncate max-w-[55%]">{doc.bucket}</span>
                                        <span>{new Date(doc.processedAt).toLocaleString()}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                {hiddenCount > 0 && (
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    +{hiddenCount} more documents recently processed
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {/* Manual Processing Button */}
                      <div className="pt-4 border-t">
                        <Button 
                          onClick={handleProcessDocuments}
                          disabled={isProcessingDocs || !documentHealth.gcs?.enabled}
                          className="w-full"
                        >
                          {isProcessingDocs ? (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                              Processing Documents...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Process Documents Now
                            </>
                          )}
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                          Manually trigger document processing from GCS buckets
                        </p>
                      </div>
                    </div>
                  ) : ragAuthenticated ? (
                    <div className="flex items-center justify-center py-12">
                      <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : null}

                  {/* Info Box */}
                  <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <div className="text-sm text-blue-900 dark:text-blue-100">
                        <p className="font-medium mb-1">About Document Knowledge Base</p>
                        <p className="mb-2">
                          Upload PDFs, TXT, and MD files to your GCS buckets. The system uses 
                          Qwen3 Embedding 8B to semantically index your documents.
                        </p>
                        <p>
                          During meetings, the AI will automatically search relevant documents and 
                          use them as authoritative sources when topics match your documentation.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

export default Settings; 