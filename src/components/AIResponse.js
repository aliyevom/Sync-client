import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Bot, Copy, Check, Clock, AlertCircle, Users, Brain, ListChecks, FileText, Code2 } from 'lucide-react';
import { cn } from '../lib/utils';
import RAGHighlightedText from './RAGHighlightedText';
import { Highlight, themes } from 'prism-react-renderer';

// Agent icon mapping
const AGENT_ICONS = {
  'Meeting Analyst': Bot,
  'Onboarding Assistant': Users,
  'Technical Architect': Brain,
  'Action Tracker': ListChecks,
  'Speaker Coach': Code2,
  'System': AlertCircle
};

const AGENT_COLORS = {
  'Meeting Analyst': 'text-blue-600',
  'Onboarding Assistant': 'text-green-600',
  'Technical Architect': 'text-purple-600',
  'Action Tracker': 'text-orange-600',
  'Speaker Coach': 'text-cyan-500',
  'System': 'text-gray-600'
};

// Inline code block component with syntax highlighting
function CodeBlock({ code, language }) {
  const [codeCopied, setCodeCopied] = useState(false);

  const handleCodeCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch (_) {}
  };

  const normalizedLang = (language || 'text').toLowerCase().replace(/^(js|jsx)$/, 'javascript').replace(/^(ts|tsx)$/, 'typescript');

  return (
    <div className="relative rounded-lg overflow-hidden my-3 border border-white/10 bg-[#0d1117] text-[13px] font-mono w-full min-w-0">
      <div className="flex items-center justify-between px-4 py-1.5 bg-white/5 border-b border-white/10">
        <span className="text-[11px] text-white/40 uppercase tracking-widest">{normalizedLang}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCodeCopy}
          className={cn("h-6 px-2 text-[11px] text-white/50 hover:text-white/90", codeCopied && "text-green-400")}
        >
          {codeCopied ? <><Check className="h-3 w-3 mr-1" />Copied</> : <><Copy className="h-3 w-3 mr-1" />Copy</>}
        </Button>
      </div>
      <Highlight theme={themes.oneDark} code={code.trim()} language={normalizedLang}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre className={cn(className, "overflow-x-auto p-4 leading-relaxed")} style={{ ...style, background: 'transparent', margin: 0 }}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                <span className="inline-block w-8 text-right mr-4 text-white/20 select-none text-[11px]">{i + 1}</span>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

// Split a mixed text+code response into code/prose segments
function splitSegments(text) {
  // Split on fenced code blocks: ```lang\n...\n```
  const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/g;
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = FENCE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'prose', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', language: match[1].trim() || 'text', content: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'prose', content: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'prose', content: text });
  }

  return segments;
}

// Render a document-enhanced (RAG) response: code blocks get the syntax-
// highlighted CodeBlock, prose keeps the [DOC] RAG highlighting.
function renderDocEnhancedText(text, ragSources) {
  if (!text) return null;
  return splitSegments(text).map((seg, idx) => {
    if (seg.type === 'code') {
      return <CodeBlock key={idx} code={seg.content} language={seg.language} />;
    }
    if (!seg.content.trim()) return null;
    return <RAGHighlightedText key={idx} text={seg.content} ragSources={ragSources || []} />;
  });
}

// Parse a mixed text+code response into renderable segments
function renderResponseText(text) {
  if (!text) return null;

  const segments = splitSegments(text);

  return segments.map((seg, idx) => {
    if (seg.type === 'code') {
      return <CodeBlock key={idx} code={seg.content} language={seg.language} />;
    }
    // Render prose: split into paragraphs and bullet lines
    return (
      <div key={idx} className="space-y-2">
        {seg.content.split('\n').map((line, li) => {
          const trimmed = line.trim();
          if (!trimmed) return null;
          if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.match(/^\d+\.\s/)) {
            return (
              <div key={li} className="flex items-start gap-2 ml-2">
                <span className="text-muted-foreground mt-0.5 select-none">•</span>
                <span className="text-sm leading-relaxed">{trimmed.replace(/^[-•]\s+|^\d+\.\s+/, '')}</span>
              </div>
            );
          }
          if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
            return <p key={li} className="text-sm font-semibold mt-3 mb-1">{trimmed.replace(/\*\*/g, '')}</p>;
          }
          return <p key={li} className="text-sm leading-relaxed">{trimmed}</p>;
        })}
      </div>
    );
  });
}

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
  
  const isDocumentEnhanced = response.analysisType === 'document-enhanced';
  const isOriginal = response.analysisType === 'original';

    return (
    <Card className={cn(
      "mb-6 min-w-0 overflow-hidden",
      response.isError && "border-destructive/50",
      response.isFallback && "border-yellow-500/50",
      isDocumentEnhanced && "border-purple-500 border-2 bg-gradient-to-br from-purple-950/10 to-purple-900/5 shadow-lg shadow-purple-500/20",
      isOriginal && "border-blue-500/40 border-2"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
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
            {isDocumentEnhanced && response.ragUsed ? (
              <div className="space-y-2 text-sm leading-relaxed">
                {renderDocEnhancedText(response.text, response.ragSources)}
              </div>
            ) : (
              <div className="space-y-2">
                {renderResponseText(response.text)}
              </div>
            )}
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