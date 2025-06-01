import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Bot, Copy, Check, Clock, AlertCircle, Sparkles, Users, Brain, ListChecks } from 'lucide-react';
import { cn } from '../lib/utils';

// Agent icon mapping
const AGENT_ICONS = {
  'Meeting Analyst': Bot,
  'Onboarding Assistant': Users,
  'Technical Architect': Brain,
  'Action Tracker': ListChecks,
  'System': AlertCircle
};

const AGENT_COLORS = {
  'Meeting Analyst': 'text-blue-600',
  'Onboarding Assistant': 'text-green-600',
  'Technical Architect': 'text-purple-600',
  'Action Tracker': 'text-orange-600',
  'System': 'text-gray-600'
};

function AIResponse({ response }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // Extract text content from HTML if formatted
      const textContent = response.isFormatted 
        ? response.text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
        : response.text;
      
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const AgentIcon = AGENT_ICONS[response.agent] || Bot;
  const agentColor = AGENT_COLORS[response.agent] || 'text-gray-600';

    return (
    <Card className={cn(
      "mb-4",
      response.isError && "border-destructive/50",
      response.isFallback && "border-yellow-500/50"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <AgentIcon className={cn("h-5 w-5", agentColor)} />
            <span className="font-semibold text-sm">{response.agent || 'AI Analysis'}</span>
            {response.isFallback && (
              <Badge variant="outline" className="text-xs">Fallback</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              {formatTime(response.timestamp)}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className={cn("h-8 px-2", copied && "text-green-500")}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {response.isFormatted ? (
          <div 
            className="ai-response-content"
            dangerouslySetInnerHTML={{ __html: response.text }}
          />
        ) : (
          <div className="space-y-3">
            {response.text.split('\n').map((line, idx) => {
              if (!line.trim()) return null;
              
              // Check if it's a header
              if (line.includes(':') && line.trim().endsWith(':')) {
                return (
                  <h3 key={idx} className="font-semibold text-sm mt-4 mb-2">
                    {line}
                  </h3>
                );
              }
              
              // Check if it's a bullet point
              if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
                return (
                  <div key={idx} className="flex items-start gap-2 ml-4">
                    <span className="text-muted-foreground">•</span>
                    <span className="text-sm">{line.substring(1).trim()}</span>
        </div>
    );
              }
              
              // Regular paragraph
              return (
                <p key={idx} className="text-sm">
                  {line}
                </p>
              );
            })}
          </div>
        )}
        
        {response.isError && (
          <div className="mt-4 p-3 bg-destructive/10 rounded-md flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
            <p className="text-sm text-destructive">
              Analysis service temporarily unavailable
            </p>
          </div>
        )}
        
        {/* Room Context Summary */}
        {response.roomContext && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Meeting Context</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {response.roomContext.meetingType && (
                <Badge variant="outline" className="text-xs">
                  {response.roomContext.meetingType}
                </Badge>
              )}
              {response.roomContext.participants?.slice(0, 3).map((participant, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {participant}
                </Badge>
              ))}
              {response.roomContext.participants?.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{response.roomContext.participants.length - 3} more
                </Badge>
              )}
            </div>
          </div>
        )}
        
        {/* Tags Display */}
        {response.tagMetadata && response.tagMetadata.length > 0 && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-muted-foreground">Tags</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {response.tagMetadata.map((tag, idx) => (
                <Badge 
                  key={idx} 
                  variant="outline" 
                  className="text-xs"
                  style={{ 
                    borderColor: tag.color || '#888888',
                    color: tag.color || '#888888'
                  }}
                >
                  {tag.icon && <span className="mr-1">{tag.icon}</span>}
                  {tag.category}:{tag.value}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      
      {/* Enhanced styling for formatted responses */}
      <style jsx global>{`
        .ai-response-content {
          font-size: 0.875rem;
          line-height: 1.6;
        }
        
        .ai-response-content .ai-analysis {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .ai-response-content .agent-header {
          font-weight: 600;
          color: var(--primary);
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }
        
        .ai-response-content .analysis-section {
          padding: 0.75rem;
          background: var(--muted);
          border-radius: 0.5rem;
          margin-bottom: 0.75rem;
        }
        
        .ai-response-content .section-header {
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: var(--foreground);
        }
        
        .ai-response-content .bullet-item {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
        }
        
        .ai-response-content .bullet {
          color: var(--muted-foreground);
          flex-shrink: 0;
        }
        
        .ai-response-content .bullet-label {
          font-weight: 500;
          color: var(--foreground);
        }
        
        .ai-response-content .bullet-value {
          color: var(--muted-foreground);
        }
        
        .ai-response-content .bullet-text {
          color: var(--foreground);
        }
        
        .ai-response-content strong {
          font-weight: 600;
          color: var(--foreground);
        }
        
        .ai-response-content code {
          padding: 0.125rem 0.25rem;
          background: var(--muted);
          border-radius: 0.25rem;
          font-family: monospace;
          font-size: 0.8rem;
        }
        
        .ai-response-content p {
          margin-bottom: 0.5rem;
        }
        
        .ai-response-content p:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </Card>
  );
}

export default AIResponse; 