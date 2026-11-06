const PYTHON_SERVER_URL = "http://localhost:5000";

let username = "";
let userId = "user_" + Math.random().toString(36).substring(2, 9);
let currentRoom = "global-lounge";
let engineMode = "cloud";
let mqttClient = null;
let pySocket = null;

const loginModal = document.getElementById("login-modal");
const usernameInput = document.getElementById("username-input");
const serverModeSelect = document.getElementById("server-mode");
const joinBtn = document.getElementById("join-btn");
const myAvatar = document.getElementById("my-avatar");
const myUsernameDisplay = document.getElementById("my-username-display");
const connectionBadge = document.getElementById("connection-badge");
const messageContainer = document.getElementById("message-container");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const activeRoomName = document.getElementById("active-room-name");
const emojiTrigger = document.getElementById("emoji-trigger");
const clearChatBtn = document.getElementById("clear-chat-btn");

joinBtn.addEventListener("click", () => {
  const rawName = usernameInput.value.trim();
  username = rawName || "Explorer_" + Math.floor(1000 + Math.random() * 9000);
  engineMode = serverModeSelect.value;

  myUsernameDisplay.textContent = username;
  myAvatar.textContent = username.charAt(0).toUpperCase();
  loginModal.style.display = "none";

  if (engineMode === "python") {
    initPythonServer();
  } else {
    initGlobalCloudRelay();
  }
});

function initGlobalCloudRelay() {
  connectionBadge.textContent = "Connecting Global...";
  mqttClient = mqtt.connect("wss://broker.emqx.io:8084/mqtt");

  mqttClient.on("connect", () => {
    connectionBadge.textContent = "Global Live";
    subscribeToCloudRoom(currentRoom);
  });

  mqttClient.on("message", (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());
      if (data.room === currentRoom) {
        renderMessage(data);
      }
    } catch (err) {
      console.error("Message parse error:", err);
    }
  });
}

function subscribeToCloudRoom(room) {
  if (!mqttClient) return;
  const topic = `smweb/global/v1/${room}`;
  mqttClient.subscribe(topic, () => {
    publishCloudMessage({
      senderId: "system",
      sender: "System",
      text: `${username} joined #${room}`,
      room: room,
      time: formatTime(),
      system: true
    });
  });
}

function publishCloudMessage(msgObj) {
  if (!mqttClient) return;
  const topic = `smweb/global/v1/${currentRoom}`;
  mqttClient.publish(topic, JSON.stringify(msgObj));
}

function initPythonServer() {
  connectionBadge.textContent = "Connecting Python...";
  pySocket = io(PYTHON_SERVER_URL);

  pySocket.on("connect", () => {
    connectionBadge.textContent = "Python Server Live";
    pySocket.emit("join_room", { username, room: currentRoom });
  });

  pySocket.on("room_history", (history) => {
    messageContainer.innerHTML = "";
    history.forEach((msg) => renderMessage(msg));
  });

  pySocket.on("new_message", (msg) => {
    renderMessage(msg);
  });

  pySocket.on("connect_error", () => {
    connectionBadge.textContent = "Python Offline -> Cloud Fallback";
    engineMode = "cloud";
    pySocket.disconnect();
    initGlobalCloudRelay();
  });
}

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const msgPayload = {
    senderId: userId,
    sender: username,
    text: text,
    room: currentRoom,
    time: formatTime(),
    system: false
  };

  if (engineMode === "python" && pySocket) {
    pySocket.emit("send_message", msgPayload);
  } else {
    publishCloudMessage(msgPayload);
  }

  messageInput.value = "";
});

document.querySelectorAll(".chat-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".chat-item").forEach((el) => el.classList.remove("active"));
    item.classList.add("active");

    const newRoom = item.getAttribute("data-room");
    const roomTitle = item.querySelector(".chat-title").textContent;
    if (newRoom === currentRoom) return;

    currentRoom = newRoom;
    activeRoomName.textContent = roomTitle;
    messageContainer.innerHTML = "";

    if (engineMode === "python" && pySocket) {
      pySocket.emit("join_room", { username, room: currentRoom });
    } else if (mqttClient) {
      subscribeToCloudRoom(currentRoom);
    }
  });
});

function renderMessage(msg) {
  const div = document.createElement("div");

  if (msg.system) {
    div.className = "message-bubble system";
    div.textContent = `${msg.text} • ${msg.time}`;
  } else {
    const isMine = msg.senderId === userId;
    div.className = `message-bubble ${isMine ? "outgoing" : "incoming"}`;
    div.innerHTML = `
      ${!isMine ? `<div class="bubble-sender">${escapeHTML(msg.sender)}</div>` : ""}
      <div>${escapeHTML(msg.text)}</div>
      <div class="bubble-time">${msg.time}</div>
    `;
  }

  messageContainer.appendChild(div);
  messageContainer.scrollTop = messageContainer.scrollHeight;
}

emojiTrigger.addEventListener("click", () => {
  const emojis = ["🔥", "🚀", "😂", "❤️", "👍", "🎉", "💻"];
  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
  messageInput.value += randomEmoji;
  messageInput.focus();
});

clearChatBtn.addEventListener("click", () => {
  messageContainer.innerHTML = "";
});

function formatTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
