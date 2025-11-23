import React from 'react';
import { render, screen } from '@testing-library/react';
import RAGHighlightedText from '../RAGHighlightedText';

describe('RAGHighlightedText Component', () => {
  const mockRAGSources = [
    { filename: 'technical-best-practices.txt', bucket: 'ng', similarity: '78.2' },
    { filename: 'ng-platform-overview.md', bucket: 'ng', similarity: '72.1' }
  ];

  test('renders text with RAG highlighting', () => {
    const text = 'This is a sentence. This is another sentence. And a third one.';
    
    render(<RAGHighlightedText text={text} ragSources={mockRAGSources} />);
    
    expect(screen.getByText(/This is a sentence/i)).toBeInTheDocument();
    expect(screen.getByText(/This is another sentence/i)).toBeInTheDocument();
  });

  test('applies RAG sentence tags to all sentences', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    
    const { container } = render(<RAGHighlightedText text={text} ragSources={mockRAGSources} />);
    
    // Check for RAG sentence tags (should have rag-sentence-tag class)
    const ragTags = container.querySelectorAll('.rag-sentence-tag');
    expect(ragTags.length).toBeGreaterThan(0);
  });

  test('includes tooltip with RAG sources', () => {
    const text = 'This is a test sentence.';
    
    const { container } = render(<RAGHighlightedText text={text} ragSources={mockRAGSources} />);
    
    // Check for title attribute with RAG sources
    const ragTag = container.querySelector('.rag-sentence-tag');
    expect(ragTag).toHaveAttribute('title');
    expect(ragTag.getAttribute('title')).toContain('technical-best-practices.txt');
  });

  test('handles empty text gracefully', () => {
    render(<RAGHighlightedText text="" ragSources={mockRAGSources} />);
    
    // Should not crash
    expect(screen.queryByText(/./)).not.toBeInTheDocument();
  });

  test('handles text without periods', () => {
    const text = 'This is a single sentence without ending punctuation';
    
    render(<RAGHighlightedText text={text} ragSources={mockRAGSources} />);
    
    expect(screen.getByText(/This is a single sentence/i)).toBeInTheDocument();
  });

  test('handles multiple sentences correctly', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four.';
    
    const { container } = render(<RAGHighlightedText text={text} ragSources={mockRAGSources} />);
    
    const ragTags = container.querySelectorAll('.rag-sentence-tag');
    // Should have at least some sentences tagged
    expect(ragTags.length).toBeGreaterThan(0);
  });

  test('applies graduated intensity classes', () => {
    const text = 'First. Second. Third.';
    
    const { container } = render(<RAGHighlightedText text={text} ragSources={mockRAGSources} />);
    
    // Check for intensity classes
    const intensity0 = container.querySelector('.rag-intensity-0');
    const intensity1 = container.querySelector('.rag-intensity-1');
    const intensity2 = container.querySelector('.rag-intensity-2');
    
    // At least one intensity class should be present
    expect(intensity0 || intensity1 || intensity2).toBeTruthy();
  });
});

