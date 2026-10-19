import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { firestoreStorage } from './firebase.js';

// App.jsx 原本使用 Claude artifact 提供的 window.storage，這裡改接 Firestore，讓所有使用者共用資料
window.storage = firestoreStorage;

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
