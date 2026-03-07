/**
 * Shared markdown renderer for CodeDeepDive and SystemDesignViewer.
 * Handles: fenced code, pipe tables, headings, bullets, numbered lists,
 * inline bold/italic/code, and plain paragraphs — no external dependencies.
 */
import React from 'react';

// ── Inline markdown parser ────────────────────────────────────────────────
// Converts **bold**, *italic*, `code`, and plain text into React nodes.
export function renderInline(text) {
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code — `code` (check before bold/italic)
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`([\s\S]*)$/);
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*([\s\S]*)$/);
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*([\s\S]*)$/);

    // Pick the earliest match
    const candidates = [
      codeMatch && { type: 'code',   before: codeMatch[1],   content: codeMatch[2],   after: codeMatch[3],   idx: codeMatch[1].length },
      boldMatch && { type: 'bold',   before: boldMatch[1],   content: boldMatch[2],   after: boldMatch[3],   idx: boldMatch[1].length },
      italicMatch && { type: 'italic', before: italicMatch[1], content: italicMatch[2], after: italicMatch[3], idx: italicMatch[1].length },
    ].filter(Boolean);

    if (candidates.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const best = candidates.reduce((a, b) => a.idx <= b.idx ? a : b);

    if (best.before) parts.push(<span key={key++}>{best.before}</span>);

    if (best.type === 'code') {
      parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-white/10 text-[11px] font-mono text-white/80">{best.content}</code>);
    } else if (best.type === 'bold') {
      parts.push(<strong key={key++} className="font-semibold text-white/95">{best.content}</strong>);
    } else {
      parts.push(<em key={key++} className="italic text-white/75">{best.content}</em>);
    }

    remaining = best.after;
  }

  return parts;
}

// ── Pipe table parser ─────────────────────────────────────────────────────
// Returns { tableEl, consumed } where consumed = number of lines used.
function parsePipeTable(lines, startIdx, accentClass) {
  const tableLines = [];
  let i = startIdx;
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    tableLines.push(lines[i].trim());
    i++;
  }
  if (tableLines.length < 2) return null;

  const parseRow = (row) =>
    row.split('|').slice(1, -1).map(c => c.trim());

  const headers = parseRow(tableLines[0]);
  // separator row — skip
  const dataRows = tableLines.slice(2).map(parseRow).filter(r => r.length > 0);

  const headerColor = accentClass === 'emerald' ? 'text-emerald-300' : 'text-violet-300';
  const borderColor = accentClass === 'emerald' ? 'border-emerald-500/20' : 'border-violet-500/20';
  const headerBg   = accentClass === 'emerald' ? 'bg-emerald-950/40' : 'bg-violet-950/40';

  const tableEl = (
    <div key={startIdx} className="overflow-x-auto my-3 rounded-lg border border-white/10">
      <table className="w-full text-[11.5px] border-collapse">
        <thead>
          <tr className={headerBg}>
            {headers.map((h, hi) => (
              <th key={hi} className={`px-3 py-1.5 text-left font-semibold ${headerColor} border-b ${borderColor} whitespace-nowrap`}>
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent'}>
              {headers.map((_, ci) => (
                <td key={ci} className={`px-3 py-1 text-slate-300 border-b ${borderColor} last:border-b-0 align-top`}>
                  {renderInline(row[ci] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return { tableEl, consumed: tableLines.length };
}

// ── Full prose renderer ───────────────────────────────────────────────────
// accent: 'emerald' | 'violet'
export function renderProse(text, accent = 'emerald') {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  const h1Color     = accent === 'emerald' ? 'text-emerald-200' : 'text-violet-200';
  const h2Color     = accent === 'emerald' ? 'text-emerald-300' : 'text-violet-300';
  const h3Color     = accent === 'emerald' ? 'text-emerald-400' : 'text-violet-400';
  const bulletDot   = accent === 'emerald' ? 'text-emerald-500' : 'text-violet-500';
  const sectionBorder = accent === 'emerald' ? 'border-emerald-500/20' : 'border-violet-500/20';

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (!t) { i++; continue; }

    // ── Pipe table ──────────────────────────────────────────────────────
    if (t.startsWith('|')) {
      const result = parsePipeTable(lines, i, accent);
      if (result) {
        elements.push(result.tableEl);
        i += result.consumed;
        continue;
      }
    }

    // ── Headings ────────────────────────────────────────────────────────
    if (/^#{1,3}\s/.test(t)) {
      const level = t.match(/^(#+)/)[1].length;
      const content = t.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      if (level === 1) {
        elements.push(
          <p key={i} className={`text-sm font-bold ${h1Color} mt-4 mb-2 pb-1 border-b ${sectionBorder}`}>
            {renderInline(content)}
          </p>
        );
      } else if (level === 2) {
        elements.push(
          <p key={i} className={`text-xs font-bold ${h2Color} uppercase tracking-wide mt-4 mb-1.5`}>
            {renderInline(content)}
          </p>
        );
      } else {
        elements.push(
          <p key={i} className={`text-xs font-semibold ${h3Color} mt-3 mb-1`}>
            {renderInline(content)}
          </p>
        );
      }
      i++; continue;
    }

    // ── Numbered section heading: "1. **Title**" or "1. Title" ──────────
    if (/^\d+\.\s+/.test(t)) {
      const numMatch = t.match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        const isSectionHeader = /^\*\*/.test(numMatch[2]);
        if (isSectionHeader) {
          const label = numMatch[2].replace(/\*\*/g, '');
          elements.push(
            <p key={i} className={`text-xs font-bold ${h2Color} uppercase tracking-wide mt-4 mb-1.5`}>
              {numMatch[1]}. {renderInline(label)}
            </p>
          );
          i++; continue;
        }
        // Regular numbered list item
        elements.push(
          <div key={i} className="flex items-start gap-2 ml-2 my-0.5">
            <span className={`${bulletDot} shrink-0 text-xs mt-0.5 font-bold`}>{numMatch[1]}.</span>
            <span className="text-sm leading-relaxed text-slate-200">{renderInline(numMatch[2])}</span>
          </div>
        );
        i++; continue;
      }
    }

    // ── Standalone **bold** only line ─────────────────────────────────
    if (/^\*\*.*\*\*:?$/.test(t)) {
      elements.push(
        <p key={i} className={`text-xs font-bold ${h2Color} uppercase tracking-wide mt-3 mb-1`}>
          {renderInline(t.replace(/\*\*/g, '').replace(/:$/, ''))}
        </p>
      );
      i++; continue;
    }

    // ── Bullet ──────────────────────────────────────────────────────────
    if (t.startsWith('- ') || t.startsWith('• ') || t.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex items-start gap-2 ml-2 my-0.5">
          <span className={`${bulletDot} shrink-0 text-xs mt-1 select-none`}>▸</span>
          <span className="text-sm leading-relaxed text-slate-200">{renderInline(t.replace(/^[-•*]\s+/, ''))}</span>
        </div>
      );
      i++; continue;
    }

    // ── Plain paragraph ─────────────────────────────────────────────────
    elements.push(
      <p key={i} className="text-sm leading-relaxed text-slate-200 my-0.5">
        {renderInline(t)}
      </p>
    );
    i++;
  }

  return elements;
}

// ── Top-level content renderer (handles fenced code blocks first) ─────────
// accent: 'emerald' | 'violet'
export function renderContent(text, accent = 'emerald', CodeBlockComponent) {
  if (!text) return null;
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
  if (!segments.length) segments.push({ type: 'prose', content: text });

  return segments.map((seg, idx) => {
    if (seg.type === 'code') {
      return <CodeBlockComponent key={idx} code={seg.content} language={seg.language} />;
    }
    return (
      <div key={idx} className="space-y-0.5">
        {renderProse(seg.content, accent)}
      </div>
    );
  });
}
