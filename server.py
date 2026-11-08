import os
import sys
import json
import time
import subprocess
import threading
import http.server
import socketserver
import re
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
        "max_reels": 30,
        "max_likes": 15,
        "max_comments": 3
    },
    "session_duration_min": [10, 25]
}

live_logs = []
MAX_LOGS = 100

def add_log(msg):
    ts = time.strftime("%H:%M:%S")
    entry = f"[{ts}] {msg}"
    live_logs.append(entry)
    if len(live_logs) > MAX_LOGS:
        live_logs.pop(0)
    try:
        print(entry)
    except Exception:
        pass

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

def get_device_for_index(instance_idx):
    adb_devs = get_adb_devices()
    if not adb_devs:
        return None
    try:
        expected = f"emulator-{5554 + int(instance_idx) * 2}"
        if expected in adb_devs:
            return expected
    except Exception:
        pass
    if len(adb_devs) == 1:
        return adb_devs[0]
    idx = int(instance_idx)
    if idx < len(adb_devs):
        return adb_devs[idx]
    return adb_devs[0] if adb_devs else None

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
    for inst in instances:
        dev = get_device_for_index(inst["index"])
        if dev and dev in adb_devs:
            inst["running"] = True
            inst["device_id"] = dev
    return instances

def detect_instagram_accounts(instance_idx=0, scan_all=False):
    adb_devs = get_adb_devices()
    if not adb_devs:
        return []

    target_devices = adb_devs if scan_all else [get_device_for_index(instance_idx)]
    found_accounts = []

    for dev in target_devices:
        if not dev:
            continue
        cmd = [
            str(ADB_EXE), "-s", dev, "shell",
            "su -c 'cat /data/data/com.instagram.android/shared_prefs/com.instagram.android_preferences.xml 2>/dev/null'"
        ]
        xml = run_cmd(cmd)
        if not xml:
            continue

        device_accs = []
        family_match = re.search(r'name="account_linking_family_map_data">(.*?)</string>', xml, re.DOTALL)
        if family_match:
            raw_content = family_match.group(1)
            usernames = re.findall(r'username\\&quot;:\\&quot;([^\\&"]+)\\&quot;', raw_content)
            device_accs.extend(usernames)

        current_match = re.search(r'name="current">([^<]+)</string>', xml)
        if current_match:
            curr_text = current_match.group(1)
            curr_users = re.findall(r'&quot;username&quot;:&quot;([^&"]+)&quot;', curr_text)
            device_accs.extend(curr_users)

        for u in device_accs:
            u = u.strip()
            if len(u) > 2 and not u.endswith(".com") and " " not in u:
                if not any(a["username"] == u for a in found_accounts):
                    found_accounts.append({
                        "username": u,
                        "device_id": dev
                    })

    return found_accounts

def sync_client_runner_config(target_accounts):
    client_dir = BASE_DIR.parent / "client-ldplayer"
    client_cfg_file = client_dir / "config.json"
    
    dev_map = {}
    for acc in target_accounts:
        dev = acc.get("device_id") or "emulator-5554"
        if dev not in dev_map:
            dev_map[dev] = []
        
        # Parse customized limits
        limits = acc.get("limits") or {}
        max_reels = int(limits.get("reels", 30))
        max_likes = int(limits.get("likes", 15))
        max_comments = int(limits.get("comments", 2))

        dev_map[dev].append({
            "account_id": acc.get("account_id") or acc.get("username"),
            "username": acc.get("username"),
            "niche_tags": acc.get("niche_tags") or ["dogs", "reels", "puppy"],
            "daily_limits": { "max_likes": max_likes, "max_reels": max_reels, "max_comments": max_comments },
            "session_minutes": [8, 15]
        })

    instances_list = []
    for i, (dev, accs) in enumerate(dev_map.items()):
        instances_list.append({
            "instance_id": f"LDPlayer-{i}",
            "adb_device": dev,
            "nekobox_package": "moe.nb4a",
            "accounts": accs
        })

    runner_cfg = {
        "server_hub": {
            "api_url": CENTRAL_HUB,
            "api_key": CENTRAL_TOKEN,
            "sync_interval_seconds": 10
        },
        "ldplayer_path": str(LD_DIR),
        "instances": instances_list,
        "content_generation": {
            "llm_enabled": False,
            "fallback_spintax": [
                "{Awesome|So good|Love this}! {🐶|🐾|❤️}",
                "Those eyes are {everything|so cute}! 😍",
                "{Such a good|Beautiful} {dog|pup}! {✨|🐕}"
            ]
        }
    }

    with open(client_cfg_file, "w", encoding="utf-8") as f:
        json.dump(runner_cfg, f, indent=2, ensure_ascii=False)

def run_worker_thread(account_ids):
    cfg = load_config()
    target_accs = [a for a in cfg.get("accounts", []) if a.get("account_id") in account_ids or a.get("username") in account_ids]
    if not target_accs:
        target_accs = [{"account_id": aid, "username": aid, "device_id": "emulator-5554"} for aid in account_ids]

    sync_client_runner_config(target_accs)
    runner_script = BASE_DIR.parent / "client-ldplayer" / "dist" / "index.js"
    add_log(f"Старт воркера прогрева для аккаунтов: {', '.join(account_ids)}")
    try:
        proc = subprocess.Popen(
            ["node", str(runner_script)],
            cwd=str(runner_script.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="ignore"
        )
        for line in proc.stdout:
            cleaned = line.strip()
            if cleaned:
                add_log(cleaned)
        proc.wait()
    except Exception as e:
        add_log(f"Ошибка воркера: {e}")
    finally:
        for aid in account_ids:
            active_threads.pop(aid, None)
        add_log("Сессия прогрева завершена.")

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
                "active_workers": list(active_threads.keys()),
                "logs": live_logs[-40:]
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if parsed.path == "/api/scan-accounts":
            query = parse_qs(parsed.query)
            idx = query.get("index", ["0"])[0]
            scan_all = query.get("all", ["false"])[0] == "true"
            acc_list = detect_instagram_accounts(idx, scan_all=scan_all)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "accounts": acc_list}).encode("utf-8"))
            return

        if parsed.path == "/api/install-device":
            query = parse_qs(parsed.query)
            idx = query.get("index", ["0"])[0]
            dev = get_device_for_index(idx)
            success = False
            if dev:
                cmd = [str(ADB_EXE), "-s", dev, "shell", "am start -a android.intent.action.VIEW -d http://10.0.2.2:8099"]
                run_cmd(cmd)
                success = True
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
            if not account_id:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": "Не указан account_id"}).encode("utf-8"))
                return

            if account_id in active_threads:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "message": "Воркер уже работает"}).encode("utf-8"))
                return

            t = threading.Thread(target=run_worker_thread, args=([account_id],), daemon=True)
            active_threads[account_id] = t
            t.start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "message": f"Прогрев @{account_id} запущен", "active_workers": list(active_threads.keys())}).encode("utf-8"))
            return

        if parsed.path == "/api/worker/start-bulk":
            account_ids = data.get("account_ids", [])
            to_start = [a for a in account_ids if a not in active_threads]
            if to_start:
                t = threading.Thread(target=run_worker_thread, args=(to_start,), daemon=True)
                for a in to_start:
                    active_threads[a] = t
                t.start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "message": f"Запущен прогрев для {len(to_start)} аккаунтов", "active_workers": list(active_threads.keys())}).encode("utf-8"))
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

if __name__ == "__main__":
    main()
