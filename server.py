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

DEFAULT_LD_DIRS = [
    Path(r"C:\LDPlayer\LDPlayer14"),
    Path(r"C:\LDPlayer\LDPlayer9"),
    Path(r"D:\LDPlayer\LDPlayer9"),
    Path(r"D:\LDPlayer\LDPlayer14"),
]
LD_DIR = next((p for p in DEFAULT_LD_DIRS if (p / "ldconsole.exe").exists()), DEFAULT_LD_DIRS[0])
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
        res = subprocess.run(cmd_list, capture_output=True, text=True, timeout=15, encoding="utf-8", errors="ignore")
        return res.stdout.strip()
    except Exception:
        return ""

def get_adb_devices():
    output = run_cmd([str(ADB_EXE), "devices"])
    devices = []
    for line in output.splitlines():
        line = line.strip()
        if "\tdevice" in line:
            devices.append(line.split("\t")[0])
    return devices

def list_ld_instances():
    instances = []
    if LDCONSOLE_EXE.exists():
        output = run_cmd([str(LDCONSOLE_EXE), "list2"])
        for line in output.splitlines():
            parts = line.split(",")
            if len(parts) >= 2:
                idx = parts[0].strip()
                name = parts[1].strip()
                instances.append({"index": idx, "name": name, "running": False})
    
    adb_devs = get_adb_devices()
    # Map running instances: index 0 -> emulator-5554, index 1 -> emulator-5556 (or 5558)
    for inst in instances:
        expected_dev = f"emulator-{5554 + int(inst['index']) * 2}"
        if expected_dev in adb_devs or "emulator-5554" in adb_devs:
            inst["running"] = True
    return instances

def detect_instagram_accounts(instance_idx=0):
    """
    Auto-detects logged-in Instagram accounts using ADB shell with root access.
    Inspects USER_PREFERENCES.xml and shared_prefs for user identity.
    """
    dev_name = f"emulator-{5554 + int(instance_idx) * 2}"
    adb_devs = get_adb_devices()
    target_dev = dev_name if dev_name in adb_devs else (adb_devs[0] if adb_devs else None)

    if not target_dev:
        return []

    cmd = [
        str(ADB_EXE), "-s", target_dev, "shell",
        "su -c 'cat /data/data/com.instagram.android/shared_prefs/*USER_PREFERENCES.xml 2>/dev/null'"
    ]
    raw_xml = run_cmd(cmd)
    
    import re
    accounts = []
    # Match linked account names from fx_linkage_cache / account switcher
    matches = re.findall(r'&quot;username&quot;:&quot;([^&"]+)&quot;', raw_xml)
    for m in matches:
        m = m.strip()
        if len(m) > 2 and not m.endswith(".com") and " " not in m and not m.startswith("http"):
            accounts.append(m)

    # Secondary fallback check
    if not accounts:
        cmd2 = [
            str(ADB_EXE), "-s", target_dev, "shell",
            "su -c 'cat /data/data/com.instagram.android/shared_prefs/current.xml 2>/dev/null'"
        ]
        curr_xml = run_cmd(cmd2)
        matches2 = re.findall(r'value="([^"]+)"', curr_xml)
        for m in matches2:
            if len(m) > 2 and not m.isdigit() and "{" not in m:
                accounts.append(m)

    return list(dict.fromkeys(accounts))

def install_app_shortcut_to_ldplayer(instance_idx=0):
    dev_name = f"emulator-{5554 + int(instance_idx) * 2}"
    adb_devs = get_adb_devices()
    target_dev = dev_name if dev_name in adb_devs else (adb_devs[0] if adb_devs else None)
    if not target_dev:
        return False
    cmd = [
        str(ADB_EXE), "-s", target_dev, "shell",
        "am start -a android.intent.action.VIEW -d http://10.0.2.2:8099"
    ]
    res = run_cmd(cmd)
    return bool(res)

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

        if parsed.path == "/api/install-device":
            query = parse_qs(parsed.query)
            idx = query.get("index", ["0"])[0]
            success = install_app_shortcut_to_ldplayer(idx)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "installed": success, "message": f"Интерфейс запущен на экране LDPlayer #{idx}"}).encode("utf-8"))
            return

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
    print("=======================================================")
    print("LDPLAYER WARMUP ENGINE RUNNING ON:")
    print("Local PC GUI:      http://localhost:" + str(PORT))
    print("Inside LDPlayer:   http://10.0.2.2:" + str(PORT))
    print("Central Cloud Hub: " + str(CENTRAL_HUB))
    print("=======================================================")
    server.serve_forever()

if __name__ == '__main__':
    main()
