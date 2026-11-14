const BACKUP_STORAGE_KEY = 'smbef_self_healing_backup_v2';
const SESSION_USER_KEY = 'smbef_logged_in_user_v2';

const PRESET_GIFS = [
  'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
  'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
  'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif',
  'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif',
  'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
  'https://media.giphy.com/media/xT5LMHxhOfscxPfIfm/giphy.gif',
  'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif'
];

let isRegisterMode = false;
let currentUser = null;
let activeContact = 'global';
let userContacts = ['global', 'ai'];
let groupsMap = {};
let cachedMessages = [];
let pollInterval = null;
let lastMessagesSignature = '';

let editingMessageId = null;
let replyToData = null;
let starFilterActive = false;
let searchQuery = '';
let mediaRecorder = null;
let audioChunks = [];

// --- DOM Elements ---
const authScreen = document.getElementById('auth-screen');
const appContainer = document.getElementById('app-container');
const authTitle = document.getElementById('auth-title');
const authError = document.getElementById('auth-error');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleLink = document.getElementById('auth-toggle-link');
const authSwitchText = document.getElementById('auth-switch-text');

const menuToggleBtn = document.getElementById('menu-toggle-btn');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const contactListEl = document.getElementById('contact-list');
const newContactInput = document.getElementById('new-contact-input');
const addContactBtn = document.getElementById('add-contact-btn');
const contactErrorEl = document.getElementById('contact-error');

const activeContactNameEl = document.getElementById('active-contact-name');
const activeContactSubEl = document.getElementById('active-contact-sub');
const loggedInUserEl = document.getElementById('logged-in-user');
const logoutBtn = document.getElementById('logout-btn');
const messagesListEl = document.getElementById('messages-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

const searchToggleBtn = document.getElementById('search-toggle-btn');
const chatSearchInput = document.getElementById('chat-search-input');
const starFilterBtn = document.getElementById('star-filter-btn');
const groupInfoBtn = document.getElementById('group-info-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

const replyBanner = document.getElementById('reply-banner');
const replyToUserEl = document.getElementById('reply-to-user');
const replyToTextEl = document.getElementById('reply-to-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');

const editBanner = document.getElementById('edit-banner');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

const aiQuickBar = document.getElementById('ai-quick-bar');
const askAiBtn = document.getElementById('ask-ai-btn');
const gifToggleBtn = document.getElementById('gif-toggle-btn');
const gifPicker = document.getElementById('gif-picker');
const gifGrid = document.getElementById('gif-grid');
const customGifInput = document.getElementById('custom-gif-input');
const sendCustomGifBtn = document.getElementById('send-custom-gif-btn');
const photoBtn = document.getElementById('photo-btn');
const photoInput = document.getElementById('photo-input');
const voiceBtn = document.getElementById('voice-btn');

// Group Modals
const openCreateGroupBtn = document.getElementById('open-create-group-btn');
const createGroupModal = document.getElementById('create-group-modal');
const groupNameInput = document.getElementById('group-name-input');
const groupTypeSelect = document.getElementById('group-type-select');
const groupAllowAddCheckbox = document.getElementById('group-allow-add-checkbox');
const closeCreateGroupBtn = document.getElementById('close-create-group-btn');
const confirmCreateGroupBtn = document.getElementById('confirm-create-group-btn');

const groupInfoModal = document.getElementById('group-info-modal');
const infoGroupTitle = document.getElementById('info-group-title');
const infoGroupMeta = document.getElementById('info-group-meta');
const adminPermissionBox = document.getElementById('admin-permission-box');
const permissionStatusText = document.getElementById('permission-status-text');
const togglePermissionBtn = document.getElementById('toggle-permission-btn');
const groupAddMemberBar = document.getElementById('group-add-member-bar');
const groupAddUserInput = document.getElementById('group-add-user-input');
const groupAddUserBtn = document.getElementById('group-add-user-btn');
const groupManageError = document.getElementById('group-manage-error');
const groupMembersList = document.getElementById('group-members-list');
const closeGroupInfoBtn = document.getElementById('close-group-info-btn');

// Translator Modal
const translateModal = document.getElementById('translate-modal');
const translateOriginalText = document.getElementById('translate-original-text');
const translateLangSelect = document.getElementById('translate-lang-select');
const translateResultBox = document.getElementById('translate-result-box');
const closeTranslateBtn = document.getElementById('close-translate-btn');
const runTranslateBtn = document.getElementById('run-translate-btn');

function normalizeUsername(name) {
  return (name || '').trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Glowing Blue Link Formatter (Auto-Detects URLs and Opens on Click) ---
function formatTextWithGlowingLinks(rawText) {
  const safe = escapeHtml(rawText);
  const urlRegex = /((https?:\/\/|www\.)[^\s<]+)/gi;
  return safe.replace(urlRegex, (match) => {
    const href = match.toLowerCase().startsWith('http') ? match : `https://${match}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="glow-link">${match}</a>`;
  });
}

// --- Self-Healing Backup ---
function saveLocalBackup(backupData) {
  if (!backupData) return;
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backupData));
  } catch (e) {}
}

async function restoreServerIfNeeded() {
  try {
    const rawBackup = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!rawBackup) return;
    const backup = JSON.parse(rawBackup);
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.backup) saveLocalBackup(data.backup);
    }
  } catch (e) {}
}

window.addEventListener('DOMContentLoaded', async () => {
  initGifPicker();
  await restoreServerIfNeeded();
  const savedSession = localStorage.getItem(SESSION_USER_KEY);
  if (savedSession) {
    try {
      const { username, password } = JSON.parse(savedSession);
      if (username && password) {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.backup) saveLocalBackup(data.backup);
          loginSuccess(data.username, password, data.contacts, data.groups);
        }
      }
    } catch (e) {}
  }
});

// --- Theme / Dark Mode ---
themeToggleBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
});

// --- Authentication ---
authToggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  isRegisterMode = !isRegisterMode;
  authError.textContent = '';
  if (isRegisterMode) {
    authTitle.textContent = 'Create Unique Username';
    authSubmitBtn.textContent = 'Register Account';
    authSwitchText.textContent = 'Already have an account?';
    authToggleLink.textContent = 'Login here';
  } else {
    authTitle.textContent = 'SM-Bef Pro Login';
    authSubmitBtn.textContent = 'Login';
    authSwitchText.textContent = 'Need an account?';
    authToggleLink.textContent = 'Create Unique Username';
  }
});

async function handleAuth() {
  const rawUser = normalizeUsername(usernameInput.value);
  const pass = passwordInput.value.trim();

  if (!rawUser || !pass) {
    authError.textContent = 'Please enter both username and password.';
    return;
  }

  authSubmitBtn.disabled = true;
  authError.textContent = '';

  try {
    await restoreServerIfNeeded();
    const endpoint = isRegisterMode ? '/api/register' : '/api/login';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: rawUser, password: pass })
    });
    const data = await res.json();

    if (!res.ok) {
      authError.textContent = data.error || 'Authentication failed.';
      authSubmitBtn.disabled = false;
      return;
    }

    if (data.backup) saveLocalBackup(data.backup);
    loginSuccess(data.username, pass, data.contacts, data.groups);
  } catch (err) {
    authError.textContent = 'Cannot reach server.';
  }
  authSubmitBtn.disabled = false;
}

authSubmitBtn.addEventListener('click', handleAuth);
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAuth();
});

function loginSuccess(username, password, contacts, groups) {
  currentUser = username;
  userContacts = contacts || ['global', 'ai'];
  groupsMap = groups || {};

  localStorage.setItem(SESSION_USER_KEY, JSON.stringify({ username, password }));

  authScreen.classList.add('hidden');
  appContainer.classList.remove('hidden');
  loggedInUserEl.textContent = `@${currentUser} • Online`;

  renderContacts();
  selectContact('global');

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => syncMessagesAndContacts(false), 1500);
}

logoutBtn.addEventListener('click', () => {
  currentUser = null;
  localStorage.removeItem(SESSION_USER_KEY);
  if (pollInterval) clearInterval(pollInterval);
  appContainer.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

// --- Hamburger Drawer ---
function openMenu() {
  sidebar.classList.add('open');
  sidebar.classList.remove('closed');
  sidebarBackdrop.classList.add('show');
  menuToggleBtn.textContent = '✕';
}

function closeMenu() {
  sidebar.classList.remove('open');
  sidebar.classList.add('closed');
  sidebarBackdrop.classList.remove('show');
  menuToggleBtn.textContent = '☰';
}

menuToggleBtn.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.contains('open') ? closeMenu() : openMenu();
  } else {
    sidebar.classList.toggle('closed');
  }
});

sidebarBackdrop.addEventListener('click', closeMenu);

// --- Sidebar Contacts & Public/Private Groups Rendering ---
function getContactDisplay(id) {
  if (id === 'global') return { title: '🌐 SM-Bef Global Chat', badge: 'PUBLIC' };
  if (id === 'ai') return { title: '🤖 @ai (Smart Assistant)', badge: 'AI TOOL' };
  if (groupsMap[id]) {
    const g = groupsMap[id];
    const icon = g.type === 'public' ? '🌍' : '🔒';
    return { title: `${icon} ${g.name}`, badge: g.type.toUpperCase() };
  }
  return { title: `@${id}`, badge: 'USER' };
}

function renderContacts() {
  contactListEl.innerHTML = '';
  userContacts.forEach(cid => {
    const info = getContactDisplay(cid);
    const li = document.createElement('li');
    li.className = 'contact-item' + (cid === activeContact ? ' active' : '');
    li.innerHTML = `
      <span>${escapeHtml(info.title)}</span>
      <span class="badge-tag">${info.badge}</span>
    `;
    li.addEventListener('click', () => {
      selectContact(cid);
      if (window.innerWidth <= 768) closeMenu();
    });
    contactListEl.appendChild(li);
  });
}

function selectContact(cid) {
  activeContact = cid;
  lastMessagesSignature = '';
  cancelEditMode();
  cancelReplyMode();

  const info = getContactDisplay(cid);
  activeContactNameEl.textContent = info.title;

  if (cid === 'global') {
    activeContactSubEl.textContent = 'Public Group • Everyone can chat';
    groupInfoBtn.classList.add('hidden');
  } else if (cid === 'ai') {
    activeContactSubEl.textContent = 'AI Identification, Search, Math & Translation';
    groupInfoBtn.classList.add('hidden');
  } else if (groupsMap[cid]) {
    const g = groupsMap[cid];
    activeContactSubEl.textContent = `${g.type.toUpperCase()} Group • Admin: @${g.admin} • ${g.members.length} members`;
    groupInfoBtn.classList.remove('hidden');
  } else {
    activeContactSubEl.textContent = 'Direct Encrypted Chat';
    groupInfoBtn.classList.add('hidden');
  }

  renderContacts();
  syncMessagesAndContacts(true);
}

// --- Add Registered User Contact ---
async function handleAddContact() {
  contactErrorEl.textContent = '';
  const targetUser = normalizeUsername(newContactInput.value);
  if (!targetUser || targetUser === currentUser) return;

  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, contact: targetUser })
    });
    const data = await res.json();
    if (!res.ok) {
      contactErrorEl.textContent = data.error || 'User not registered!';
      return;
    }
    if (data.backup) saveLocalBackup(data.backup);
    userContacts = data.contacts;
    groupsMap = data.groups || groupsMap;
    newContactInput.value = '';
    selectContact(targetUser);
    if (window.innerWidth <= 768) closeMenu();
  } catch (err) {
    contactErrorEl.textContent = 'Error connecting to server.';
  }
}

addContactBtn.addEventListener('click', handleAddContact);

// --- Public & Private Group Creation & Admin Management ---
openCreateGroupBtn.addEventListener('click', () => {
  groupNameInput.value = '';
  createGroupModal.classList.remove('hidden');
});

closeCreateGroupBtn.addEventListener('click', () => {
  createGroupModal.classList.add('hidden');
});

confirmCreateGroupBtn.addEventListener('click', async () => {
  const name = groupNameInput.value.trim();
  const type = groupTypeSelect.value;
  const allowAdd = groupAllowAddCheckbox.checked;
  if (!name) return alert('Enter a group name.');

  try {
    const res = await fetch('/api/groups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        name: name,
        type: type,
        allow_member_add: allowAdd
      })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to create group.');

    if (data.backup) saveLocalBackup(data.backup);
    userContacts = data.contacts;
    groupsMap = data.groups;
    createGroupModal.classList.add('hidden');
    selectContact(data.group_id);
    if (window.innerWidth <= 768) closeMenu();
  } catch (err) {
    alert('Error creating group.');
  }
});

function openGroupInfoModal() {
  const grp = groupsMap[activeContact];
  if (!grp) return;

  groupManageError.textContent = '';
  infoGroupTitle.textContent = `${grp.type === 'public' ? '🌍' : '🔒'} ${grp.name}`;
  infoGroupMeta.textContent = `${grp.type.toUpperCase()} Group • Created by Admin @${grp.admin}`;

  const isAdmin = grp.admin === currentUser;

  if (isAdmin) {
    adminPermissionBox.classList.remove('hidden');
    permissionStatusText.textContent = grp.allow_member_add
      ? 'Member Add Permission: ON (All members can add people)'
      : 'Member Add Permission: OFF (Only Admin can add people)';
  } else {
    adminPermissionBox.classList.add('hidden');
  }

  if (isAdmin || grp.allow_member_add) {
    groupAddMemberBar.classList.remove('hidden');
  } else {
    groupAddMemberBar.classList.add('hidden');
  }

  groupMembersList.innerHTML = '';
  (grp.members || []).forEach(member => {
    const li = document.createElement('li');
    li.className = 'member-row';
    const roleTag = member === grp.admin ? ' 👑 (Admin)' : '';
    li.innerHTML = `<span>@${escapeHtml(member)}${roleTag}</span>`;

    if (isAdmin && member !== grp.admin) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'kick-btn';
      kickBtn.textContent = 'Remove';
      kickBtn.addEventListener('click', () => manageGroupAction('remove_member', member));
      li.appendChild(kickBtn);
    }
    groupMembersList.appendChild(li);
  });

  groupInfoModal.classList.remove('hidden');
}

groupInfoBtn.addEventListener('click', openGroupInfoModal);
document.getElementById('header-info-btn').addEventListener('click', () => {
  if (groupsMap[activeContact] && activeContact !== 'global') openGroupInfoModal();
});
closeGroupInfoBtn.addEventListener('click', () => groupInfoModal.classList.add('hidden'));

togglePermissionBtn.addEventListener('click', () => manageGroupAction('toggle_permission', ''));
groupAddUserBtn.addEventListener('click', () => {
  const target = normalizeUsername(groupAddUserInput.value);
  if (!target) return;
  groupAddUserInput.value = '';
  manageGroupAction('add_member', target);
});

async function manageGroupAction(action, target) {
  groupManageError.textContent = '';
  try {
    const res = await fetch('/api/groups/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        group_id: activeContact,
        action: action,
        target: target
      })
    });
    const data = await res.json();
    if (!res.ok) {
      groupManageError.textContent = data.error || 'Action denied.';
      return;
    }
    if (data.backup) saveLocalBackup(data.backup);
    userContacts = data.contacts;
    groupsMap = data.groups;
    openGroupInfoModal();
    syncMessagesAndContacts(true);
  } catch (err) {
    groupManageError.textContent = 'Server error.';
  }
}

// --- Built-in AI Assistant (Search, Identification & Math) ---
askAiBtn.addEventListener('click', () => {
  aiQuickBar.classList.toggle('hidden');
});

document.querySelectorAll('.ai-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.getAttribute('data-q');
    aiQuickBar.classList.add('hidden');
    runAiQuery(q);
  });
});

async function generateSmartAiAnswer(query) {
  const clean = query.replace(/^\/ai\s+/i, '').trim();

  // 1. Check if it's a math expression
  if (/^[0-9+\-*/().\s^%]+$/.test(clean)) {
    try {
      const result = Function(`"use strict"; return (${clean})`)();
      return `🧮 **AI Math Result:**\n${clean} = ${result}`;
    } catch (e) {}
  }

  // 2. Live Wikipedia Identification & Search
  const topic = clean
    .replace(/^(identify|what is|who is|tell me about|search|define|meaning of)\s+/i, '')
    .replace(/[?]/g, '')
    .trim();

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&utf8=&format=json&origin=*`;
    const sRes = await fetch(searchUrl);
    const sData = await sRes.json();
    if (sData?.query?.search?.length > 0) {
      const bestTitle = sData.query.search[0].title;
      const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestTitle)}`);
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        if (sumData.extract) {
          const wikiLink = sumData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(bestTitle)}`;
          return `🤖 AI Identification (${sumData.title}):\n${sumData.extract}\n🔗 Read more: ${wikiLink}`;
        }
      }
    }
  } catch (e) {}

  return `🤖 AI Assistant:\nI searched for "${clean}". Tip: Ask me to identify any person, place, science term, math equation, or tap 🌐 on any message to translate it!`;
}

async function runAiQuery(userPrompt) {
  // First send the user's question
  await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: currentUser,
      to: activeContact,
      text: userPrompt
    })
  });
  await syncMessagesAndContacts(true);

  // Generate AI response and post it back to the active chat
  const aiAnswer = await generateSmartAiAnswer(userPrompt);
  await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'ai',
      to: activeContact === 'ai' ? currentUser : activeContact,
      text: aiAnswer
    })
  });
  await syncMessagesAndContacts(true);
}

// --- Built-in Translator ---
let textToTranslate = '';
function openTranslator(text) {
  textToTranslate = text;
  translateOriginalText.textContent = `"${text}"`;
  translateResultBox.textContent = 'Select language and tap Translate Now.';
  translateModal.classList.remove('hidden');
}

closeTranslateBtn.addEventListener('click', () => translateModal.classList.add('hidden'));

runTranslateBtn.addEventListener('click', async () => {
  if (!textToTranslate) return;
  const targetLang = translateLangSelect.value;
  translateResultBox.textContent = 'Translating...';
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=autodetect|${targetLang}`;
    const res = await fetch(url);
    const data = await res.json();
    const translated = data?.responseData?.translatedText || 'Translation unavailable for this phrase.';
    translateResultBox.textContent = translated;
  } catch (e) {
    translateResultBox.textContent = 'Could not reach translation service.';
  }
});

// --- Photo Sharing & Voice Note Recording ---
photoBtn.addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const maxDim = 480;
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxDim) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else if (h > maxDim) {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const base64Image = canvas.toDataURL('image/jpeg', 0.7);

      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: currentUser,
          to: activeContact,
          image: base64Image
        })
      });
      syncMessagesAndContacts(true);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  photoInput.value = '';
});

voiceBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    voiceBtn.classList.remove('recording');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = async () => {
        await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: currentUser,
            to: activeContact,
            audio: reader.result
          })
        });
        syncMessagesAndContacts(true);
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    voiceBtn.classList.add('recording');
  } catch (err) {
    alert('Microphone permission is required to record voice notes.');
  }
});

// --- Search & Starred Filter ---
searchToggleBtn.addEventListener('click', () => {
  chatSearchInput.classList.toggle('hidden');
  if (!chatSearchInput.classList.contains('hidden')) {
    chatSearchInput.focus();
  } else {
    chatSearchInput.value = '';
    searchQuery = '';
    renderMessages(cachedMessages, true);
  }
});

chatSearchInput.addEventListener('input', () => {
  searchQuery = chatSearchInput.value.trim().toLowerCase();
  renderMessages(cachedMessages, true);
});

starFilterBtn.addEventListener('click', () => {
  starFilterActive = !starFilterActive;
  starFilterBtn.classList.toggle('active', starFilterActive);
  renderMessages(cachedMessages, true);
});

// --- GIF Picker ---
function initGifPicker() {
  gifGrid.innerHTML = '';
  PRESET_GIFS.forEach(url => {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'gif-item';
    img.addEventListener('click', () => {
      sendGifMessage(url);
      gifPicker.classList.add('hidden');
    });
    gifGrid.appendChild(img);
  });
}

gifToggleBtn.addEventListener('click', () => gifPicker.classList.toggle('hidden'));

sendCustomGifBtn.addEventListener('click', () => {
  const url = customGifInput.value.trim();
  if (!url) return;
  sendGifMessage(url);
  customGifInput.value = '';
  gifPicker.classList.add('hidden');
});

async function sendGifMessage(gifUrl) {
  await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: currentUser,
      to: activeContact,
      gif: gifUrl
    })
  });
  syncMessagesAndContacts(true);
}

// --- Reply, Edit, React, Star, Forward & Delete ---
function startReplyMode(msg) {
  replyToData = { id: msg.id, from: msg.from, text: msg.text || 'Media' };
  replyToUserEl.textContent = `Replying to @${msg.from}`;
  replyToTextEl.textContent = replyToData.text.slice(0, 60);
  replyBanner.classList.remove('hidden');
  messageInput.focus();
}

function cancelReplyMode() {
  replyToData = null;
  replyBanner.classList.add('hidden');
}

cancelReplyBtn.addEventListener('click', cancelReplyMode);

function startEditMessage(msgId, currentText) {
  editingMessageId = msgId;
  messageInput.value = currentText;
  editBanner.classList.remove('hidden');
  sendBtn.textContent = 'Update';
  messageInput.focus();
}

function cancelEditMode() {
  editingMessageId = null;
  messageInput.value = '';
  editBanner.classList.add('hidden');
  sendBtn.textContent = 'Send';
}

cancelEditBtn.addEventListener('click', cancelEditMode);

async function reactToMessage(msgId, emoji) {
  await fetch('/api/messages/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, id: msgId, reaction: emoji })
  });
  syncMessagesAndContacts(false);
}

async function toggleStarMessage(msgId) {
  await fetch('/api/messages/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, id: msgId, toggle_star: true })
  });
  syncMessagesAndContacts(false);
}

async function forwardMessage(msg) {
  const target = prompt('Enter @username or group ID (like global) to forward this message to:');
  if (!target) return;
  const cleanTarget = target.trim().toLowerCase().replace(/^@/, '');
  await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: currentUser,
      to: cleanTarget,
      text: msg.text || '',
      gif: msg.gif || '',
      image: msg.image || '',
      forwarded: true
    })
  });
  alert(`Forwarded to ${cleanTarget}!`);
}

async function deleteMessageById(msgId) {
  if (!confirm('Delete this message for everyone?')) return;
  await fetch('/api/messages/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: currentUser, id: msgId })
  });
  syncMessagesAndContacts(false);
}

// --- Real-Time Sync & Rendering ---
async function syncMessagesAndContacts(forceScroll = false) {
  if (!currentUser || !activeContact) return;

  try {
    const res = await fetch(`/api/messages?username=${encodeURIComponent(currentUser)}&contact=${encodeURIComponent(activeContact)}`);
    if (res.status === 401) {
      await restoreServerIfNeeded();
      return;
    }
    if (!res.ok) return;

    const data = await res.json();
    if (data.backup) saveLocalBackup(data.backup);

    if (data.groups) groupsMap = data.groups;
    if (data.contacts && JSON.stringify(data.contacts) !== JSON.stringify(userContacts)) {
      userContacts = data.contacts;
      renderContacts();
    }

    cachedMessages = data.messages || [];
    renderMessages(cachedMessages, forceScroll);
  } catch (err) {}
}

function renderMessages(chatMessages, forceScroll = false) {
  let filtered = chatMessages;
  if (starFilterActive) {
    filtered = filtered.filter(m => m.starred);
  }
  if (searchQuery) {
    filtered = filtered.filter(m => (m.text || '').toLowerCase().includes(searchQuery));
  }

  const currentSignature = JSON.stringify(filtered) + starFilterActive + searchQuery;
  if (!forceScroll && currentSignature === lastMessagesSignature) return;
  lastMessagesSignature = currentSignature;

  messagesListEl.innerHTML = '';

  filtered.forEach(msg => {
    if (msg.system) {
      const sysDiv = document.createElement('div');
      sysDiv.className = 'msg-system';
      sysDiv.textContent = msg.text;
      messagesListEl.appendChild(sysDiv);
      return;
    }

    const div = document.createElement('div');
    const isSent = msg.from === currentUser;
    div.className = `msg-bubble ${isSent ? 'msg-sent' : 'msg-received'}`;

    const senderHeader = (!isSent) ? `<span class="msg-sender">@${escapeHtml(msg.from)}</span>` : '';
    const forwardTag = msg.forwarded ? `<span class="msg-forwarded">↪ Forwarded</span>` : '';
    const replyHtml = msg.reply_to
      ? `<div class="msg-reply-quote"><strong>@${escapeHtml(msg.reply_to.from)}</strong>: ${escapeHtml(msg.reply_to.text)}</div>`
      : '';

    const textHtml = msg.text ? `<span>${formatTextWithGlowingLinks(msg.text)}</span>` : '';
    const gifHtml = msg.gif ? `<img src="${escapeHtml(msg.gif)}" class="msg-media-img" alt="GIF">` : '';
    const imgHtml = msg.image ? `<img src="${escapeHtml(msg.image)}" class="msg-media-img" alt="Photo">` : '';
    const audioHtml = msg.audio ? `<audio controls src="${escapeHtml(msg.audio)}" class="msg-audio"></audio>` : '';

    // Reactions
    const reactionsObj = msg.reactions || {};
    const reactionEntries = Object.entries(reactionsObj);
    let reactionsHtml = '';
    if (reactionEntries.length > 0) {
      reactionsHtml = `<div class="msg-reactions">` +
        reactionEntries.map(([u, r]) => `<span class="reaction-pill">${escapeHtml(r)} @${escapeHtml(u)}</span>`).join('') +
        `</div>`;
    }

    const editedTag = msg.edited ? ' (edited)' : '';
    const starIcon = msg.starred ? '⭐ ' : '';
    const ticksHtml = isSent ? `<span class="read-ticks">${msg.read ? '✓✓' : '✓'}</span>` : '';

    div.innerHTML = `
      ${senderHeader}
      ${forwardTag}
      ${replyHtml}
      ${textHtml}
      ${gifHtml}
      ${imgHtml}
      ${audioHtml}
      ${reactionsHtml}
      <div class="msg-footer">
        <span class="msg-meta">${starIcon}${escapeHtml(msg.time || '')}${editedTag}${ticksHtml}</span>
        <span class="msg-actions"></span>
      </div>
    `;

    const actionsSpan = div.querySelector('.msg-actions');

    // Quick Emoji Reaction Button
    const reactBtn = document.createElement('button');
    reactBtn.className = 'action-btn';
    reactBtn.textContent = '😊';
    reactBtn.title = 'React';
    reactBtn.addEventListener('click', () => {
      const emoji = prompt('Pick a reaction emoji: 👍 ❤️ 😂 😮 😢 🙏', '❤️');
      if (emoji) reactToMessage(msg.id, emoji.trim());
    });
    actionsSpan.appendChild(reactBtn);

    // Reply Button
    const replyBtn = document.createElement('button');
    replyBtn.className = 'action-btn';
    replyBtn.textContent = '↩';
    replyBtn.title = 'Reply';
    replyBtn.addEventListener('click', () => startReplyMode(msg));
    actionsSpan.appendChild(replyBtn);

    // Translate Button
    if (msg.text) {
      const transBtn = document.createElement('button');
      transBtn.className = 'action-btn';
      transBtn.textContent = '🌐';
      transBtn.title = 'Translate Message';
      transBtn.addEventListener('click', () => openTranslator(msg.text));
      actionsSpan.appendChild(transBtn);

      // Copy Button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'action-btn';
      copyBtn.textContent = '📋';
      copyBtn.title = 'Copy Text';
      copyBtn.addEventListener('click', () => navigator.clipboard.writeText(msg.text));
      actionsSpan.appendChild(copyBtn);
    }

    // Star Button
    const starBtn = document.createElement('button');
    starBtn.className = 'action-btn';
    starBtn.textContent = '⭐';
    starBtn.title = 'Star / Pin';
    starBtn.addEventListener('click', () => toggleStarMessage(msg.id));
    actionsSpan.appendChild(starBtn);

    // Forward Button
    const fwdBtn = document.createElement('button');
    fwdBtn.className = 'action-btn';
    fwdBtn.textContent = '↪';
    fwdBtn.title = 'Forward';
    fwdBtn.addEventListener('click', () => forwardMessage(msg));
    actionsSpan.appendChild(fwdBtn);

    // Edit & Delete for Sender
    if (isSent && msg.id) {
      if (msg.text) {
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn';
        editBtn.textContent = '✎';
        editBtn.title = 'Edit';
        editBtn.addEventListener('click', () => startEditMessage(msg.id, msg.text));
        actionsSpan.appendChild(editBtn);
      }
      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn';
      delBtn.textContent = '🗑';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', () => deleteMessageById(msg.id));
      actionsSpan.appendChild(delBtn);
    }

    messagesListEl.appendChild(div);
  });

  messagesListEl.scrollTop = messagesListEl.scrollHeight;
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeContact || !currentUser) return;

  // Check if user is talking to @ai or typed /ai
  if (activeContact === 'ai' || text.toLowerCase().startsWith('/ai ')) {
    messageInput.value = '';
    cancelReplyMode();
    await runAiQuery(text);
    return;
  }

  try {
    if (editingMessageId) {
      const targetId = editingMessageId;
      cancelEditMode();
      const res = await fetch('/api/messages/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser, id: targetId, text: text })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.backup) saveLocalBackup(data.backup);
      }
    } else {
      const currentReply = replyToData;
      messageInput.value = '';
      cancelReplyMode();
      messageInput.focus();

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: currentUser,
          to: activeContact,
          text: text,
          reply_to: currentReply
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || 'Could not send message.');
      } else {
        const data = await res.json();
        if (data.backup) saveLocalBackup(data.backup);
      }
    }
    await syncMessagesAndContacts(true);
  } catch (err) {
    alert('Failed to send message.');
  }
});

// --- Mobile Keyboard Adjustment ---
if (window.visualViewport) {
  const adjustViewport = () => {
    appContainer.style.height = `${window.visualViewport.height}px`;
    authScreen.style.height = `${window.visualViewport.height}px`;
    messagesListEl.scrollTop = messagesListEl.scrollHeight;
  };
  window.visualViewport.addEventListener('resize', adjustViewport);
  window.visualViewport.addEventListener('scroll', adjustViewport);
}
