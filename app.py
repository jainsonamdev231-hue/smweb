import os
import json
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='.', template_folder='.')
DB_FILE = 'database.json'

def load_db():
    if not os.path.exists(DB_FILE):
        initial_db = {
            "users": {
                "support": {"password": "123", "contacts": ["global"]}
            },
            "messages": [
                {
                    "from": "support",
                    "to": "global",
                    "text": "Welcome to SM-Bef Global Chat!",
                    "time": "12:00 PM"
                }
            ]
        }
        save_db(initial_db)
        return initial_db
    with open(DB_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_db(data):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

# Serve index.html, style.css, and script.js from the same root folder
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory('.', filename)

# --- 1. Register Unique Username ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username', '').strip().lower().lstrip('@')
    password = data.get('password', '').strip()

    if not username or not password:
        return jsonify({"error": "Please enter both username and password."}), 400

    if username == 'global':
        return jsonify({"error": "@global is reserved for Global Chat."}), 400

    db = load_db()
    if username in db['users']:
        return jsonify({"error": f"@{username} is already taken! Please choose another unique username."}), 409

    db['users'][username] = {
        "password": password,
        "contacts": ["global", "support"]
    }
    save_db(db)
    return jsonify({
        "success": True,
        "username": username,
        "contacts": db['users'][username]['contacts']
    })

# --- 2. Login from ANY Device ---
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username', '').strip().lower().lstrip('@')
    password = data.get('password', '').strip()

    db = load_db()
    user = db['users'].get(username)

    if not user:
        return jsonify({"error": "Username not found. Please create an account first."}), 404

    if user['password'] != password:
        return jsonify({"error": "Incorrect password."}), 401

    if "global" not in user['contacts']:
        user['contacts'].insert(0, "global")
        save_db(db)

    return jsonify({
        "success": True,
        "username": username,
        "contacts": user['contacts']
    })

# --- 3. Add a Registered Contact ---
@app.route('/api/contacts', methods=['POST'])
def add_contact():
    data = request.json or {}
    username = data.get('username', '').strip().lower()
    contact = data.get('contact', '').strip().lower().lstrip('@')

    if not username or not contact or username == contact:
        return jsonify({"error": "Invalid contact username."}), 400

    db = load_db()
    if username not in db['users']:
        return jsonify({"error": "User not logged in."}), 401

    if contact != "global" and contact not in db['users']:
        return jsonify({"error": f"@{contact} has not registered an account yet."}), 404

    if contact not in db['users'][username]['contacts']:
        db['users'][username]['contacts'].append(contact)

    # Also add you to their contact list automatically so they see your message
    if contact in db['users'] and username not in db['users'][contact]['contacts']:
        db['users'][contact]['contacts'].append(username)

    save_db(db)
    return jsonify({
        "success": True,
        "contacts": db['users'][username]['contacts']
    })

# --- 4. Fetch Messages & Contacts ---
@app.route('/api/messages', methods=['GET'])
def get_messages():
    username = request.args.get('username', '').strip().lower()
    contact = request.args.get('contact', '').strip().lower()

    db = load_db()
    if username not in db['users']:
        return jsonify({"error": "Unauthorized"}), 401

    if contact == 'global':
        msgs = [m for m in db['messages'] if m.get('to') == 'global']
    else:
        msgs = [
            m for m in db['messages']
            if (m.get('from') == username and m.get('to') == contact) or
               (m.get('from') == contact and m.get('to') == username)
        ]

    return jsonify({
        "messages": msgs,
        "contacts": db['users'][username]['contacts']
    })

# --- 5. Send a Message ---
@app.route('/api/messages', methods=['POST'])
def send_message():
    data = request.json or {}
    sender = data.get('from', '').strip().lower()
    receiver = data.get('to', '').strip().lower()
    text = data.get('text', '').strip()

    if not sender or not receiver or not text:
        return jsonify({"error": "Empty message"}), 400

    db = load_db()
    time_str = datetime.now().strftime("%I:%M %p")

    msg = {
        "from": sender,
        "to": receiver,
        "text": text,
        "time": time_str
    }
    db['messages'].append(msg)

    # Ensure receiver automatically sees sender in their contacts list
    if receiver != 'global' and receiver in db['users']:
        if sender not in db['users'][receiver]['contacts']:
            db['users'][receiver]['contacts'].append(sender)

    save_db(db)
    return jsonify({"success": True, "message": msg})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
