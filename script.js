// --- Storage Keys ---
const USERS_KEY = 'chat_app_registered_users';
const MESSAGES_KEY = 'chat_app_messages';

// --- App State ---
let isRegisterMode = false;
let currentUser = null;
let activeContact = null;

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

// --- Helper Functions for Database (localStorage) ---
function getUsers() {
  const data = localStorage.getItem(USERS_KEY);
  if (!data) {
    // Seed default contacts so you have someone to message immediately
    const initial = {
      'support': { password: '123', contacts: [] },
      'alex': { password: '123', contacts: [] },
      'priya': { password: '123', contacts: [] }
    };
    localStorage.setItem(USERS_KEY, JSON.stringify(initial));
    return initial;
  }
  return JSON.parse(data);
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getMessages() {
  const data = localStorage.getItem(MESSAGES_KEY);
  return data ? JSON.parse(data) : [];
}

function saveMessages(msgs) {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(msgs));
}

function normalizeUsername(name) {
  return name.trim().toLowerCase().replace(/^@/, '');
}

// --- Unique Username & Password Authentication ---
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
    authTitle.textContent = 'Login';
    authSubmitBtn.textContent = 'Login';
    authSwitchText.textContent = 'Need an account?';
    authToggleLink.textContent = 'Create Unique Username';
  }
});

authSubmitBtn.addEventListener('click', () => {
  const rawUser = normalizeUsername(usernameInput.value);
  const pass = passwordInput.value;

  if (!rawUser || !pass) {
    authError.textContent = 'Please enter both username and password.';
    return;
  }

  const users = getUsers();

  if (isRegisterMode) {
    // Check if username is already taken
    if (users[rawUser]) {
      authError.textContent = `@${rawUser} is already taken! Choose another unique username.`;
      return;
    }
    users[rawUser] = {
      password: pass,
      contacts: ['support', 'alex', 'priya'].filter(u => u !== rawUser)
    };
    saveUsers(users);
    loginSuccess(rawUser);
  } else {
    if (!users[rawUser]) {
      authError.textContent = 'Username not found. Please register first.';
      return;
    }
    if (users[rawUser].password !== pass) {
      authError.textContent = 'Incorrect password.';
      return;
    }
    loginSuccess(rawUser);
  }
});

function loginSuccess(username) {
  currentUser = username;
  authError.textContent = '';
  usernameInput.value = '';
  passwordInput.value = '';

  authScreen.classList.add('hidden');
  appContainer.classList.remove('hidden');
  loggedInUserEl.textContent = `Logged in as @${currentUser}`;

  const users = getUsers();
  const userContacts = users[currentUser].contacts || [];
  renderContacts();

  if (userContacts.length > 0) {
    selectContact(userContacts[0]);
  }
}

logoutBtn.addEventListener('click', () => {
  currentUser = null;
  activeContact = null;
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
    // Desktop toggle
    sidebar.classList.toggle('closed');
  }
});

sidebarBackdrop.addEventListener('click', closeMenu);

// --- Contacts System ---
function renderContacts() {
  const users = getUsers();
  const contacts = users[currentUser]?.contacts || [];
  contactListEl.innerHTML = '';

  contacts.forEach(contactUsername => {
    const li = document.createElement('li');
    li.className = 'contact-item' + (contactUsername === activeContact ? ' active' : '');
    li.textContent = `@${contactUsername}`;
    li.addEventListener('click', () => {
      selectContact(contactUsername);
      // Automatically slide menu aside and return icon to triple lines on selection
      if (window.innerWidth <= 768) {
        closeMenu();
      }
    });
    contactListEl.appendChild(li);
  });
}

function selectContact(contactUsername) {
  activeContact = contactUsername;
  activeContactNameEl.textContent = `@${contactUsername}`;
  renderContacts();
  renderMessages();
}

addContactBtn.addEventListener('click', () => {
  const newContact = normalizeUsername(newContactInput.value);
  if (!newContact || newContact === currentUser) return;

  const users = getUsers();
  // Register placeholder if contact doesn't exist yet so you can message them
  if (!users[newContact]) {
    users[newContact] = { password: '123', contacts: [currentUser] };
  }

  if (!users[currentUser].contacts.includes(newContact)) {
    users[currentUser].contacts.push(newContact);
    saveUsers(users);
  }

  newContactInput.value = '';
  selectContact(newContact);
  if (window.innerWidth <= 768) {
    closeMenu();
  }
});

// --- Messaging Logic ---
function renderMessages() {
  messagesListEl.innerHTML = '';
  if (!activeContact) return;

  const allMessages = getMessages();
  const chatMessages = allMessages.filter(
    m => (m.from === currentUser && m.to === activeContact) ||
         (m.from === activeContact && m.to === currentUser)
  );

  chatMessages.forEach(msg => {
    const div = document.createElement('div');
    const isSent = msg.from === currentUser;
    div.className = `msg-bubble ${isSent ? 'msg-sent' : 'msg-received'}`;
    div.innerHTML = `
      <span>${msg.text}</span>
      <span class="msg-meta">${msg.time}</span>
    `;
    messagesListEl.appendChild(div);
  });

  messagesListEl.scrollTop = messagesListEl.scrollHeight;
}

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeContact) return;

  const allMessages = getMessages();
  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  allMessages.push({
    from: currentUser,
    to: activeContact,
    text: text,
    time: timeString
  });

  saveMessages(allMessages);
  messageInput.value = '';
  renderMessages();
  messageInput.focus();
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
