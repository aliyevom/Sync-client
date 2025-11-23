import React from 'react';
import { render, screen } from '@testing-library/react';
import AIResponse from '../AIResponse';

describe('AIResponse Component - RAG Integration', () => {
  const mockOriginalResponse = {
    text: 'This is a standard AI analysis without document context.',
    timestamp: '2025-11-22T07:47:32.889Z',
    analysisType: 'original',
    agent: 'Meeting Analyst',
    ragUsed: false,
    ragSources: [],
    ragTag: null,
    isFormatted: false,
    isError: false,
    isFallback: false
  };

  const mockRAGResponse = {
    text: 'This analysis uses document context from GCS buckets. [RAG_START]This specific practice is outlined in our documentation.[RAG_END]',
    timestamp: '2025-11-22T07:47:39.571Z',
    analysisType: 'document-enhanced',
    agent: 'Meeting Analyst',
    ragUsed: true,
    ragSources: [
      { filename: 'technical-best-practices.txt', bucket: 'ng', similarity: '78.2' },
      { filename: 'ng-platform-overview.md', bucket: 'ng', similarity: '72.1' }
    ],
    ragTag: '+RAG',
    isFormatted: false,
    isError: false,
    isFallback: false
  };

  test('renders original analysis correctly', () => {
    render(<AIResponse response={mockOriginalResponse} />);
    
    expect(screen.getByText(/Original AI Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/This is a standard AI analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/Standard Analysis/i)).toBeInTheDocument();
  });

  test('renders document-enhanced analysis correctly', () => {
    render(<AIResponse response={mockRAGResponse} />);
    
    expect(screen.getByText(/Document-Enhanced AI Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/GCS RAG/i)).toBeInTheDocument();
    expect(screen.getByText(/This analysis uses document context/i)).toBeInTheDocument();
  });

  test('displays RAG sources when available', () => {
    render(<AIResponse response={mockRAGResponse} />);
    
    expect(screen.getByText(/Supported by Documents from GCS/i)).toBeInTheDocument();
    expect(screen.getByText(/technical-best-practices.txt/i)).toBeInTheDocument();
    expect(screen.getByText(/ng-platform-overview.md/i)).toBeInTheDocument();
    expect(screen.getByText(/78.2% match/i)).toBeInTheDocument();
    expect(screen.getByText(/72.1% match/i)).toBeInTheDocument();
  });

  test('shows document-enhanced banner for RAG responses', () => {
    render(<AIResponse response={mockRAGResponse} />);
    
    expect(screen.getByText(/This analysis uses document context from your GCS buckets/i)).toBeInTheDocument();
  });

  test('does not show RAG sources for original responses', () => {
    render(<AIResponse response={mockOriginalResponse} />);
    
    expect(screen.queryByText(/Supported by Documents from GCS/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/technical-best-practices.txt/i)).not.toBeInTheDocument();
  });

  test('renders timestamp correctly', () => {
    render(<AIResponse response={mockOriginalResponse} />);
    
    // Check if timestamp is rendered (format may vary)
    const timestampElement = screen.getByText(/AM|PM/i);
    expect(timestampElement).toBeInTheDocument();
  });

  test('handles error responses', () => {
    const errorResponse = {
      ...mockOriginalResponse,
      isError: true,
      analysisType: 'error'
    };
    
    render(<AIResponse response={errorResponse} />);
    
    expect(screen.getByText(/Analysis service temporarily unavailable/i)).toBeInTheDocument();
  });
});

