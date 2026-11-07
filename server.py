"""
LDPlayer Warmup Master - Local Backend & GUI Engine
Runs on localhost:8099 with a modern Web GUI.
Communicates with LDPlayer instances via ADB and ldconsole.
Auto-detects logged-in Instagram accounts directly from device storage / package prefs.
Sends real-time telemetry to Central Warmup Hub: http://45.39.60.233:8098
"""
import os
import sys
import json
import time
import subprocess
import threading
import http.server
import socketserver
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PORT = 8099
BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "app_config.json"
LD_DIR = Path(r"C:\LDPlayer\LDPlayer14")
ADB_EXE = LD_DIR / "adb.exe"
LDCONSOLE_EXE = LD_DIR / "ldconsole.exe"
CENTRAL_HUB = "http://45.39.60.233:8098"
CENTRAL_TOKEN = "warmup_secret_token_2026"

DEFAULT_CONFIG = {
    "ldplayer_dir": str(LD_DIR),
    "hub_url": CENTRAL_HUB,
    "hub_token": CENTRAL_TOKEN,
    "accounts": [],
    "daily_limits": {
        "max_likes": 30,
        "max_reels": 60,
        "max_comments": 5
    },
    "session_duration_min": [10, 25]
}

def load_config():
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return DEFAULT_CONFIG

def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

active_threads = {}

def run_cmd(cmd_list):
    try:
        res = subprocess.run(cmd_list, capture_output=True, text=True, timeout=15)
        return res.stdout.strip()
    except Exception as e:
        return ""

def list_ld_instances():
    if not LDCONSOLE_EXE.exists():
        return []
    output = run_cmd([str(LDCONSOLE_EXE), "list2"])
    instances = []
    for line in output.splitlines():
        parts = line.split(",")
        if len(parts) >= 2:
            idx = parts[0].strip()
            name = parts[1].strip()
            instances.append({"index": idx, "name": name, "running": False})
    
    running = run_cmd([str(LDCONSOLE_EXE), "runninglist"])
    running_names = [r.strip() for r in running.splitlines() if r.strip()]
    for inst in instances:
        if inst["name"] in running_names:
            inst["running"] = True
    return instances

def detect_instagram_accounts(instance_idx=0):
    """
    Auto-detects Instagram accounts directly from LDPlayer instance using ADB root shell.
    Checks /data/data/com.instagram.android/shared_prefs/ and dumps.
    """
    accounts = []
    # Try ldconsole adb
    cmd = [
        str(LDCONSOLE_EXE), "adb", "--index", str(instance_idx),
        "--command", "su -c 'ls /data/data/com.instagram.android/shared_prefs/'"
    ]
    prefs_list = run_cmd(cmd)
    
    # Try reading current.xml or user_profile.xml
    cat_cmd = [
        str(LDCONSOLE_EXE), "adb", "--index", str(instance_idx),
        "--command", "su -c 'cat /data/data/com.instagram.android/shared_prefs/current.xml 2>/dev/null'"
    ]
    current_xml = run_cmd(cat_cmd)
    if "username" in current_xml:
        import re
        matches = re.findall(r'value="([^"]+)"', current_xml)
        for m in matches:
            if len(m) > 2 and not m.isdigit() and "{" not in m:
                accounts.append(m)

    # Secondary check: accounts.xml or similar
    acc_cmd = [
        str(LDCONSOLE_EXE), "adb", "--index", str(instance_idx),
        "--command", "su -c 'cat /data/data/com.instagram.android/shared_prefs/*account*.xml 2>/dev/null'"
    ]
    acc_xml = run_cmd(acc_cmd)
    if acc_xml:
        import re
        matches = re.findall(r'username&quot;:&quot;([^&"]+)&quot;', acc_xml)
        for m in matches:
            if m not in accounts:
                accounts.append(m)

    return list(set(accounts))

class WarmupHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            cfg = load_config()
            instances = list_ld_instances()
            res = {
                "ok": True,
                "config": cfg,
                "instances": instances,
                "active_workers": list(active_threads.keys())
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if parsed.path == "/api/scan-accounts":
            query = parse_qs(parsed.query)
            idx = query.get("index", ["0"])[0]
            accounts = detect_instagram_accounts(idx)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "accounts": accounts}).encode("utf-8"))
            return

        # Serve static HTML/JS/CSS from web/ directory
        if parsed.path == "/" or parsed.path == "/index.html":
            html_file = BASE_DIR / "web" / "index.html"
            if html_file.exists():
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(html_file.read_bytes())
                return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        if parsed.path == "/api/config/save":
            save_config(data)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "message": "Настройки сохранены"}).encode("utf-8"))
            return

        if parsed.path == "/api/worker/start":
            account_id = data.get("account_id")
            idx = data.get("index", 0)
            if account_id in active_threads:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Воркер уже запущен для этого аккаунта"}).encode("utf-8"))
                return

            def worker_task():
                print(f"[Worker] Started warmup for {account_id} on LDPlayer {idx}")
                # Calls client-ldplayer runner script
                runner_script = BASE_DIR.parent / "client-ldplayer" / "dist" / "index.js"
                if runner_script.exists():
                    subprocess.run(["node", str(runner_script)], cwd=str(runner_script.parent))
                else:
                    time.sleep(30)
                active_threads.pop(account_id, None)

            t = threading.Thread(target=worker_task, daemon=True)
            active_threads[account_id] = t
            t.start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "message": f"Прогрев {account_id} запущен"}).encode("utf-8"))
            return

        if parsed.path == "/api/worker/stop":
            account_id = data.get("account_id")
            active_threads.pop(account_id, None)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "message": "Остановлен"}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

def main():
    os.chdir(str(BASE_DIR))
    server = socketserver.TCPServer(("0.0.0.0", PORT), WarmupHandler)
    print(f"\n=======================================================")
    print(f"🚀 LDPLAYER WARMUP ENGINE RUNNING ON:")
    print(f"👉 Local GUI:   http://localhost:{PORT}")
    print(f"👉 Network GUI: http://127.0.0.1:{PORT}")
    print(f"👉 Central Hub: {CENTRAL_HUB}")
    print(f"=======================================================\n")
    try:
        import webbrowser
        webbrowser.open(f"http://localhost:{PORT}")
    except Exception:
        pass
    server.serve_forever()

if __name__ == "__main__":
    main()
