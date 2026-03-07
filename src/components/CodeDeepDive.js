import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { Highlight, themes } from 'prism-react-renderer';
import { Copy, Check, Terminal, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { renderContent } from './markdownRender';

// ── Syntax-highlighted code block ─────────────────────────────────────────
function CodeBlock({ code, language }) {
  const [codeCopied, setCodeCopied] = useState(false);
  const lang = (language || 'text')
    .toLowerCase()
    .replace(/^(js|jsx)$/, 'javascript')
    .replace(/^(ts|tsx)$/, 'typescript')
    .replace(/^(hcl|bicep|tf)$/, 'hcl')
    .replace(/^(sh|zsh|shell)$/, 'bash')
    .replace(/^(yml)$/, 'yaml');

  return (
    <div
      className="rounded-lg border border-emerald-500/20 bg-[#0d1117] text-[12.5px] font-mono my-3"
      style={{ minWidth: 0, width: '100%', boxSizing: 'border-box' }}
    >
      <div className="flex items-center justify-between px-4 py-1.5 bg-emerald-950/40 border-b border-emerald-500/20">
        <div className="flex items-center gap-2">
          <Terminal className="h-3 w-3 text-emerald-400" />
          <span className="text-[11px] text-emerald-400 uppercase tracking-widest font-semibold">{lang}</span>
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={async () => {
            try { await navigator.clipboard.writeText(code); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); } catch (_) {}
          }}
          className={cn('h-6 px-2 text-[11px] text-white/50 hover:text-white/90', codeCopied && 'text-emerald-400')}
        >
          {codeCopied ? <><Check className="h-3 w-3 mr-1" />Copied</> : <><Copy className="h-3 w-3 mr-1" />Copy</>}
        </Button>
      </div>
      <Highlight theme={themes.oneDark} code={code.trim()} language={lang}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={cn(className, 'p-4 leading-relaxed text-[12.5px]')}
            style={{ ...style, background: 'transparent', margin: 0, overflowX: 'auto' }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                <span className="inline-block w-7 text-right mr-4 text-white/20 select-none text-[10px]">{i + 1}</span>
                {line.map((token, key) => <span key={key} {...getTokenProps({ token })} />)}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
function CodeDeepDive({ response }) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <Card className={cn(
      'mb-4 border-emerald-500/40 border-2',
      'bg-gradient-to-br from-emerald-950/20 to-slate-950/10',
      response.isError && 'border-destructive/50'
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="font-semibold text-sm text-emerald-300">Code Deep Dive</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] text-emerald-500/70 tabular-nums">
              {new Date(response.timestamp).toLocaleTimeString()}
            </span>
            <Button variant="ghost" size="sm"
              onClick={async () => {
                try { await navigator.clipboard.writeText(response.text || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (_) {}
              }}
              className={cn('h-7 px-2 text-[11px] text-white/50 hover:text-white', copied && 'text-emerald-400')}>
              {copied ? <><Check className="h-3 w-3 mr-1" />Copied</> : <><Copy className="h-3 w-3 mr-1" />Copy</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(v => !v)}
              className="h-7 px-2 text-white/40 hover:text-white">
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="pt-0">
          {response.isError ? (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {response.text}
            </div>
          ) : (
            <div className="space-y-1">
              {renderContent(response.text, 'emerald', CodeBlock)}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default CodeDeepDive;
