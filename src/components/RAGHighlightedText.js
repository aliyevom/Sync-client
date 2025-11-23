import React from 'react';
import './RAGHighlightedText.css';

/**
 * RAGHighlightedText Component
 * 
 * Parses [RAG_START] and [RAG_END] tags and highlights RAG-sourced content
 * with a simple blue inline tag style.
 */
const RAGHighlightedText = ({ text, ragSources = [] }) => {
  if (!text) return null;

  // Parse text and extract RAG-tagged sections
  const parseRAGText = (input) => {
    const parts = [];
    const ragTagRegex = /\[RAG_START\](.*?)\[RAG_END\]/g;
    let lastIndex = 0;
    let match;

    while ((match = ragTagRegex.exec(input)) !== null) {
      // Add text before RAG tag
      if (match.index > lastIndex) {
        parts.push({
          type: 'normal',
          text: input.substring(lastIndex, match.index)
        });
      }

      // Add RAG-tagged content
      parts.push({
        type: 'rag',
        text: match[1].trim()
      });

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last RAG tag
    if (lastIndex < input.length) {
      parts.push({
        type: 'normal',
        text: input.substring(lastIndex)
      });
    }

    // If no RAG tags found, return entire text as normal
    if (parts.length === 0) {
      parts.push({
        type: 'normal',
        text: input
      });
    }

    return parts;
  };

  const parts = parseRAGText(text);
  const sourceInfo = ragSources.length > 0 
    ? ragSources.map(s => `${s.filename} (${s.similarity}%)`).join(', ')
    : 'GCS documents';

  return (
    <p className="rag-highlighted-content">
      {parts.map((part, index) => {
        if (part.type === 'rag') {
          return (
            <span key={index} className="rag-inline-tag" title={`[DOC] ${sourceInfo}`}>
              [DOC] {part.text}
            </span>
          );
        }
        return <span key={index}>{part.text}</span>;
      })}
    </p>
  );
};

export default RAGHighlightedText;
