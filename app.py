import os
import json
import time
import threading
import urllib.request
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='.', template_folder='.')
DB_FILE = 'database.json'
db_lock = threading.Lock()

# Configured for your live Render URL so it stays awake 24/7
PUBLIC_RENDER_URL = os.environ.get('RENDER_EXTERNAL_URL', 'https://smweb-w58i.onrender.com').rstrip('/')

def load_db():
    if not os.path.exists(DB_FILE):
        initial_db = {"users": {}, "messages": []}
        save_db(initial_db)
        return initial_db
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if "users" not in data:
                data["users"] = {}
            if "messages" not in data:
                data["messages"] = []
            return data
    except Exception:
        return {"users": {}, "messages": []}

def save_db(data):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

# --- 24/7 Render Keep-Alive Route & Background Pinger ---
@app.route('/ping')
def ping():
    return jsonify({
        "status": "awake",
        "url": PUBLIC_RENDER_URL,
        "time": datetime.now().isoformat()
    }), 200

def keep_render_awake():
    """Pings https://smweb-w58i.onrender.com/ping every 8 minutes (480s) so it never sleeps."""
    while True:
        time.sleep(480)
        try:
            req = urllib.request.Request(
                f"{PUBLIC_RENDER_URL}/ping",
                headers={'User-Agent': 'SM-Bef-KeepAlive/1.0'}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                response.read()
        except Exception as e:
            print(f"Keep-alive ping error: {e}")

# Start the keep-alive thread immediately when Gunicorn loads app.py
keep_alive_thread = threading.Thread(target=keep_render_awake, daemon=True)
keep_alive_thread.start()

# Prevent mobile browsers from caching old JS/CSS or stale messages
@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/style.css')
def serve_css():
    return send_from_directory('.', 'style.css')

@app.route('/script.js')
def serve_js():
    return send_from_directory('.', 'script.js')

# --- Self-Healing Auto-Restore (Protects Against Server Resets) ---
@app.route('/api/restore', methods=['POST'])
def restore_backup():
    incoming = request.json or {}
    inc_users = incoming.get('users', {})
    inc_messages = incoming.get('messages', [])

    with db_lock:
        db = load_db()
        changed = False

        for uname, udata in inc_users.items():
            if uname not in db['users']:
                db['users'][uname] = udata
                changed = True
            else:
                existing_contacts = db['users'][uname].get('contacts', ['global'])
                for c in udata.get('contacts', []):
                    if c not in existing_contacts:
                        existing_contacts.append(c)
                        changed = True
                db['users'][uname]['contacts'] = existing_contacts

        existing_ids = {m.get('id') for m in db['messages'] if m.get('id')}
        for msg in inc_messages:
            msg_id = msg.get('id')
            if msg_id and msg_id not in existing_ids:
                db['messages'].append(msg)
                existing_ids.add(msg_id)
                changed = True

        if changed:
            save_db(db)

        return jsonify({"success": True, "backup": db})

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

    with db_lock:
        db = load_db()
        if username in db['users']:
            return jsonify({"error": f"@{username} is already taken! Choose another username."}), 409

        db['users'][username] = {
            "password": password,
            "contacts": ["global"]
        }
        save_db(db)
        return jsonify({
            "success": True,
            "username": username,
            "contacts": ["global"],
            "backup": db
        })

# --- 2. Login from Any Device ---
@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username', '').strip().lower().lstrip('@')
    password = data.get('password', '').strip()

    with db_lock:
        db = load_db()
        user = db['users'].get(username)

        if not user:
            return jsonify({"error": f"@{username} is not registered yet! Create an account first."}), 404
        if user.get('password') != password:
            return jsonify({"error": "Incorrect password!"}), 401

        contacts = user.get('contacts', ['global'])
        if 'global' not in contacts:
            contacts.insert(0, 'global')
            user['contacts'] = contacts
            save_db(db)

        return jsonify({
            "success": True,
            "username": username,
            "contacts": contacts,
            "backup": db
        })

# --- 3. Add Contact (Strictly Registered Users Only) ---
@app.route('/api/contacts', methods=['POST'])
def add_contact():
    data = request.json or {}
    username = data.get('username', '').strip().lower().lstrip('@')
    contact = data.get('contact', '').strip().lower().lstrip('@')

    if not username or not contact:
        return jsonify({"error": "Enter a valid username."}), 400
    if username == contact:
        return jsonify({"error": "You cannot add yourself."}), 400

    with db_lock:
        db = load_db()
        if username not in db['users']:
            return jsonify({"error": "Please log in again."}), 401

        if contact not in db['users']:
            return jsonify({"error": f"@{contact} is NOT registered yet! They must create an account first."}), 404

        my_contacts = db['users'][username].get('contacts', ['global'])
        if contact not in my_contacts:
            my_contacts.append(contact)
            db['users'][username]['contacts'] = my_contacts

        their_contacts = db['users'][contact].get('contacts', ['global'])
        if username not in their_contacts:
            their_contacts.append(username)
            db['users'][contact]['contacts'] = their_contacts

        save_db(db)
        return jsonify({
            "success": True,
            "contacts": my_contacts,
            "backup": db
        })

# --- 4. Fetch Messages & Contacts ---
@app.route('/api/messages', methods=['GET'])
def get_messages():
    username = request.args.get('username', '').strip().lower().lstrip('@')
    contact = request.args.get('contact', '').strip().lower().lstrip('@')

    with db_lock:
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
            "contacts": db['users'][username].get('contacts', ['global']),
            "backup": db
        })

# --- 5. Send Message ---
@app.route('/api/messages', methods=['POST'])
def send_message():
    data = request.json or {}
    sender = data.get('from', '').strip().lower().lstrip('@')
    receiver = data.get('to', '').strip().lower().lstrip('@')
    text = data.get('text', '').strip()

    if not sender or not receiver or not text:
        return jsonify({"error": "Empty message"}), 400

    with db_lock:
        db = load_db()
        if sender not in db['users']:
            return jsonify({"error": "Sender not registered."}), 401
        if receiver != 'global' and receiver not in db['users']:
            return jsonify({"error": f"@{receiver} is not registered."}), 404

        msg = {
            "id": f"{int(datetime.now().timestamp() * 1000)}_{sender}",
            "from": sender,
            "to": receiver,
            "text": text,
            "time": datetime.now().strftime("%I:%M %p")
        }
        db['messages'].append(msg)

        if receiver != 'global':
            sender_contacts = db['users'][sender].get('contacts', ['global'])
            if receiver not in sender_contacts:
                sender_contacts.append(receiver)
                db['users'][sender]['contacts'] = sender_contacts

            receiver_contacts = db['users'][receiver].get('contacts', ['global'])
            if sender not in receiver_contacts:
                receiver_contacts.append(sender)
                db['users'][receiver]['contacts'] = receiver_contacts

        save_db(db)
        return jsonify({
            "success": True,
            "message": msg,
            "backup": db
        })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
