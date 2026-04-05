/**
 * Classroom Realtime App - Main Application
 * 
 * Kết nối UI với logic Firebase
 * Quản lý tất cả tương tác người dùng
 */

import {
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
} from './lib/app.js';

// ============================================
// DOM ELEMENTS
// ============================================

const networkStatusEl = document.getElementById('networkStatus');
const statusDotEl = document.querySelector('.status-dot');
const statusTextEl = document.querySelector('.status-text');
const pingInfoEl = document.querySelector('.ping-info');

const chatListEl = document.getElementById('chatList');
const userInfoEl = document.getElementById('userInfo');
const userNameEl = document.querySelector('.user-name');
const userStatusEl = document.querySelector('.user-status');

const chatHeaderEl = document.getElementById('chatHeader');
const chatTitleEl = document.getElementById('chatTitle');
const viewingIndicatorEl = document.getElementById('viewingIndicator');
const viewingCountEl = document.getElementById('viewingCount');

const messagesContainerEl = document.getElementById('messagesContainer');
const typingIndicatorEl = document.getElementById('typingIndicator');
const typingUsersEl = document.getElementById('typingUsers');

const messageFormEl = document.getElementById('messageForm');
const messageInputEl = document.getElementById('messageInput');
const messageSendBtn = messageFormEl.querySelector('.btn-send');

const profilePanelEl = document.getElementById('profilePanel');
const profileInfoEl = document.getElementById('profileInfo');
const viewersInfoEl = document.getElementById('viewersInfo');
const viewersListEl = document.getElementById('viewersList');

const newChatBtnEl = document.getElementById('newChatBtn');
const logoutBtnEl = document.getElementById('logoutBtn');
const profileBtnEl = document.getElementById('profileBtn');
const closeProfileBtnEl = document.getElementById('closeProfileBtn');

const newChatModalEl = document.getElementById('newChatModal');
const chatNameInputEl = document.getElementById('chatName');
const participantsListEl = document.getElementById('participantsList');
const participantInputEl = document.getElementById('participantInput');

// ============================================
// STATE
// ============================================

let currentUser = null;
let currentChatId = null;
let currentMessages = [];
let typingUserIds = [];
let viewingUserIds = [];
let selectedChatParticipants = [];
let unsubscribeTyping = null;
let unsubscribeMessages = null;
let unsubscribeViewing = null;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Khởi tạo ứng dụng
 */
async function initializeApp() {
  try {
    // Khởi tạo Firebase Auth
    currentUser = await initializeAuth();
    console.log('User initialized:', currentUser);

    // Cập nhật UI user info
    updateUserInfo();

    // Khởi tạo kiểm tra mạng
    initializeNetworkMonitoring(updateNetworkStatus);

    // Tạo chat mặc định (nếu cần)
    await createDefaultChat();

    // Thiết lập event listeners
    setupEventListeners();

    console.log('App initialized successfully');
  } catch (error) {
    console.error('Error initializing app:', error);
    alert('Lỗi khởi tạo ứng dụng: ' + error.message);
  }
}

/**
 * Tạo chat mặc định
 */
async function createDefaultChat() {
  try {
    const chatId = await getOrCreateChat([]);
    if (chatId) {
      currentChatId = chatId;
      await loadChat(chatId);
    }
  } catch (error) {
    console.error('Error creating default chat:', error);
  }
}

/**
 * Thiết lập event listeners
 */
function setupEventListeners() {
  // Message form
  messageFormEl.addEventListener('submit', handleSendMessage);
  messageInputEl.addEventListener('input', handleTyping);

  // Buttons
  newChatBtnEl.addEventListener('click', openNewChatModal);
  logoutBtnEl.addEventListener('click', handleLogout);
  profileBtnEl.addEventListener('click', openProfilePanel);
  closeProfileBtnEl.addEventListener('click', closeProfilePanel);

  // Modal
  document.addEventListener('click', (e) => {
    if (e.target === newChatModalEl) {
      closeNewChatModal();
    }
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', async () => {
    await cleanup();
  });
}

// ============================================
// USER INFO
// ============================================

/**
 * Cập nhật thông tin user
 */
function updateUserInfo() {
  if (currentUser) {
    userNameEl.textContent = currentUser.displayName;
    userStatusEl.textContent = 'Online';
  }
}

/**
 * Cập nhật trạng thái mạng
 */
function updateNetworkStatus(status) {
  // Cập nhật status dot
  statusDotEl.className = 'status-dot ' + status.quality;

  // Cập nhật text
  if (status.online) {
    if (status.quality === 'good') {
      statusTextEl.textContent = 'Online';
    } else if (status.quality === 'weak') {
      statusTextEl.textContent = 'Mạng yếu';
    }
  } else {
    statusTextEl.textContent = 'Offline';
  }

  // Cập nhật ping
  pingInfoEl.textContent = `Ping: ${status.ping}ms`;

  // Disable/enable message input
  messageInputEl.disabled = !status.online;
  messageSendBtn.disabled = !status.online;

  if (!status.online) {
    messageInputEl.placeholder = 'Mất kết nối mạng...';
  } else {
    messageInputEl.placeholder = 'Nhập tin nhắn...';
  }
}

// ============================================
// CHAT MANAGEMENT
// ============================================

/**
 * Tải chat
 */
async function loadChat(chatId) {
  currentChatId = chatId;

  // Dừng lắng nghe chat cũ
  if (unsubscribeMessages) {
    unsubscribeMessages();
  }
  if (unsubscribeTyping) {
    unsubscribeTyping();
  }
  if (unsubscribeViewing) {
    unsubscribeViewing();
  }

  // Xóa messages
  messagesContainerEl.innerHTML = '';
  currentMessages = [];

  // Cập nhật title
  chatTitleEl.textContent = `Chat #${chatId.slice(0, 8)}`;

  // Lắng nghe messages
  unsubscribeMessages = initializeMessageListener(chatId, updateMessages);

  // Lắng nghe typing
  unsubscribeTyping = initializeTypingListener(chatId, updateTypingIndicator);

  // Lắng nghe viewing
  unsubscribeViewing = initializeViewingListener(currentUser.uid, updateViewingIndicator);

  // Bắt đầu viewing profile
  await setViewingStatus(currentUser.uid, true);

  // Cập nhật chat list
  updateChatList(chatId);
}

/**
 * Cập nhật danh sách chat
 */
function updateChatList(activeId) {
  // Xóa active class từ tất cả items
  document.querySelectorAll('.chat-item').forEach(item => {
    item.classList.remove('active');
  });

  // Thêm active class vào chat hiện tại
  const activeItem = document.querySelector(`[data-chat-id="${activeId}"]`);
  if (activeItem) {
    activeItem.classList.add('active');
  }
}

// ============================================
// MESSAGES
// ============================================

/**
 * Gửi tin nhắn
 */
async function handleSendMessage(e) {
  e.preventDefault();

  const text = messageInputEl.value.trim();
  if (!text) return;

  try {
    // Gửi tin nhắn
    const messageId = await sendMessage(currentChatId, text);
    if (messageId) {
      messageInputEl.value = '';
      messageInputEl.focus();

      // Dừng typing
      setTypingStatus(currentChatId, false);
    }
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Lỗi gửi tin nhắn: ' + error.message);
  }
}

/**
 * Xử lý typing
 */
function handleTyping() {
  setTypingStatus(currentChatId, true);
}

/**
 * Cập nhật danh sách messages
 */
async function updateMessages(messages) {
  currentMessages = messages;

  // Xóa messages cũ
  messagesContainerEl.innerHTML = '';

  // Render messages mới
  for (const message of messages) {
    const messageEl = createMessageElement(message);
    messagesContainerEl.appendChild(messageEl);
  }

  // Scroll to bottom
  messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
}

/**
 * Tạo element cho message
 */
function createMessageElement(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${message.senderId === currentUser.uid ? 'own' : ''}`;

  // Avatar
  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'message-avatar';
  avatarDiv.textContent = message.senderName.charAt(0).toUpperCase();

  // Bubble
  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'message-bubble';

  // Text
  const textP = document.createElement('p');
  textP.className = 'message-text';
  textP.textContent = message.text;
  bubbleDiv.appendChild(textP);

  // Meta (time, status, seen)
  const metaDiv = document.createElement('div');
  metaDiv.className = 'message-meta';

  // Time
  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  const time = new Date(message.timestamp?.toDate?.() || Date.now());
  timeSpan.textContent = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  metaDiv.appendChild(timeSpan);

  // Status (chỉ hiển thị cho tin nhắn của user hiện tại)
  if (message.senderId === currentUser.uid) {
    const statusSpan = document.createElement('span');
    statusSpan.className = 'message-status';
    statusSpan.textContent = '✔✔';

    // Seen avatars
    if (message.seenBy && message.seenBy.length > 1) {
      const seenAvatarsDiv = document.createElement('div');
      seenAvatarsDiv.className = 'seen-avatars';
      seenAvatarsDiv.title = `Đã xem bởi ${message.seenBy.length - 1} người`;

      for (let i = 1; i < Math.min(message.seenBy.length, 4); i++) {
        const seenAvatar = document.createElement('div');
        seenAvatar.className = 'seen-avatar';
        seenAvatar.textContent = '✓';
        seenAvatarsDiv.appendChild(seenAvatar);
      }

      metaDiv.appendChild(seenAvatarsDiv);
    }

    metaDiv.appendChild(statusSpan);
  }

  bubbleDiv.appendChild(metaDiv);

  messageDiv.appendChild(avatarDiv);
  messageDiv.appendChild(bubbleDiv);

  return messageDiv;
}

// ============================================
// TYPING INDICATOR
// ============================================

/**
 * Cập nhật typing indicator
 */
async function updateTypingIndicator(userIds) {
  typingUserIds = userIds;

  if (userIds.length === 0) {
    typingIndicatorEl.classList.add('hidden');
    return;
  }

  // Lấy tên users
  const names = await getTypingUserNames(userIds);
  typingUsersEl.textContent = names.join(', ');

  typingIndicatorEl.classList.remove('hidden');
}

// ============================================
// VIEWING PROFILE
// ============================================

/**
 * Cập nhật viewing indicator
 */
async function updateViewingIndicator(userIds) {
  viewingUserIds = userIds;

  if (userIds.length === 0) {
    viewingIndicatorEl.classList.add('hidden');
    viewersInfoEl.classList.add('hidden');
    return;
  }

  // Cập nhật viewing badge
  viewingCountEl.textContent = userIds.length;
  viewingIndicatorEl.classList.remove('hidden');

  // Lấy tên users
  const names = await getViewingUserNames(userIds);

  // Cập nhật viewers list
  viewersListEl.innerHTML = '';
  for (const name of names) {
    const viewerItem = document.createElement('div');
    viewerItem.className = 'viewer-item';
    viewerItem.innerHTML = `
      <div class="viewer-avatar">👤</div>
      <div class="viewer-name">${name}</div>
    `;
    viewersListEl.appendChild(viewerItem);
  }

  viewersInfoEl.classList.remove('hidden');
}

/**
 * Mở profile panel
 */
async function openProfilePanel() {
  profilePanelEl.classList.remove('hidden');

  // Cập nhật profile info
  const profileNameEl = profileInfoEl.querySelector('.profile-name');
  const profileEmailEl = profileInfoEl.querySelector('.profile-email');
  const profileStatusEl = profileInfoEl.querySelector('.profile-status');

  profileNameEl.textContent = currentUser.displayName;
  profileEmailEl.textContent = currentUser.email;
  profileStatusEl.textContent = '🟢 Online';

  // Bắt đầu viewing
  await setViewingStatus(currentUser.uid, true);
}

/**
 * Đóng profile panel
 */
async function closeProfilePanel() {
  profilePanelEl.classList.add('hidden');

  // Dừng viewing
  await setViewingStatus(currentUser.uid, false);
}

// ============================================
// CHAT CREATION
// ============================================

/**
 * Mở modal tạo chat mới
 */
function openNewChatModal() {
  newChatModalEl.classList.remove('hidden');
  chatNameInputEl.value = '';
  participantInputEl.value = '';
  selectedChatParticipants = [];
  updateParticipantsList();
}

/**
 * Đóng modal tạo chat mới
 */
function closeNewChatModal() {
  newChatModalEl.classList.add('hidden');
}

/**
 * Thêm người tham gia
 */
function addParticipant() {
  const uid = participantInputEl.value.trim();
  if (!uid) {
    alert('Vui lòng nhập UID');
    return;
  }

  if (uid === currentUser.uid) {
    alert('Không thể thêm chính mình');
    return;
  }

  if (selectedChatParticipants.includes(uid)) {
    alert('Người này đã được thêm');
    return;
  }

  selectedChatParticipants.push(uid);
  participantInputEl.value = '';
  updateParticipantsList();
}

/**
 * Cập nhật danh sách người tham gia
 */
function updateParticipantsList() {
  participantsListEl.innerHTML = '';

  if (selectedChatParticipants.length === 0) {
    participantsListEl.innerHTML = '<p class="text-small">Chưa có người tham gia</p>';
    return;
  }

  for (const uid of selectedChatParticipants) {
    const tag = document.createElement('div');
    tag.className = 'participant-tag';
    tag.innerHTML = `
      ${uid}
      <button type="button" onclick="removeParticipant('${uid}')">✕</button>
    `;
    participantsListEl.appendChild(tag);
  }
}

/**
 * Xóa người tham gia
 */
function removeParticipant(uid) {
  selectedChatParticipants = selectedChatParticipants.filter(u => u !== uid);
  updateParticipantsList();
}

/**
 * Tạo chat mới
 */
async function createNewChat() {
  const chatName = chatNameInputEl.value.trim();

  if (!chatName) {
    alert('Vui lòng nhập tên chat');
    return;
  }

  try {
    const chatId = await getOrCreateChat(selectedChatParticipants);
    if (chatId) {
      await loadChat(chatId);
      closeNewChatModal();

      // Thêm vào chat list
      const chatItem = document.createElement('div');
      chatItem.className = 'chat-item active';
      chatItem.dataset.chatId = chatId;
      chatItem.onclick = () => loadChat(chatId);
      chatItem.innerHTML = `
        <div class="chat-item-name">${chatName}</div>
        <div class="chat-item-preview">Bắt đầu cuộc trò chuyện</div>
      `;
      chatListEl.appendChild(chatItem);
    }
  } catch (error) {
    console.error('Error creating chat:', error);
    alert('Lỗi tạo chat: ' + error.message);
  }
}

// ============================================
// LOGOUT
// ============================================

/**
 * Xử lý đăng xuất
 */
async function handleLogout() {
  if (confirm('Bạn có chắc muốn đăng xuất?')) {
    try {
      await logout();
      stopNetworkMonitoring();
      alert('Đã đăng xuất');
      location.reload();
    } catch (error) {
      console.error('Error logging out:', error);
      alert('Lỗi đăng xuất: ' + error.message);
    }
  }
}

// ============================================
// GLOBAL FUNCTIONS (for HTML)
// ============================================

window.closeNewChatModal = closeNewChatModal;
window.addParticipant = addParticipant;
window.removeParticipant = removeParticipant;
window.createNewChat = createNewChat;

// ============================================
// START APP
// ============================================

document.addEventListener('DOMContentLoaded', initializeApp);
