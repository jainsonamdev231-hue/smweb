import os
from datetime import datetime
from flask import Flask, send_from_directory
from flask_socketio import SocketIO, join_room, emit

app = Flask(__name__, static_folder=".")
app.config["SECRET_KEY"] = "smweb-global-secret-key"

# Allow connections from GitHub Pages and any global domain
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory storage for recent messages per global channel
ROOM_HISTORY = {
    "global-lounge": [],
    "developers-hub": [],
    "gaming-arena": [],
    "music-chill": []
}

@app.route("/")
def serve_index():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def serve_static_files(path):
    return send_from_directory(".", path)

@socketio.on("join_room")
def handle_join(data):
    username = data.get("username", "Anonymous")
    room = data.get("room", "global-lounge")
    join_room(room)

    # Send existing room history to the newly joined user
    history = ROOM_HISTORY.get(room, [])
    emit("room_history", history)

    # Announce user arrival to the room
    join_announcement = {
        "senderId": "system",
        "sender": "System",
        "text": f"{username} connected to #{room} via Python Server",
        "room": room,
        "time": datetime.now().strftime("%I:%M %p"),
        "system": True
    }
    emit("new_message", join_announcement, to=room)

@socketio.on("send_message")
def handle_message(data):
    room = data.get("room", "global-lounge")
    message_obj = {
        "senderId": data.get("senderId"),
        "sender": data.get("sender", "Anonymous"),
        "text": data.get("text", ""),
        "room": room,
        "time": data.get("time") or datetime.now().strftime("%I:%M %p"),
        "system": False
    }

    if room in ROOM_HISTORY:
        ROOM_HISTORY[room].append(message_obj)
        # Keep only the latest 100 messages in RAM
        if len(ROOM_HISTORY[room]) > 100:
            ROOM_HISTORY[room].pop(0)

    emit("new_message", message_obj, to=room)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"smweb Python Server running globally on port {port}...")
    socketio.run(app, host="0.0.0.0", port=port)
