import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

// Firebase 網頁設定（apiKey 是公開識別碼，不是密鑰）
const app = initializeApp({
  apiKey: 'AIzaSyBXGKPVzGM5FTXUFuXaDjyaG_gZEH40uCs',
  authDomain: 'asdf-9ffd8.firebaseapp.com',
  projectId: 'asdf-9ffd8',
  storageBucket: 'asdf-9ffd8.firebasestorage.app',
  messagingSenderId: '802543596066',
  appId: '1:802543596066:web:f7e78b1e6873c0901c907b'
});
const db = getFirestore(app);

// 以 Firestore 實作 App.jsx 使用的 window.storage 介面：每個 key 存成 kv 集合中的一份文件
export const firestoreStorage = {
  async get(key) {
    const snap = await getDoc(doc(db, 'kv', key));
    return snap.exists() ? { key, value: snap.data().value } : null;
  },
  async set(key, value) {
    await setDoc(doc(db, 'kv', key), { value, updatedAt: Date.now() });
    return { key, value };
  }
};
