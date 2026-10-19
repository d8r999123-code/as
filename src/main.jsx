import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// 以 localStorage 模擬 window.storage（原為 Claude artifact 環境提供的 API），讓資料可在本機保存
if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      return value === null ? null : { key, value };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return { key, value };
    },
    async delete(key) {
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    async list(prefix = '') {
      return { keys: Object.keys(localStorage).filter((k) => k.startsWith(prefix)) };
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
