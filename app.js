/**
 * Classroom Realtime App - Core Logic
 * 
 * Quản lý 4 tính năng realtime:
 * 1. Typing Indicator - Hiển thị khi user đang nhập
 * 2. Seen Status - Hiển thị ai đã xem tin nhắn
 * 3. Ping/Network Status - Kiểm tra kết nối mạng
 * 4. Viewing Profile - Hiển thị ai đang xem profile
 * 
 * Sử dụng Firebase Realtime Database & Firestore
 */

import {
  auth,
  firestore,
  realtimeDB
} from './firebase.js';

import {
  signInAnonymously,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';

import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';

import {
  ref,
  set,
  onValue,
  off,
  remove
} from 'firebase/database';

// ============================================
// STATE MANAGEMENT
// ============================================

let currentUser = null;
let currentChatId = null;
let typingTimeout = null;
let pingInterval = null;
let networkCheckInterval = null;

// Lưu trữ danh sách user đang nhập trong chat hiện tại
const typingUsers = new Map();

// Lưu trữ danh sách user đang xem profile
const viewingUsers = new Map();

// Lưu trữ trạng thái mạng
let networkStatus = {
  online: navigator.onLine,
  ping: 0,
  quality: 'good' // good, weak, offline
};

// ============================================
// 1. AUTHENTICATION
// ============================================

/**
 * Đăng nhập ẩn danh
 * Tạo user tạm thời cho ứng dụng
 */
export async function initializeAuth() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = {
          uid: user.uid,
          email: user.email || `user_${user.uid.slice(0, 8)}`,
          displayName: user.displayName || `User ${Math.random().toString(36).slice(2, 9)}`,
          photoURL: user.photoURL || null
        };

        // Tạo hoặc cập nhật user trong Firestore
        try {
          const userRef = doc(firestore, 'users', user.uid);
          await updateDoc(userRef, {
            lastSeen: serverTimestamp(),
            online: true
          }).catch(() => {
            // Nếu user chưa tồn tại, tạo mới
            addDoc(collection(firestore, 'users'), {
              uid: user.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: serverTimestamp(),
              lastSeen: serverTimestamp(),
              online: true
            });
          });
        } catch (error) {
          console.error('Error updating user:', error);
        }

        // Thiết lập trạng thái online trong Realtime DB
        const statusRef = ref(realtimeDB, `status/${user.uid}`);
        set(statusRef, {
          online: true,
          lastSeen: Date.now(),
          ping: 0
        });

        // Lắng nghe sự kiện disconnect
        const connectedRef = ref(realtimeDB, '.info/connected');
        onValue(connectedRef, (snapshot) => {
          if (snapshot.val() === true) {
            // Khi kết nối lại
            set(statusRef, {
              online: true,
              lastSeen: Date.now(),
              ping: 0
            });
          }
        });

        resolve(currentUser);
      } else {
        // Đăng nhập ẩn danh
        try {
          const result = await signInAnonymously(auth);
          currentUser = {
            uid: result.user.uid,
            email: `anonymous_${result.user.uid.slice(0, 8)}`,
            displayName: `User ${Math.random().toString(36).slice(2, 9)}`,
            photoURL: null
          };

          // Tạo user trong Firestore
          await addDoc(collection(firestore, 'users'), {
            uid: result.user.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            createdAt: serverTimestamp(),
            lastSeen: serverTimestamp(),
            online: true
          });

          // Thiết lập trạng thái online
          const statusRef = ref(realtimeDB, `status/${result.user.uid}`);
          set(statusRef, {
            online: true,
            lastSeen: Date.now(),
            ping: 0
          });

          resolve(currentUser);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

/**
 * Đăng xuất
 */
export async function logout() {
  if (currentUser) {
    // Đặt trạng thái offline
    const statusRef = ref(realtimeDB, `status/${currentUser.uid}`);
    await set(statusRef, {
      online: false,
      lastSeen: Date.now(),
      ping: 0
    });

    // Xóa trạng thái typing
    if (currentChatId) {
      const typingRef = ref(realtimeDB, `typing/${currentChatId}/${currentUser.uid}`);
      await remove(typingRef);
    }

    // Xóa trạng thái viewing
    const viewingRef = ref(realtimeDB, `viewing`);
    await remove(viewingRef);

    await signOut(auth);
    currentUser = null;
  }
}

// ============================================
// 2. TYPING INDICATOR
// ============================================

/**
 * Khởi tạo lắng nghe typing indicator
 * Lắng nghe sự thay đổi trạng thái typing của các user khác
 */
export function initializeTypingListener(chatId, onTypingChange) {
  currentChatId = chatId;
  const typingRef = ref(realtimeDB, `typing/${chatId}`);

  onValue(typingRef, (snapshot) => {
    typingUsers.clear();

    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const [uid, isTyping] of Object.entries(data)) {
        if (uid !== currentUser.uid && isTyping) {
          typingUsers.set(uid, true);
        }
      }
    }

    // Gọi callback để cập nhật UI
    onTypingChange(Array.from(typingUsers.keys()));
  });

  return () => off(typingRef);
}

/**
 * Gửi trạng thái typing
 * Khi user bắt đầu nhập, đặt trạng thái typing = true
 * Sau 2 giây không gõ, đặt = false (debounce)
 */
export function setTypingStatus(chatId, isTyping) {
  if (!currentUser) return;

  const typingRef = ref(realtimeDB, `typing/${chatId}/${currentUser.uid}`);

  if (isTyping) {
    // Ghi trạng thái typing = true
    set(typingRef, true);

    // Xóa timeout cũ nếu có
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    // Đặt timeout 2 giây: nếu không gõ, set typing = false
    typingTimeout = setTimeout(() => {
      set(typingRef, false);
    }, 2000);
  } else {
    // Xóa timeout nếu có
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    // Đặt typing = false ngay lập tức
    set(typingRef, false);
  }
}

/**
 * Lấy tên user từ Firestore
 */
async function getUserName(uid) {
  try {
    const q = query(collection(firestore, 'users'), where('uid', '==', uid));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      return snapshot.docs[0].data().displayName || 'Unknown';
    }
  } catch (error) {
    console.error('Error fetching user name:', error);
  }
  return 'Unknown';
}

/**
 * Lấy danh sách user đang nhập (với tên)
 */
export async function getTypingUserNames(uids) {
  const names = [];
  for (const uid of uids) {
    const name = await getUserName(uid);
    names.push(name);
  }
  return names;
}

// ============================================
// 3. SEEN STATUS
// ============================================

/**
 * Gửi tin nhắn mới
 */
export async function sendMessage(chatId, text) {
  if (!currentUser || !text.trim()) return null;

  try {
    const messageRef = await addDoc(collection(firestore, 'messages'), {
      chatId: chatId,
      senderId: currentUser.uid,
      senderName: currentUser.displayName,
      senderPhotoURL: currentUser.photoURL,
      text: text.trim(),
      timestamp: serverTimestamp(),
      seenBy: [currentUser.uid] // Người gửi đã xem tin nhắn của mình
    });

    return messageRef.id;
  } catch (error) {
    console.error('Error sending message:', error);
    return null;
  }
}

/**
 * Lắng nghe tin nhắn trong chat
 */
export function initializeMessageListener(chatId, onMessagesChange) {
  const q = query(
    collection(firestore, 'messages'),
    where('chatId', '==', chatId),
    orderBy('timestamp', 'asc')
  );

  const unsubscribe = onSnapshot(q, async (snapshot) => {
    const messages = [];
    for (const docSnapshot of snapshot.docs) {
      const data = docSnapshot.data();
      
      // Nếu tin nhắn chưa được xem bởi user hiện tại, thêm vào seenBy
      if (!data.seenBy.includes(currentUser.uid)) {
        data.seenBy.push(currentUser.uid);
        
        // Cập nhật Firestore
        try {
          await updateDoc(doc(firestore, 'messages', docSnapshot.id), {
            seenBy: data.seenBy
          });
        } catch (error) {
          console.error('Error updating seen status:', error);
        }
      }

      messages.push({
        id: docSnapshot.id,
        ...data
      });
    }

    onMessagesChange(messages);
  });

  return unsubscribe;
}

/**
 * Lấy danh sách tên user đã xem tin nhắn
 */
export async function getSeenByNames(seenByUids) {
  const names = [];
  for (const uid of seenByUids) {
    const name = await getUserName(uid);
    names.push(name);
  }
  return names;
}

// ============================================
// 4. PING & NETWORK STATUS
// ============================================

/**
 * Khởi tạo kiểm tra kết nối mạng
 */
export function initializeNetworkMonitoring(onStatusChange) {
  // Lắng nghe sự kiện online/offline
  window.addEventListener('online', () => {
    networkStatus.online = true;
    networkStatus.quality = 'good';
    onStatusChange(networkStatus);
  });

  window.addEventListener('offline', () => {
    networkStatus.online = false;
    networkStatus.quality = 'offline';
    networkStatus.ping = 0;
    onStatusChange(networkStatus);
  });

  // Kiểm tra ping mỗi 5 giây
  networkCheckInterval = setInterval(() => {
    measurePing(onStatusChange);
  }, 5000);

  // Kiểm tra lần đầu
  measurePing(onStatusChange);
}

/**
 * Đo ping bằng cách gửi request đến Firebase
 */
async function measurePing(onStatusChange) {
  if (!navigator.onLine) {
    networkStatus.online = false;
    networkStatus.quality = 'offline';
    networkStatus.ping = 0;
    onStatusChange(networkStatus);
    return;
  }

  const startTime = Date.now();

  try {
    // Gửi request đến Firestore để đo ping
    const statusRef = ref(realtimeDB, `status/${currentUser?.uid}`);
    await set(statusRef, {
      online: true,
      lastSeen: Date.now(),
      ping: 0
    });

    const endTime = Date.now();
    const ping = endTime - startTime;

    // Cập nhật trạng thái mạng dựa trên ping
    networkStatus.online = true;
    networkStatus.ping = ping;

    if (ping < 100) {
      networkStatus.quality = 'good';
    } else if (ping < 300) {
      networkStatus.quality = 'weak';
    } else {
      networkStatus.quality = 'offline';
    }

    onStatusChange(networkStatus);
  } catch (error) {
    console.error('Error measuring ping:', error);
    networkStatus.online = false;
    networkStatus.quality = 'offline';
    networkStatus.ping = 0;
    onStatusChange(networkStatus);
  }
}

/**
 * Dừng kiểm tra mạng
 */
export function stopNetworkMonitoring() {
  if (networkCheckInterval) {
    clearInterval(networkCheckInterval);
  }
}

/**
 * Lấy trạng thái mạng hiện tại
 */
export function getNetworkStatus() {
  return networkStatus;
}

// ============================================
// 5. VIEWING PROFILE
// ============================================

/**
 * Khởi tạo lắng nghe viewing profile
 */
export function initializeViewingListener(targetUid, onViewingChange) {
  const viewingRef = ref(realtimeDB, `viewing/${targetUid}`);

  onValue(viewingRef, (snapshot) => {
    viewingUsers.clear();

    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const [uid, isViewing] of Object.entries(data)) {
        if (uid !== currentUser.uid && isViewing) {
          viewingUsers.set(uid, true);
        }
      }
    }

    // Gọi callback để cập nhật UI
    onViewingChange(Array.from(viewingUsers.keys()));
  });

  return () => off(viewingRef);
}

/**
 * Đặt trạng thái viewing profile
 */
export async function setViewingStatus(targetUid, isViewing) {
  if (!currentUser) return;

  const viewingRef = ref(realtimeDB, `viewing/${targetUid}/${currentUser.uid}`);

  if (isViewing) {
    // Ghi trạng thái viewing = true
    await set(viewingRef, true);
  } else {
    // Xóa trạng thái viewing
    await remove(viewingRef);
  }
}

/**
 * Lấy danh sách user đang xem profile (với tên)
 */
export async function getViewingUserNames(uids) {
  const names = [];
  for (const uid of uids) {
    const name = await getUserName(uid);
    names.push(name);
  }
  return names;
}

// ============================================
// 6. UTILITY FUNCTIONS
// ============================================

/**
 * Lấy user hiện tại
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Lấy chat ID hiện tại
 */
export function getCurrentChatId() {
  return currentChatId;
}

/**
 * Tạo hoặc lấy chat
 */
export async function getOrCreateChat(participantUids) {
  try {
    // Sắp xếp UIDs để đảm bảo chat ID nhất quán
    const sortedUids = [currentUser.uid, ...participantUids].sort();
    const chatId = sortedUids.join('_');

    // Kiểm tra xem chat đã tồn tại chưa
    const q = query(collection(firestore, 'chats'), where('chatId', '==', chatId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      // Tạo chat mới
      const chatRef = await addDoc(collection(firestore, 'chats'), {
        chatId: chatId,
        participants: sortedUids,
        createdAt: serverTimestamp(),
        lastMessage: '',
        lastMessageTime: serverTimestamp()
      });

      return chatId;
    } else {
      return chatId;
    }
  } catch (error) {
    console.error('Error creating/getting chat:', error);
    return null;
  }
}

/**
 * Dọn dẹp resources khi thoát ứng dụng
 */
export async function cleanup() {
  await logout();
  stopNetworkMonitoring();

  if (typingTimeout) {
    clearTimeout(typingTimeout);
  }
}

export default {
  initializeAuth,
  logout,
  initializeTypingListener,
  setTypingStatus,
  getTypingUserNames,
  initializeMessageListener,
  sendMessage,
  getSeenByNames,
  initializeNetworkMonitoring,
  stopNetworkMonitoring,
  getNetworkStatus,
  initializeViewingListener,
  setViewingStatus,
  getViewingUserNames,
  getCurrentUser,
  getCurrentChatId,
  getOrCreateChat,
  cleanup
};
