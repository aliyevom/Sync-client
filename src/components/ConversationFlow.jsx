/**
 * Conversation Flow Infographic
 * Simple, clean view showing conversation as numbered sequence
 * Each turn gets AI-generated one-sentence summary
 */

import React, { useState, useEffect } from 'react';
import './ConversationFlow.css';

const ConversationFlow = ({ roomId, socket, className = '' }) => {
  const [conversationFlow, setConversationFlow] = useState([]);
  const [semanticLinks, setSemanticLinks] = useState([]); // Links between related turns
  const flowContainerRef = React.useRef(null);

  useEffect(() => {
    if (!socket || !roomId) return;

    // Initialize tracker
    socket.emit('init_conversation_tracker', {
      roomId,
      metadata: { meetingType: 'live' }
    });

    // Listen for turn processed
    socket.on('conversation_turn_processed', (data) => {
      console.log('[ConversationFlow] Turn processed:', data);
      
      if (data.turn) {
        // Use AI-generated summary
        const summary = data.turn.aiSummary || data.turn.text.substring(0, 120) + '...';
        
        setConversationFlow(prev => {
          const newFlow = [...prev, {
            step: prev.length + 1,
            speaker: data.turn.speaker,
            summary,  // ✅ Clean AI-generated summary
            fullText: data.turn.text,
            type: data.turn.flowType,
            timestamp: data.turn.timestamp,
            coherence: data.turn.coherenceScore,
            importance: data.turn.attentionScore,
            topics: data.turn.aiTopics || [], // ✅ AI topic tags (what this covers)
            purpose: data.turn.aiPurpose || data.turn.flowType, // ✅ Purpose (asking, answering, etc)
            completion: data.turn.aiCompletion || 'continues', // ✅ Completion (opens, continues, completes)
            contextLinks: data.turn.contextLinks || [] // ✅ Links to related previous turns
          }];
          
          // Build semantic links (if turn 1 relates to turn 4, link them)
          const links = [];
          newFlow.forEach((turn, i) => {
            if (turn.contextLinks && turn.contextLinks.length > 0) {
              turn.contextLinks.forEach(link => {
                if (link.turnIndex < i) { // Only link to previous turns
                  links.push({
                    from: link.turnIndex + 1,
                    to: i + 1,
                    similarity: link.similarity,
                    reason: link.sharedEntities.slice(0, 2).join(', ')
                  });
                }
              });
            }
          });
          
          setSemanticLinks(links);
          
          // Keep only last 10 turns for clean view
          return newFlow.slice(-10);
        });
        
        // ✅ AUTO-SCROLL to new turn
        setTimeout(() => {
          if (flowContainerRef.current) {
            flowContainerRef.current.scrollTop = flowContainerRef.current.scrollHeight;
          }
        }, 100);
      }
    });

    return () => {
      socket.off('conversation_turn_processed');
    };
  }, [socket, roomId]);



  return (
    <div className={`conversation-flow-infographic ${className}`}>
      {/* Conversation Flow Timeline - Clean, no header metrics */}
      <div className="flow-timeline-container" ref={flowContainerRef}>
        {conversationFlow.length === 0 ? (
          <div className="flow-empty">
            <span className="empty-icon">💬</span>
            <p>Conversation flow will appear here...</p>
            <p className="empty-hint">Speak to start tracking</p>
          </div>
        ) : (
          <div className="flow-steps">
            {conversationFlow.map((turn, index) => {
              // Check if this turn has semantic links to previous turns
              const incomingLinks = semanticLinks.filter(link => link.to === turn.step);
              
              return (
              <div key={turn.step} className="flow-step-container">
                {/* Semantic Links (if turn relates to non-adjacent previous turn) */}
                {incomingLinks.map((link, i) => (
                  <div key={i} className="semantic-link-indicator">
                    <span className="link-text">
                      ↗ References #{link.from}: {link.reason}
                    </span>
                  </div>
                ))}
                
                {/* Connection Line */}
                {index > 0 && (
                  <div className="flow-connector">
                    <div className={`connector-line connector-${turn.type}`}></div>
                    <div className="connector-arrow">▼</div>
                  </div>
                )}

                {/* Turn Card */}
<div className={`flow-card flow-card-${turn.type}`} id={`turn-${turn.step}`}>
                  {/* Step Number Badge - Clean, no emojis */}
                  <div className="step-badge">
                    <span className="step-number">{turn.step}</span>
                  </div>

                  {/* Speaker */}
                  <div className="flow-speaker">
                    <span className="speaker-icon">👤</span>
                    <span className="speaker-name">{turn.speaker}</span>
                  </div>

                  {/* One-Sentence Summary */}
                  <div className="flow-summary">
                    {turn.summary}
                  </div>

                  {/* Topic Tags (AI-generated) - Clean, no badges */}
                  {turn.topics && turn.topics.length > 0 && (
                    <div className="flow-topics">
                      {turn.topics.map((topic, i) => (
                        <span key={i} className="topic-tag">
                          {topic}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  );
};

// Helper functions
const getCoherenceColor = (score) => {
  if (score > 0.7) return '#50C878';
  if (score > 0.5) return '#F5A623';
  return '#E74C3C';
};

const getQualityColor = (score) => {
  if (score > 0.7) return '#50C878';
  if (score > 0.5) return '#F5A623';
  return '#E74C3C';
};

export default ConversationFlow;

