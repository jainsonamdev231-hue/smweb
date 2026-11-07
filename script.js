// --- App State ---
let isRegisterMode = false;
let currentUser = null;
let activeContact = 'global';
let userContacts = [];
let pollInterval = null;

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

const activeContactNameEl = document.getElementById('active-contact-name');
const loggedInUserEl = document.getElementById('logged-in-user');
const logoutBtn = document.getElementById('logout-btn');
const messagesListEl = document.getElementById('messages-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

function normalizeUsername(name) {
  return name.trim().toLowerCase().replace(/^@/, '');
}

// --- Switch Between Login and Register ---
authToggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  isRegisterMode = !isRegisterMode;
  authError.textContent = '';
  if (isRegisterMode) {
    authTitle.textContent = 'Create Unique Username';
    authSubmitBtn.textContent = 'Register';
    authSwitchText.textContent = 'Already have a username?';
    authToggleLink.textContent = 'Login here';
  } else {
    authTitle.textContent = 'SM-Bef Login';
    authSubmitBtn.textContent = 'Login';
    authSwitchText.textContent = 'Need an account?';
    authToggleLink.textContent = 'Create Unique Username';
  }
});

// --- Server Authentication (Works Across All Devices) ---
authSubmitBtn.addEventListener('click', async () => {
  const rawUser = normalizeUsername(usernameInput.value);
  const pass = passwordInput.value.trim();

  if (!rawUser || !pass) {
    authError.textContent = 'Please enter both username and password.';
    return;
  }

  const endpoint = isRegisterMode ? '/api/register' : '/api/login';
  authSubmitBtn.disabled = true;

  try {
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

    authSubmitBtn.disabled = false;
    loginSuccess(data.username, data.contacts);
  } catch (err) {
    authError.textContent = 'Cannot reach Python server. Make sure app.py is running.';
    authSubmitBtn.disabled = false;
  }
});

function loginSuccess(username, contacts) {
  currentUser = username;
  userContacts = contacts || ['global'];
  authError.textContent = '';
  usernameInput.value = '';
  passwordInput.value = '';

  authScreen.classList.add('hidden');
  appContainer.classList.remove('hidden');
  loggedInUserEl.textContent = `Logged in as @${currentUser}`;

  renderContacts();
  selectContact('global');

  // Auto-refresh messages every 2 seconds across devices
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(fetchMessagesFromServer, 2000);
}

logoutBtn.addEventListener('click', () => {
  currentUser = null;
  if (pollInterval) clearInterval(pollInterval);
  appContainer.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

// --- Triple Line (Hamburger) Menu Logic ---
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
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    if (sidebar.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  } else {
    sidebar.classList.toggle('closed');
  }
});

sidebarBackdrop.addEventListener('click', closeMenu);

// --- Contacts System ---
function renderContacts() {
  contactListEl.innerHTML = '';

  userContacts.forEach(contactUsername => {
    const li = document.createElement('li');
    li.className = 'contact-item' + (contactUsername === activeContact ? ' active' : '');
    li.textContent = contactUsername === 'global' ? '🌐 SM-Bef Global Chat' : `@${contactUsername}`;
    li.addEventListener('click', () => {
      selectContact(contactUsername);
      if (window.innerWidth <= 768) {
        closeMenu();
      }
    });
    contactListEl.appendChild(li);
  });
}

function selectContact(contactUsername) {
  activeContact = contactUsername;
  activeContactNameEl.textContent = contactUsername === 'global' ? '🌐 SM-Bef Global Chat' : `@${contactUsername}`;
  renderContacts();
  fetchMessagesFromServer(true);
}

addContactBtn.addEventListener('click', async () => {
  const newContact = normalizeUsername(newContactInput.value);
  if (!newContact || newContact === currentUser) return;

  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: currentUser, contact: newContact })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Could not add contact.');
      return;
    }

    userContacts = data.contacts;
    newContactInput.value = '';
    selectContact(newContact);
    if (window.innerWidth <= 768) {
      closeMenu();
    }
  } catch (err) {
    alert('Error connecting to server.');
  }
});

// --- Server Messaging Logic ---
async function fetchMessagesFromServer(forceScroll = false) {
  if (!currentUser || !activeContact) return;

  try {
    const res = await fetch(`/api/messages?username=${encodeURIComponent(currentUser)}&contact=${encodeURIComponent(activeContact)}`);
    if (!res.ok) return;
    const data = await res.json();

    if (data.contacts && JSON.stringify(data.contacts) !== JSON.stringify(userContacts)) {
      userContacts = data.contacts;
      renderContacts();
    }

    renderMessages(data.messages || [], forceScroll);
  } catch (err) {
    // Silent catch during background polling
  }
}

function renderMessages(chatMessages, forceScroll = false) {
  const isNearBottom = messagesListEl.scrollHeight - messagesListEl.scrollTop - messagesListEl.clientHeight < 80;
  messagesListEl.innerHTML = '';

  chatMessages.forEach(msg => {
    const div = document.createElement('div');
    const isSent = msg.from === currentUser;
    div.className = `msg-bubble ${isSent ? 'msg-sent' : 'msg-received'}`;
    const senderLabel = (activeContact === 'global' && !isSent) ? `<strong style="display:block;font-size:12px;color:#00a884;">@${msg.from}</strong>` : '';
    div.innerHTML = `
      ${senderLabel}
      <span>${msg.text}</span>
      <span class="msg-meta">${msg.time}</span>
    `;
    messagesListEl.appendChild(div);
  });

  if (forceScroll || isNearBottom) {
    messagesListEl.scrollTop = messagesListEl.scrollHeight;
  }
}

messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeContact || !currentUser) return;

  messageInput.value = '';
  messageInput.focus();

  try {
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: currentUser,
        to: activeContact,
        text: text
      })
    });
    fetchMessagesFromServer(true);
  } catch (err) {
    alert('Failed to send message.');
  }
});

// --- Mobile Keyboard Viewport Fix ---
if (window.visualViewport) {
  const adjustViewport = () => {
    appContainer.style.height = `${window.visualViewport.height}px`;
    authScreen.style.height = `${window.visualViewport.height}px`;
    messagesListEl.scrollTop = messagesListEl.scrollHeight;
  };
  window.visualViewport.addEventListener('resize', adjustViewport);
  window.visualViewport.addEventListener('scroll', adjustViewport);
}
