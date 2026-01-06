import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// --- NEW: Import and configure Amplify ---
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "ap-south-1_gu3mOkIN9", // Paste your User Pool ID here
      userPoolClientId: "59kq0ngqhefion688kenfk31mm", // Paste your App Client ID here
    }
  }
});
// -----------------------------------------

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();