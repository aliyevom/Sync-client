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
  ChevronRight
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
  roomId
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('provider');
  const [teamContext, setTeamContext] = useState(null);

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
  }, [socket, roomId, activeTab]);

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
    { id: 'context', label: 'Team Context', icon: Building2 }
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
                    onClick={() => setActiveTab(tab.id)}
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
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      className={`
                        relative p-6 rounded-lg border-2 transition-all
                        ${selectedService === 'google' 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border hover:border-primary/50'}
                        ${currentStep === 'transcribing' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                      onClick={() => handleServiceSelect('google')}
                      disabled={currentStep === 'transcribing'}
                    >
                      <img 
                        src="/images/gcp.png" 
                        alt="Google Cloud Platform"
                        className="w-full h-20 object-contain mb-2"
                      />
                      <p className="text-sm font-medium">Google Cloud</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Real-time streaming • Speaker detection
                      </p>
                    </button>

                    <button
                      className={`
                        relative p-6 rounded-lg border-2 transition-all
                        ${selectedService === 'openai' 
                          ? 'border-primary bg-primary/10' 
                          : 'border-border hover:border-primary/50'}
                        ${currentStep === 'transcribing' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                      onClick={() => handleServiceSelect('openai')}
                      disabled={currentStep === 'transcribing'}
                    >
                      <Badge className="absolute top-2 right-2" variant="default">
                        Recommended
                      </Badge>
                      <img 
                        src="/images/openai.png" 
                        alt="OpenAI"
                        className="w-full h-20 object-contain mb-2"
                      />
                      <p className="text-sm font-medium">OpenAI Whisper</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        High accuracy • Better with accents
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
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

export default Settings; 