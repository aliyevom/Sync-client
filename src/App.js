import React from 'react';
import { BrowserRouter as Router, Route, Routes, useParams } from 'react-router-dom';
import TranscriptionRoom from './components/TranscriptionRoom';

// Create a wrapper component to handle the parameters and persist room id across refreshes
const TranscriptionRoomWrapper = () => {
  const { socketId } = useParams();
  
  // Extract service from socketId if present
  const [, service] = socketId ? socketId.split('_') : ['', ''];

  // Persist the requested room id in sessionStorage so a refresh doesn't generate a new id
  if (socketId) {
    try { sessionStorage.setItem('desired_room_id', socketId); } catch (_) {}
  }

  return <TranscriptionRoom initialService={service} desiredRoomId={socketId} />;
};

function App() {
  React.useEffect(() => {
    document.title = 'SyncScribe';
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/:socketId?" element={<TranscriptionRoomWrapper />} />
      </Routes>
    </Router>
  );
}

export default App;
