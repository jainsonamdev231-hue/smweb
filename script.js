const BACKUP_STORAGE_KEY = 'smbef_self_healing_backup_v1';
const SESSION_USER_KEY = 'smbef_logged_in_user_v1';

let isRegisterMode = false;
let currentUser = null;
let activeContact = 'global';
let userContacts = ['global'];
let pollInterval = null;
let lastMessagesSignature = '';

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
const loggedInUserEl = document.getElementById('logged-in-user');
const logoutBtn = document.getElementById('logout-btn');
const messagesListEl = document.getElementById('messages-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

function normalizeUsername(name) {
  return (name || '').trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
}

// --- Self-Healing Backup Mirror (Protects Against Server Resets) ---
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

// Run auto-restore on page load and restore active login session if saved
window.addEventListener('DOMContentLoaded', async () => {
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
          loginSuccess(data.username, password, data.contacts);
        }
      }
    } catch (e) {}
  }
});

// --- Toggle Between Login and Register ---
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
    authTitle.textContent = 'SM-Bef Login';
    authSubmitBtn.textContent = 'Login';
    authSwitchText.textContent = 'Need an account?';
    authToggleLink.textContent = 'Create Unique Username';
  }
});

// --- 1. Login / Register Authentication ---
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
    loginSuccess(data.username, pass, data.contacts);
  } catch (err) {
    authError.textContent = 'Cannot reach server. Make sure you opened https://smweb-w58i.onrender.com/';
  }
  authSubmitBtn.disabled = false;
}

authSubmitBtn.addEventListener('click', handleAuth);
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAuth();
});

function loginSuccess(username, password, contacts) {
  currentUser = username;
  userContacts = contacts && contacts.length ? contacts : ['global'];
  if (!userContacts.includes('global')) userContacts.unshift('global');

  localStorage.setItem(SESSION_USER_KEY, JSON.stringify({ username, password }));

  authError.textContent = '';
  usernameInput.value = '';
  passwordInput.value = '';

  authScreen.classList.add('hidden');
  appContainer.classList.remove('hidden');
  loggedInUserEl.textContent = `Logged in as @${currentUser}`;

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

// --- 2. Triple Line (Hamburger) Drawer ---
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

// --- 3. Strict Contact List (Only Registered Users) ---
function renderContacts() {
  contactListEl.innerHTML = '';
  userContacts.forEach(contactUsername => {
    const li = document.createElement('li');
    li.className = 'contact-item' + (contactUsername === activeContact ? ' active' : '');
    li.textContent = contactUsername === 'global' ? '🌐 SM-Bef Global Chat' : `@${contactUsername}`;
    li.addEventListener('click', () => {
      selectContact(contactUsername);
      if (window.innerWidth <= 768) closeMenu();
    });
    contactListEl.appendChild(li);
  });
}

function selectContact(contactUsername) {
  activeContact = contactUsername;
  lastMessagesSignature = '';
  activeContactNameEl.textContent = contactUsername === 'global' ? '🌐 SM-Bef Global Chat' : `@${contactUsername}`;
  renderContacts();
  syncMessagesAndContacts(true);
}

async function handleAddContact() {
  contactErrorEl.textContent = '';
  const targetUser = normalizeUsername(newContactInput.value);

  if (!targetUser) return;
  if (targetUser === currentUser) {
    contactErrorEl.textContent = 'You cannot add yourself!';
    return;
  }

  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, contact: targetUser })
    });
    const data = await res.json();

    if (!res.ok) {
      contactErrorEl.textContent = data.error || 'User is not registered!';
      return;
    }

    if (data.backup) saveLocalBackup(data.backup);
    userContacts = data.contacts;
    newContactInput.value = '';
    selectContact(targetUser);
    if (window.innerWidth <= 768) closeMenu();
  } catch (err) {
    contactErrorEl.textContent = 'Could not verify username with server.';
  }
}

addContactBtn.addEventListener('click', handleAddContact);
newContactInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleAddContact();
  }
});

// --- 4. Real-Time Messaging ---
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

    if (data.contacts && JSON.stringify(data.contacts) !== JSON.stringify(userContacts)) {
      userContacts = data.contacts;
      renderContacts();
    }

    renderMessages(data.messages || [], forceScroll);
  } catch (err) {}
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMessages(chatMessages, forceScroll = false) {
  const currentSignature = JSON.stringify(chatMessages);
  if (!forceScroll && currentSignature === lastMessagesSignature) return;
  lastMessagesSignature = currentSignature;

  messagesListEl.innerHTML = '';

  chatMessages.forEach(msg => {
    const div = document.createElement('div');
    const isSent = msg.from === currentUser;
    div.className = `msg-bubble ${isSent ? 'msg-sent' : 'msg-received'}`;

    const senderHeader = (!isSent) ? `<span class="msg-sender">@${escapeHtml(msg.from)}</span>` : '';
    div.innerHTML = `
      ${senderHeader}
      <span>${escapeHtml(msg.text)}</span>
      <span class="msg-meta">${escapeHtml(msg.time || '')}</span>
    `;
    messagesListEl.appendChild(div);
  });

  messagesListEl.scrollTop = messagesListEl.scrollHeight;
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeContact || !currentUser) return;

  messageInput.value = '';
  messageInput.focus();

  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: currentUser,
        to: activeContact,
        text: text
      })
    });

    if (res.status === 401) {
      await restoreServerIfNeeded();
    } else if (res.ok) {
      const data = await res.json();
      if (data.backup) saveLocalBackup(data.backup);
    }

    await syncMessagesAndContacts(true);
  } catch (err) {
    alert('Failed to send message. Check your connection.');
  }
});

// --- 5. Mobile & Tablet Keyboard Viewport Fix ---
if (window.visualViewport) {
  const adjustViewport = () => {
    appContainer.style.height = `${window.visualViewport.height}px`;
    authScreen.style.height = `${window.visualViewport.height}px`;
    messagesListEl.scrollTop = messagesListEl.scrollHeight;
  };
  window.visualViewport.addEventListener('resize', adjustViewport);
  window.visualViewport.addEventListener('scroll', adjustViewport);
}
