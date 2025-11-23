import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Bot, Copy, Check, Clock, AlertCircle, Users, Brain, ListChecks, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import RAGHighlightedText from './RAGHighlightedText';

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
  
  // Log the entire response object for debugging
  console.log('[AIResponse] component received:', {
    analysisType: response.analysisType,
    ragUsed: response.ragUsed,
    ragSources: response.ragSources,
    hasText: !!response.text,
    textLength: response.text?.length,
    allKeys: Object.keys(response)
  });

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
  
  const isDocumentEnhanced = response.analysisType === 'document-enhanced';
  const isOriginal = response.analysisType === 'original';
  
  console.log('[AIResponse] computed values:', {
    isDocumentEnhanced,
    isOriginal,
    'response.analysisType': response.analysisType,
    'response.ragUsed': response.ragUsed,
    'condition (isDocumentEnhanced && response.ragUsed)': isDocumentEnhanced && response.ragUsed
  });

    return (
    <Card className={cn(
      "mb-6", // Increased spacing between cards from mb-4 to mb-6
      response.isError && "border-destructive/50",
      response.isFallback && "border-yellow-500/50",
      isDocumentEnhanced && "border-purple-500 border-2 bg-gradient-to-br from-purple-950/10 to-purple-900/5 shadow-lg shadow-purple-500/20",
      isOriginal && "border-blue-500/40 border-2"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <AgentIcon className={cn("h-5 w-5", agentColor)} />
            <span className="font-semibold text-sm">
              {isDocumentEnhanced ? 'Document-Enhanced AI Analysis' : isOriginal ? 'Original AI Analysis' : response.agent || 'AI Analysis'}
            </span>
            {isDocumentEnhanced && response.ragTag && (
              <Badge variant="default" className="text-xs bg-purple-600 hover:bg-purple-700 shadow-md">
                <FileText className="h-3 w-3 mr-1" />
                GCS RAG
              </Badge>
            )}
            {isOriginal && (
              <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-600 bg-blue-50/50 dark:bg-blue-950/20">
                Standard Analysis
              </Badge>
            )}
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
            {/* Use RAGHighlightedText for document-enhanced responses */}
            {(() => {
              console.log('[AIResponse] rendering decision:', {
                isDocumentEnhanced,
                ragUsed: response.ragUsed,
                ragSourcesCount: response.ragSources?.length,
                analysisType: response.analysisType,
                shouldUseRAGComponent: isDocumentEnhanced && response.ragUsed
              });
              
              if (isDocumentEnhanced && response.ragUsed) {
                console.log('[OK] Using RAGHighlightedText component');
                return (
                  <div className="text-sm leading-relaxed">
                    <RAGHighlightedText 
                      text={response.text} 
                      ragSources={response.ragSources || []} 
                    />
                  </div>
                );
              } else {
                console.log('[OK] Using standard text rendering');
                /* Standard text rendering for original responses */
                return response.text.split('\n').map((line, idx) => {
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
                });
              }
            })()}
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
        
        {/* RAG Sources Display - Only for document-enhanced analysis */}
        {isDocumentEnhanced && response.ragSources && response.ragSources.length > 0 && (
          <div className="mt-4 p-3 bg-purple-950/20 border border-purple-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-purple-400" />
              <span className="text-xs font-medium text-purple-300">Supported by Documents from GCS</span>
            </div>
            <div className="space-y-1">
              {response.ragSources.map((source, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-purple-200 font-mono">{source.filename}</span>
                  <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-300">
                    {source.similarity}% match
                </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
        
      </CardContent>
      
    </Card>
  );
}

export default AIResponse; 