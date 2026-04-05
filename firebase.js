/**
 * Firebase Configuration & Initialization
 * 
 * Cấu hình Firebase cho ứng dụng lớp học realtime
 * Bao gồm: Authentication, Firestore, Realtime Database
 * 
 * Lưu ý: Thay thế các giá trị config bằng Firebase project của bạn
 */

import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

// Firebase Configuration - THAY ĐỔI THEO PROJECT CỦA BẠN
const firebaseConfig = {
  apiKey: "AIzaSyDemoKeyForClassroomApp123456789",
  authDomain: "classroom-realtime-app.firebaseapp.com",
  projectId: "classroom-realtime-app",
  storageBucket: "classroom-realtime-app.appspot.com",
  messagingSenderId: "123456789012",
  databaseURL: "https://classroom-realtime-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  appId: "1:123456789012:web:abcdef1234567890abcd"
};

// Khởi tạo Firebase App
const app = initializeApp(firebaseConfig);

// Khởi tạo Firebase Authentication
export const auth = getAuth(app);

// Khởi tạo Firestore Database
export const firestore = getFirestore(app);

// Khởi tạo Realtime Database
export const realtimeDB = getDatabase(app);

/**
 * Cấu trúc dữ liệu Firestore:
 * 
 * /users/{uid}
 *   - email: string
 *   - displayName: string
 *   - photoURL: string
 *   - createdAt: timestamp
 *   - lastSeen: timestamp
 * 
 * /messages/{chatId}/{messageId}
 *   - senderId: string
 *   - senderName: string
 *   - text: string
 *   - timestamp: timestamp
 *   - seenBy: [uid1, uid2, ...]
 * 
 * /chats/{chatId}
 *   - name: string
 *   - participants: [uid1, uid2, ...]
 *   - createdAt: timestamp
 *   - lastMessage: string
 *   - lastMessageTime: timestamp
 */

/**
 * Cấu trúc dữ liệu Realtime Database:
 * 
 * /typing/{chatId}/{uid}: boolean
 *   - true: user đang nhập
 *   - false: user ngừng nhập
 * 
 * /status/{uid}
 *   - online: boolean
 *   - lastSeen: timestamp
 *   - ping: number (milliseconds)
 * 
 * /viewing/{targetUid}/{viewerUid}: boolean
 *   - true: viewer đang xem profile của targetUid
 *   - false: viewer thoát khỏi profile
 */

export default app;
