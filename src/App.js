import React from 'react';
import { BrowserRouter as Router, Route, Routes, useParams } from 'react-router-dom';
import TranscriptionRoom from './components/TranscriptionRoom';
import './App.css';
import './styles/TranscriptionLayout.css';

// Create a wrapper component to handle the parameters
const TranscriptionRoomWrapper = () => {
  const { socketId } = useParams();
  
  // Extract service from socketId if present
  const [id, service] = socketId ? socketId.split('_') : ['', ''];
  
  return <TranscriptionRoom initialService={service} />;
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
