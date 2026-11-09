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
active_procs = {}
active_running_workers = set()
queued_workers = set()

def run_cmd(cmd_list):
    try:
        res = subprocess.run(cmd_list, capture_output=True, text=True, timeout=15, encoding="utf-8", errors="ignore")
        return res.stdout.strip()
    except Exception:
        return ""

def ensure_adb_connected(device_id):
    if not device_id or not device_id.startswith("emulator-"):
        return
    try:
        port = int(device_id.split("-")[1])
        adb_port = port + 1
        run_cmd([str(ADB_EXE), "connect", f"127.0.0.1:{adb_port}"])
    except Exception:
        pass

def get_adb_devices():
    # Пробуем автоматически подключить порты эмуляторов из конфига
    try:
        cfg = load_config()
        for a in cfg.get("accounts", []):
            d = a.get("device_id")
            if d and d.startswith("emulator-"):
                try:
                    p = int(d.split("-")[1])
                    run_cmd([str(ADB_EXE), "connect", f"127.0.0.1:{p + 1}"])
                except Exception:
                    pass
    except Exception:
        pass

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
    return None

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
            "api_url": f"http://127.0.0.1:{PORT}",
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

account_progress = {}

def update_account_progress(username, reels=None, max_reels=None, likes=None, max_likes=None, proxy_ip=None, status=None):
    if not username:
        return
    if username not in account_progress:
        account_progress[username] = {
            "reels": 0, "max_reels": 30,
            "likes": 0, "max_likes": 15,
            "proxy_ip": "",
            "status": "idle",
            "updated_at": time.time()
        }
    p = account_progress[username]
    if reels is not None:
        try: p["reels"] = int(reels)
        except Exception: pass
    if max_reels is not None:
        try: p["max_reels"] = int(max_reels)
        except Exception: pass
    if likes is not None:
        try: p["likes"] = int(likes)
        except Exception: pass
    if max_likes is not None:
        try: p["max_likes"] = int(max_likes)
        except Exception: pass
    if proxy_ip: p["proxy_ip"] = proxy_ip
    if status: p["status"] = status
    p["updated_at"] = time.time()

def ensure_emulator_running(device_id):
    ensure_adb_connected(device_id)
    adb_devs = get_adb_devices()
    is_running = device_id in adb_devs

    idx = None
    if device_id.startswith("emulator-"):
        try:
            port = int(device_id.split("-")[1])
            idx = (port - 5554) // 2
        except Exception:
            pass

    if idx is None:
        add_log(f"[AutoLaunch] Не удалось вычислить индекс LDPlayer для {device_id}")
        return False

    if not is_running:
        add_log(f"[AutoLaunch] Эмулятор {device_id} (LDPlayer #{idx}) не подключен к ADB. Запуск/подключение окна...")
        try:
            subprocess.Popen([str(LDCONSOLE_EXE), "launch", "--index", str(idx)], cwd=str(LD_DIR))
        except Exception as e:
            add_log(f"[AutoLaunch] Ошибка запуска LDPlayer #{idx}: {e}")
            return False

        booted = False
        for attempt in range(30):
            time.sleep(2)
            ensure_adb_connected(device_id)
            devs = get_adb_devices()
            if device_id in devs:
                boot = run_cmd([str(ADB_EXE), "-s", device_id, "shell", "getprop", "sys.boot_completed"])
                if boot == "1":
                    booted = True
                    break
        if not booted:
            add_log(f"[AutoLaunch] Предупреждение: тайм-аут ожидания загрузки {device_id}")
            return False
        add_log(f"[AutoLaunch] Эмулятор {device_id} (LDPlayer #{idx}) загружен!")

    # Проверка NekoBox VPN (туннель tun0)
    add_log(f"[NekoBox] Проверка туннеля VPN (tun0) на {device_id}...")
    for _ in range(12):
        routes = run_cmd([str(ADB_EXE), "-s", device_id, "shell", "ip", "route"])
        if "tun0" in routes:
            ip_info = run_cmd([str(ADB_EXE), "-s", device_id, "shell", "curl -s --max-time 4 https://api.ipify.org"])
            ip_str = ip_info.strip() if (ip_info and "<" not in ip_info and len(ip_info.strip()) < 40) else "tun0 активен"
            add_log(f"[NekoBox] 🛡️ VPN туннель подтверждён на {device_id}! Внешний IP: {ip_str}")
            return True
        time.sleep(2)

    add_log(f"[NekoBox] tun0 пока не активен. Запуск NekoBox на {device_id}...")
    run_cmd([str(ADB_EXE), "-s", device_id, "shell", "am start -n moe.nb4a/moe.nb4a.ui.MainActivity"])
    for _ in range(8):
        time.sleep(2)
        routes = run_cmd([str(ADB_EXE), "-s", device_id, "shell", "ip", "route"])
        if "tun0" in routes:
            add_log(f"[NekoBox] 🛡️ VPN туннель успешно активирован на {device_id}!")
            return True

    add_log(f"[NekoBox] ⚠️ Предупреждение: VPN туннель не найден на {device_id}. Проверьте NekoBox.")
    return True

def run_worker_thread(account_ids):
    cfg = load_config()
    target_accs = [a for a in cfg.get("accounts", []) if a.get("account_id") in account_ids or a.get("username") in account_ids]
    if not target_accs:
        target_accs = [{"account_id": aid, "username": aid, "device_id": "emulator-5554"} for aid in account_ids]

    # Группировка по устройствам: первый аккаунт запускается сразу, остальные ставятся в очередь
    dev_groups = {}
    for acc in target_accs:
        dev = acc.get("device_id") or "emulator-5554"
        aid = acc.get("account_id") or acc.get("username")
        if dev not in dev_groups:
            dev_groups[dev] = []
        dev_groups[dev].append(aid)

    for dev, acc_list in dev_groups.items():
        if acc_list:
            first_user = acc_list[0]
            active_running_workers.add(first_user)
            queued_workers.discard(first_user)
            update_account_progress(first_user, status="running")
            for q_user in acc_list[1:]:
                queued_workers.add(q_user)
                active_running_workers.discard(q_user)
                update_account_progress(q_user, status="queued")

    # Автозапуск нужных эмуляторов, если они были закрыты
    needed_devices = {acc.get("device_id") for acc in target_accs if acc.get("device_id")}
    for dev in needed_devices:
        ensure_emulator_running(dev)

    sync_client_runner_config(target_accs)
    runner_script = BASE_DIR.parent / "client-ldplayer" / "dist" / "index.js"
    add_log(f"Старт воркера прогрева для аккаунтов: {', '.join(account_ids)}")
    proc = None
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
        for aid in account_ids:
            active_procs[aid] = proc

        for line in proc.stdout:
            cleaned = line.strip()
            if cleaned:
                add_log(cleaned)

                # Сигналы смены аккаунта в очереди на устройстве
                m_active = re.search(r'>>> ACTIVE_ACCOUNT:\s+@([^\s]+)', cleaned)
                if m_active:
                    cur_u = m_active.group(1)
                    active_running_workers.add(cur_u)
                    queued_workers.discard(cur_u)
                    update_account_progress(cur_u, status="running")

                m_queued = re.search(r'>>> QUEUED_ACCOUNT:\s+@([^\s]+)', cleaned)
                if m_queued:
                    q_u = m_queued.group(1)
                    queued_workers.add(q_u)
                    active_running_workers.discard(q_u)
                    update_account_progress(q_u, status="queued")

                m_fin = re.search(r'>>> FINISHED_ACCOUNT:\s+@([^\s]+)', cleaned)
                if m_fin:
                    fin_u = m_fin.group(1)
                    active_running_workers.discard(fin_u)
                    update_account_progress(fin_u, status="done")

                # Парсинг прогресса в реальном времени из лога воркера
                m_reels = re.search(r'\[([^\]]+)\]\s+👁️\s+Просмотр(?:\s+\[[^\]]+\])?\s+(?:Reels:\s+\[|#)?(\d+)/(\d+)', cleaned)
                if m_reels:
                    u, r, mr = m_reels.group(1), m_reels.group(2), m_reels.group(3)
                    update_account_progress(u, reels=r, max_reels=mr, status="running")

                m_likes = re.search(r'\[([^\]]+)\]\s+❤️\s+Поставлен лайк:\s+\[?(\d+)/(\d+)\]?(?:\s+\(Reels:\s+(\d+)/(\d+)\))?', cleaned)
                if m_likes:
                    u, l, ml = m_likes.group(1), m_likes.group(2), m_likes.group(3)
                    r = m_likes.group(4) if len(m_likes.groups()) >= 4 else None
                    mr = m_likes.group(5) if len(m_likes.groups()) >= 5 else None
                    update_account_progress(u, reels=r, max_reels=mr, likes=l, max_likes=ml, status="running")

                m_ip = re.search(r'Внешний IP(?:\s+прокси)?:\s+([^\s]+)', cleaned)
                if m_ip:
                    ip = m_ip.group(1)
                    for aid in account_ids:
                        update_account_progress(aid, proxy_ip=ip)

                m_done = re.search(r'\[([^\]]+)\]\s+✅\s+Прогрев завершён:\s+(\d+)/(\d+)\s+Reels,\s+(\d+)/(\d+)\s+лайков', cleaned)
                if m_done:
                    u, r, mr, l, ml = m_done.groups()
                    update_account_progress(u, reels=r, max_reels=mr, likes=l, max_likes=ml, status="done")
        proc.wait()
    except Exception as e:
        add_log(f"Ошибка воркера: {e}")
    finally:
        for aid in account_ids:
            active_running_workers.discard(aid)
            queued_workers.discard(aid)
            if active_procs.get(aid) is proc:
                active_procs.pop(aid, None)
                active_threads.pop(aid, None)
            elif aid not in active_procs:
                active_threads.pop(aid, None)
        add_log("Сессия прогрева завершена.")


def kill_proc_tree(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       capture_output=True, timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def stop_accounts(account_ids):
    """Kill node runner processes for the given accounts. Returns list of stopped account ids."""
    stopped = set()
    procs = []
    for aid in account_ids:
        p = active_procs.get(aid)
        if p is not None and p not in procs:
            procs.append(p)
    for p in procs:
        kill_proc_tree(p)
        # all accounts sharing this runner process are stopped too
        for aid, pp in list(active_procs.items()):
            if pp is p:
                stopped.add(aid)
                active_procs.pop(aid, None)
                active_threads.pop(aid, None)
                active_running_workers.discard(aid)
                queued_workers.discard(aid)
                update_account_progress(aid, status="stopped")
    for aid in account_ids:
        active_running_workers.discard(aid)
        queued_workers.discard(aid)
        if aid in active_threads:
            active_threads.pop(aid, None)
            stopped.add(aid)
            update_account_progress(aid, status="stopped")
        if aid in active_procs:
            active_procs.pop(aid, None)
    return sorted(stopped)

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
                "active_workers": list(active_running_workers),
                "queued_workers": list(queued_workers),
                "progress": account_progress,
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

        if parsed.path == "/api/warmup/log":
            u = data.get("username") or data.get("account_id")
            if u:
                update_account_progress(
                    u,
                    reels=data.get("reels_watched"),
                    max_reels=data.get("max_reels"),
                    likes=data.get("likes_given"),
                    max_likes=data.get("max_likes"),
                    proxy_ip=data.get("proxy_ip"),
                    status="running"
                )
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
            return

        if parsed.path in ["/api/warmup/session/start", "/api/warmup/session/end", "/api/warmup/incident"]:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
            return

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

            cfg = load_config()
            acc_obj = next((a for a in cfg.get("accounts", []) if a.get("account_id") == account_id or a.get("username") == account_id), None)
            dev_id = acc_obj.get("device_id") if acc_obj else None

            # Проверяем, запущен ли уже воркер на этом же эмуляторе
            device_running_user = None
            if dev_id:
                for aid in list(active_running_workers):
                    other_acc = next((a for a in cfg.get("accounts", []) if a.get("account_id") == aid or a.get("username") == aid), None)
                    if other_acc and other_acc.get("device_id") == dev_id and aid != account_id:
                        device_running_user = aid
                        break

            if device_running_user:
                # На этом устройстве уже работает другой аккаунт -> ставим в очередь!
                queued_workers.add(account_id)
                active_running_workers.discard(account_id)
                update_account_progress(account_id, reels=0, likes=0, status="queued")
                add_log(f"[Очередь] @{account_id} добавлен в очередь на устройстве {dev_id} (сейчас работает @{device_running_user})")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "ok": True,
                    "message": f"@{account_id} в очереди на устройстве (ожидает @{device_running_user})",
                    "status": "queued",
                    "active_workers": list(active_running_workers),
                    "queued_workers": list(queued_workers)
                }).encode("utf-8"))
                return

            if account_id in active_threads and active_threads[account_id].is_alive():
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "message": "Воркер уже работает"}).encode("utf-8"))
                return

            active_running_workers.add(account_id)
            queued_workers.discard(account_id)
            update_account_progress(account_id, reels=0, likes=0, status="running")

            t = threading.Thread(target=run_worker_thread, args=([account_id],), daemon=True)
            active_threads[account_id] = t
            t.start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "message": f"Прогрев @{account_id} запущен",
                "active_workers": list(active_running_workers),
                "queued_workers": list(queued_workers)
            }).encode("utf-8"))
            return

        if parsed.path == "/api/worker/start-bulk":
            account_ids = data.get("account_ids", [])
            cfg = load_config()

            # Группируем по устройствам
            dev_groups = {}
            for aid in account_ids:
                acc_obj = next((a for a in cfg.get("accounts", []) if a.get("account_id") == aid or a.get("username") == aid), None)
                dev = (acc_obj.get("device_id") if acc_obj else None) or "emulator-5554"
                if dev not in dev_groups:
                    dev_groups[dev] = []
                dev_groups[dev].append(aid)

            # Мгновенно обновляем статусы очереди для отображения в UI
            for dev, a_list in dev_groups.items():
                if a_list:
                    first_u = a_list[0]
                    active_running_workers.add(first_u)
                    queued_workers.discard(first_u)
                    update_account_progress(first_u, reels=0, likes=0, status="running")
                    for q_u in a_list[1:]:
                        queued_workers.add(q_u)
                        active_running_workers.discard(q_u)
                        update_account_progress(q_u, reels=0, likes=0, status="queued")
                        add_log(f"[Очередь] @{q_u} поставлен в очередь на {dev} (после @{first_u})")

            to_start = [a for a in account_ids if a not in active_threads or not active_threads[a].is_alive()]
            if to_start:
                t = threading.Thread(target=run_worker_thread, args=(to_start,), daemon=True)
                for a in to_start:
                    active_threads[a] = t
                t.start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "message": f"Запущен прогрев для {len(to_start)} аккаунтов (распределено по очередям устройств)",
                "active_workers": list(active_running_workers),
                "queued_workers": list(queued_workers)
            }).encode("utf-8"))
            return

        if parsed.path == "/api/worker/stop":
            account_id = data.get("account_id")
            if account_id == "all" or data.get("all"):
                targets = list(set(active_threads.keys()) | set(active_procs.keys()))
            else:
                targets = [account_id] if account_id else []
            stopped = stop_accounts(targets)
            if stopped:
                add_log(f"[STOP] Прогрев остановлен пользователем: {', '.join(stopped)}")
                msg = f"Остановлено: {', '.join('@' + s for s in stopped)}"
            else:
                msg = "Нет активных воркеров для остановки"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "message": msg, "stopped": stopped, "active_workers": list(active_threads.keys())}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

def main():
    os.chdir(str(BASE_DIR))
    try:
        server = ReusableTCPServer(("0.0.0.0", PORT), WarmupHandler)
    except OSError as e:
        if getattr(e, "winerror", None) == 10048 or "10048" in str(e):
            print("=======================================================")
            print(f"[OK] Сервер прогрева уже запущен и работает на порту {PORT}!")
            print(f"Панель управления доступна по адресу: http://localhost:{PORT}")
            print("=======================================================")
            return
        raise e

    print("=======================================================")
    print("LDPLAYER WARMUP ENGINE RUNNING ON:")
    print("Local PC GUI:      http://localhost:" + str(PORT))
    print("Inside LDPlayer:   http://10.0.2.2:" + str(PORT))
    print("Central Cloud Hub: " + str(CENTRAL_HUB))
    print("=======================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[OK] Сервер остановлен пользователем.")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
