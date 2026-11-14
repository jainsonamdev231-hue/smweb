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

PUBLIC_RENDER_URL = os.environ.get('RENDER_EXTERNAL_URL', 'https://smweb-w58i.onrender.com').rstrip('/')

def default_groups():
    return {
        "global": {
            "id": "global",
            "name": "SM-Bef Global Chat",
            "type": "public",
            "admin": "system",
            "allow_member_add": True,
            "members": []
        }
    }

def load_db():
    if not os.path.exists(DB_FILE):
        initial_db = {
            "users": {},
            "groups": default_groups(),
            "messages": [],
            "deleted_ids": []
        }
        save_db(initial_db)
        return initial_db
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if "users" not in data:
                data["users"] = {}
            if "groups" not in data:
                data["groups"] = default_groups()
            if "global" not in data["groups"]:
                data["groups"]["global"] = default_groups()["global"]
            if "messages" not in data:
                data["messages"] = []
            if "deleted_ids" not in data:
                data["deleted_ids"] = []
            return data
    except Exception:
        return {
            "users": {},
            "groups": default_groups(),
            "messages": [],
            "deleted_ids": []
        }

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
    while True:
        time.sleep(480)
        try:
            req = urllib.request.Request(
                f"{PUBLIC_RENDER_URL}/ping",
                headers={'User-Agent': 'SM-Bef-KeepAlive/2.0'}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                response.read()
        except Exception as e:
            print(f"Keep-alive ping error: {e}")

keep_alive_thread = threading.Thread(target=keep_render_awake, daemon=True)
keep_alive_thread.start()

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

# --- Helper: Build User Sidebar Conversations & Accessible Groups ---
def get_user_state(db, username):
    user = db['users'].get(username, {})
    contacts = user.get('contacts', ['global', 'ai'])
    if 'global' not in contacts:
        contacts.insert(0, 'global')
    if 'ai' not in contacts:
        contacts.insert(1, 'ai')

    # Clean out private groups the user was removed from
    valid_contacts = []
    for c in contacts:
        if c in db['groups'] and c != 'global':
            grp = db['groups'][c]
            if grp.get('type') == 'private' and username not in grp.get('members', []):
                continue
        valid_contacts.append(c)

    # Automatically include all public groups so everyone can see them
    for gid, grp in db['groups'].items():
        if grp.get('type') == 'public' and gid not in valid_contacts:
            valid_contacts.append(gid)

    user['contacts'] = valid_contacts
    user['last_seen'] = datetime.now().strftime("%I:%M %p")

    visible_groups = {}
    for gid, grp in db['groups'].items():
        if grp.get('type') == 'public' or username in grp.get('members', []):
            visible_groups[gid] = grp

    return valid_contacts, visible_groups

# --- Self-Healing Auto-Restore ---
@app.route('/api/restore', methods=['POST'])
def restore_backup():
    incoming = request.json or {}
    inc_users = incoming.get('users', {})
    inc_groups = incoming.get('groups', {})
    inc_messages = incoming.get('messages', [])
    inc_deleted = incoming.get('deleted_ids', [])

    with db_lock:
        db = load_db()
        changed = False

        for d_id in inc_deleted:
            if d_id not in db['deleted_ids']:
                db['deleted_ids'].append(d_id)
                changed = True

        for uname, udata in inc_users.items():
            if uname not in db['users']:
                db['users'][uname] = udata
                changed = True
            else:
                existing_contacts = db['users'][uname].get('contacts', ['global', 'ai'])
                for c in udata.get('contacts', []):
                    if c not in existing_contacts:
                        existing_contacts.append(c)
                        changed = True
                db['users'][uname]['contacts'] = existing_contacts

        for gid, gdata in inc_groups.items():
            if gid not in db['groups']:
                db['groups'][gid] = gdata
                changed = True

        existing_map = {m.get('id'): m for m in db['messages'] if m.get('id')}
        for msg in inc_messages:
            msg_id = msg.get('id')
            if not msg_id or msg_id in db['deleted_ids']:
                continue
            if msg_id not in existing_map:
                db['messages'].append(msg)
                existing_map[msg_id] = msg
                changed = True
            else:
                target_m = existing_map[msg_id]
                if msg.get('edited') and not target_m.get('edited'):
                    target_m['text'] = msg.get('text', '')
                    target_m['edited'] = True
                    changed = True
                if msg.get('reactions'):
                    target_m['reactions'] = msg.get('reactions', {})
                    changed = True
                if msg.get('starred') is not None:
                    target_m['starred'] = msg.get('starred', False)
                    changed = True

        before_len = len(db['messages'])
        db['messages'] = [m for m in db['messages'] if m.get('id') not in db['deleted_ids']]
        if len(db['messages']) != before_len:
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
    if username in ['global', 'ai', 'system'] or username.startswith('group_'):
        return jsonify({"error": f"@{username} is a reserved system name."}), 400

    with db_lock:
        db = load_db()
        if username in db['users']:
            return jsonify({"error": f"@{username} is already taken! Choose another username."}), 409

        db['users'][username] = {
            "password": password,
            "contacts": ["global", "ai"],
            "status": "Hey there! I am using SM-Bef Pro.",
            "last_seen": datetime.now().strftime("%I:%M %p")
        }
        contacts, groups = get_user_state(db, username)
        save_db(db)
        return jsonify({
            "success": True,
            "username": username,
            "contacts": contacts,
            "groups": groups,
            "backup": db
        })

# --- 2. Login ---
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

        contacts, groups = get_user_state(db, username)
        save_db(db)

        return jsonify({
            "success": True,
            "username": username,
            "contacts": contacts,
            "groups": groups,
            "backup": db
        })

# --- 3. Add Direct Registered Contact ---
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

        if contact != 'ai' and contact not in db['users']:
            return jsonify({"error": f"@{contact} is NOT registered yet! They must create an account first."}), 404

        my_contacts = db['users'][username].get('contacts', ['global', 'ai'])
        if contact not in my_contacts:
            my_contacts.append(contact)
            db['users'][username]['contacts'] = my_contacts

        if contact in db['users']:
            their_contacts = db['users'][contact].get('contacts', ['global', 'ai'])
            if username not in their_contacts:
                their_contacts.append(username)
                db['users'][contact]['contacts'] = their_contacts

        contacts, groups = get_user_state(db, username)
        save_db(db)
        return jsonify({
            "success": True,
            "contacts": contacts,
            "groups": groups,
            "backup": db
        })

# --- 4. Create Public or Private Group ---
@app.route('/api/groups/create', methods=['POST'])
def create_group():
    data = request.json or {}
    username = data.get('username', '').strip().lower().lstrip('@')
    name = data.get('name', '').strip()
    gtype = data.get('type', 'private').strip().lower()
    allow_member_add = bool(data.get('allow_member_add', False))

    if not username or not name:
        return jsonify({"error": "Please enter a group name."}), 400
    if gtype not in ['public', 'private']:
        gtype = 'private'

    with db_lock:
        db = load_db()
        if username not in db['users']:
            return jsonify({"error": "Unauthorized"}), 401

        gid = f"group_{int(datetime.now().timestamp() * 1000)}"
        db['groups'][gid] = {
            "id": gid,
            "name": name,
            "type": gtype,
            "admin": username,
            "allow_member_add": allow_member_add,
            "members": [username]
        }

        if gid not in db['users'][username]['contacts']:
            db['users'][username]['contacts'].append(gid)

        # System announcement inside the group
        db['messages'].append({
            "id": f"{int(datetime.now().timestamp() * 1000)}_system",
            "from": "system",
            "to": gid,
            "text": f"Group '{name}' ({gtype.upper()}) created by @{username}.",
            "time": datetime.now().strftime("%I:%M %p"),
            "system": True
        })

        contacts, groups = get_user_state(db, username)
        save_db(db)
        return jsonify({
            "success": True,
            "group_id": gid,
            "contacts": contacts,
            "groups": groups,
            "backup": db
        })

# --- 5. Manage Group (Add Member, Remove Member, Toggle Permission) ---
@app.route('/api/groups/manage', methods=['POST'])
def manage_group():
    data = request.json or {}
    actor = data.get('username', '').strip().lower().lstrip('@')
    gid = data.get('group_id', '').strip()
    action = data.get('action', '').strip()
    target = data.get('target', '').strip().lower().lstrip('@')

    with db_lock:
        db = load_db()
        if actor not in db['users'] or gid not in db['groups']:
            return jsonify({"error": "Group or user not found."}), 404

        grp = db['groups'][gid]
        if gid == 'global':
            return jsonify({"error": "Global Chat settings cannot be modified."}), 400

        is_admin = (grp.get('admin') == actor)
        members = grp.get('members', [])

        if action == 'toggle_permission':
            if not is_admin:
                return jsonify({"error": "Only the group admin can change permissions."}), 403
            grp['allow_member_add'] = not grp.get('allow_member_add', False)
            status_str = "ALLOWED for all members" if grp['allow_member_add'] else "RESTRICTED to Admin only"
            db['messages'].append({
                "id": f"{int(datetime.now().timestamp() * 1000)}_system",
                "from": "system",
                "to": gid,
                "text": f"@{actor} changed permission: Adding members is now {status_str}.",
                "time": datetime.now().strftime("%I:%M %p"),
                "system": True
            })

        elif action == 'add_member':
            if not is_admin and not grp.get('allow_member_add', False):
                return jsonify({"error": "Permission declined: Only the Group Admin can add members to this group."}), 403
            if actor not in members and grp.get('type') == 'private':
                return jsonify({"error": "You are not a member of this group."}), 403
            if not target or target not in db['users']:
                return jsonify({"error": f"@{target} is NOT registered yet!"}), 404
            if target in members:
                return jsonify({"error": f"@{target} is already in the group."}), 400

            members.append(target)
            grp['members'] = members
            target_contacts = db['users'][target].get('contacts', ['global', 'ai'])
            if gid not in target_contacts:
                target_contacts.append(gid)
                db['users'][target]['contacts'] = target_contacts

            db['messages'].append({
                "id": f"{int(datetime.now().timestamp() * 1000)}_system",
                "from": "system",
                "to": gid,
                "text": f"@{actor} added @{target} to the group.",
                "time": datetime.now().strftime("%I:%M %p"),
                "system": True
            })

        elif action == 'remove_member':
            if not is_admin and actor != target:
                return jsonify({"error": "Only the Group Admin can remove members."}), 403
            if target == grp.get('admin'):
                return jsonify({"error": "The Group Admin cannot be removed."}), 400
            if target in members:
                members.remove(target)
                grp['members'] = members
            if target in db['users']:
                t_contacts = db['users'][target].get('contacts', [])
                if gid in t_contacts:
                    t_contacts.remove(gid)
                    db['users'][target]['contacts'] = t_contacts

            db['messages'].append({
                "id": f"{int(datetime.now().timestamp() * 1000)}_system",
                "from": "system",
                "to": gid,
                "text": f"@{target} was removed from the group by @{actor}.",
                "time": datetime.now().strftime("%I:%M %p"),
                "system": True
            })

        contacts, groups = get_user_state(db, actor)
        save_db(db)
        return jsonify({
            "success": True,
            "group": grp,
            "contacts": contacts,
            "groups": groups,
            "backup": db
        })

# --- 6. Fetch Messages, Read Receipts & Group State ---
@app.route('/api/messages', methods=['GET'])
def get_messages():
    username = request.args.get('username', '').strip().lower().lstrip('@')
    contact = request.args.get('contact', '').strip().lower().lstrip('@')

    with db_lock:
        db = load_db()
        if username not in db['users']:
            return jsonify({"error": "Unauthorized"}), 401

        contacts, groups = get_user_state(db, username)

        # Verify access if it's a group
        if contact in db['groups']:
            grp = db['groups'][contact]
            if grp.get('type') == 'private' and username not in grp.get('members', []):
                return jsonify({"error": "Access denied to private group."}), 403
            msgs = [m for m in db['messages'] if m.get('to') == contact]
        else:
            msgs = []
            changed_read = False
            for m in db['messages']:
                if (m.get('from') == username and m.get('to') == contact) or \
                   (m.get('from') == contact and m.get('to') == username):
                    if m.get('to') == username and not m.get('read'):
                        m['read'] = True
                        changed_read = True
                    msgs.append(m)
            if changed_read:
                save_db(db)

        contact_meta = {}
        if contact in db['users']:
            contact_meta = {
                "last_seen": db['users'][contact].get('last_seen', 'Online'),
                "status": db['users'][contact].get('status', '')
            }

        return jsonify({
            "messages": msgs,
            "contacts": contacts,
            "groups": groups,
            "contact_meta": contact_meta,
            "backup": db
        })

# --- 7. Send Message (Text, Links, Photo, Audio, Reply, Forward, AI) ---
@app.route('/api/messages', methods=['POST'])
def send_message():
    data = request.json or {}
    sender = data.get('from', '').strip().lower().lstrip('@')
    receiver = data.get('to', '').strip().lower().lstrip('@')
    text = data.get('text', '').strip()
    gif_url = data.get('gif', '').strip()
    image_data = data.get('image', '').strip()
    audio_data = data.get('audio', '').strip()
    reply_to = data.get('reply_to')
    forwarded = bool(data.get('forwarded', False))

    if not sender or not receiver or not any([text, gif_url, image_data, audio_data]):
        return jsonify({"error": "Empty message"}), 400

    with db_lock:
        db = load_db()
        if sender != 'ai' and sender not in db['users']:
            return jsonify({"error": "Sender not registered."}), 401

        # Check Private Group Membership Permission
        if receiver in db['groups'] and receiver != 'global':
            grp = db['groups'][receiver]
            if grp.get('type') == 'private' and sender != 'ai' and sender not in grp.get('members', []):
                return jsonify({"error": "Only added members can send messages in this private group."}), 403
            if grp.get('type') == 'public' and sender != 'ai' and sender not in grp.get('members', []):
                grp['members'].append(sender)

        msg = {
            "id": f"{int(datetime.now().timestamp() * 1000)}_{sender}",
            "from": sender,
            "to": receiver,
            "text": text,
            "gif": gif_url,
            "image": image_data,
            "audio": audio_data,
            "reply_to": reply_to,
            "forwarded": forwarded,
            "reactions": {},
            "starred": False,
            "edited": False,
            "read": (receiver == 'ai' or receiver in db['groups']),
            "time": datetime.now().strftime("%I:%M %p")
        }
        db['messages'].append(msg)

        if receiver not in db['groups'] and receiver != 'ai' and receiver in db['users'] and sender in db['users']:
            sender_contacts = db['users'][sender].get('contacts', ['global', 'ai'])
            if receiver not in sender_contacts:
                sender_contacts.append(receiver)
                db['users'][sender]['contacts'] = sender_contacts

            receiver_contacts = db['users'][receiver].get('contacts', ['global', 'ai'])
            if sender not in receiver_contacts:
                receiver_contacts.append(sender)
                db['users'][receiver]['contacts'] = receiver_contacts

        save_db(db)
        return jsonify({
            "success": True,
            "message": msg,
            "backup": db
        })

# --- 8. Edit, React & Star Message ---
@app.route('/api/messages/edit', methods=['POST'])
def edit_message():
    data = request.json or {}
    username = data.get('username', '').strip().lower().lstrip('@')
    msg_id = data.get('id', '').strip()
    new_text = data.get('text', '').strip()
    reaction = data.get('reaction', '').strip()
    toggle_star = data.get('toggle_star', False)

    with db_lock:
        db = load_db()
        for m in db['messages']:
            if m.get('id') == msg_id:
                if reaction:
                    reactions = m.get('reactions', {})
                    if reactions.get(username) == reaction:
                        del reactions[username]
                    else:
                        reactions[username] = reaction
                    m['reactions'] = reactions
                    save_db(db)
                    return jsonify({"success": True, "backup": db})

                if toggle_star:
                    m['starred'] = not m.get('starred', False)
                    save_db(db)
                    return jsonify({"success": True, "backup": db})

                if m.get('from') != username:
                    return jsonify({"error": "You can only edit your own messages."}), 403
                if new_text:
                    m['text'] = new_text
                    m['edited'] = True
                    save_db(db)
                    return jsonify({"success": True, "backup": db})

        return jsonify({"error": "Message not found."}), 404

# --- 9. Delete Message ---
@app.route('/api/messages/delete', methods=['POST'])
def delete_message():
    data = request.json or {}
    username = data.get('username', '').strip().lower().lstrip('@')
    msg_id = data.get('id', '').strip()

    with db_lock:
        db = load_db()
        target = next((m for m in db['messages'] if m.get('id') == msg_id), None)
        if not target:
            return jsonify({"error": "Message not found."}), 404
        if target.get('from') != username:
            return jsonify({"error": "You can only delete your own messages."}), 403

        db['messages'] = [m for m in db['messages'] if m.get('id') != msg_id]
        if msg_id not in db['deleted_ids']:
            db['deleted_ids'].append(msg_id)

        save_db(db)
        return jsonify({"success": True, "backup": db})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
