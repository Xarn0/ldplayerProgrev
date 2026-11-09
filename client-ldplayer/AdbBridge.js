"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdbBridge = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const path = __importStar(require("path"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class AdbBridge {
    deviceId;
    adbExe;
    constructor(deviceId, ldPlayerDir) {
        this.deviceId = deviceId;
        this.adbExe = path.join(ldPlayerDir, 'adb.exe');
    }
    async shell(cmd) {
        const command = `"${this.adbExe}" -s ${this.deviceId} shell ${cmd}`;
        try {
            const { stdout } = await execAsync(command);
            return stdout;
        }
        catch (err) {
            if (err.message && (err.message.includes('not found') || err.message.includes('offline'))) {
                try {
                    const m = this.deviceId.match(/emulator-(\d+)/);
                    if (m) {
                        const adbPort = parseInt(m[1], 10) + 1;
                        await execAsync(`"${this.adbExe}" connect 127.0.0.1:${adbPort}`);
                        const retry = await execAsync(command);
                        return retry.stdout;
                    }
                } catch {
                    // ignore reconnect failure
                }
            }
            throw new Error(`[ADB ${this.deviceId}] Fail: ${err.message}`);
        }
    }
    async humanTap(x, y) {
        const rx = x + Math.floor(Math.random() * 8 - 4);
        const ry = y + Math.floor(Math.random() * 8 - 4);
        await this.shell(`input tap ${rx} ${ry}`);
    }
    async getScreenSize() {
        if (this._screenSize) return this._screenSize;
        try {
            const out = await this.shell('wm size');
            const m = out.match(/(?:Physical|Override)\s*size:\s*(\d+)x(\d+)/i);
            if (m) {
                this._screenSize = { width: parseInt(m[1]), height: parseInt(m[2]) };
                return this._screenSize;
            }
        } catch {}
        return { width: 720, height: 1280 };
    }
    async reelsFlick(reverse = false) {
        // Полноэкранный динамический человеческий свайп Reels с дугой
        const sz = await this.getScreenSize();
        const midX = Math.floor(sz.width / 2);
        const startX = midX + Math.floor(Math.random() * 60 - 30);
        const curveOffset = Math.floor(Math.random() * 40 - 20);
        const endX = startX + curveOffset;
        const duration = Math.floor(Math.random() * 60 + 190); // 190-250ms

        if (!reverse) {
            // Листаем вперед: снизу экрана (83%) вверх (13%)
            const startY = Math.floor(sz.height * 0.83) + Math.floor(Math.random() * 40 - 20);
            const endY = Math.floor(sz.height * 0.13) + Math.floor(Math.random() * 40 - 20);
            await this.shell(`input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
        } else {
            // Листаем назад (backtrack): сверху экрана (16%) вниз (82%)
            const startY = Math.floor(sz.height * 0.16) + Math.floor(Math.random() * 40 - 20);
            const endY = Math.floor(sz.height * 0.82) + Math.floor(Math.random() * 40 - 20);
            await this.shell(`input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
        }
    }
    async feedScroll() {
        // Человеческий скролл ленты постов (полный шаг на один пост без обрезания пополам)
        const sz = await this.getScreenSize();
        const midX = Math.floor(sz.width / 2);
        const startX = midX + Math.floor(Math.random() * 70 - 35);
        const endX = startX + Math.floor(Math.random() * 40 - 20);
        const startY = Math.floor(sz.height * 0.80) + Math.floor(Math.random() * 40 - 20);
        const endY = Math.floor(sz.height * 0.16) + Math.floor(Math.random() * 40 - 20);
        const duration = Math.floor(Math.random() * 80 + 210); // 210-290ms
        await this.shell(`input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
        
        // В 25% случаев живой человек делает легкую микро-доводку
        if (Math.random() < 0.25) {
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 300 + 400)));
            const nudgeY1 = Math.floor(sz.height * 0.55) + Math.floor(Math.random() * 30);
            const nudgeY2 = nudgeY1 - Math.floor(Math.random() * 60 + 80);
            await this.shell(`input swipe ${startX} ${nudgeY1} ${endX} ${nudgeY2} 240`);
        }
    }
    async commentsScroll(reverse = false) {
        const startX = 360 + Math.floor(Math.random() * 60 - 30);
        const endX = startX + Math.floor(Math.random() * 30 - 15);
        const startY = reverse ? 450 : 880;
        const endY = reverse ? 850 : 420;
        const duration = Math.floor(Math.random() * 120 + 280);
        await this.shell(`input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
    }
    async humanSwipe(startY, endY, startX = 360) {
        const duration = Math.floor(Math.random() * 100 + 220);
        const curveOffset = Math.floor(Math.random() * 30 - 15);
        const endX = startX + curveOffset + Math.floor(Math.random() * 20 - 10);
        await this.shell(`input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`);
    }
    async sendText(text) {
        const formatted = text.replace(/ /g, '%s').replace(/"/g, '\\"');
        await this.shell(`input text "${formatted}"`);
    }
    async pressKey(keyCode) {
        await this.shell(`input keyevent ${keyCode}`);
    }
    async captureScreenBase64() {
        const command = `"${this.adbExe}" -s ${this.deviceId} exec-out screencap -p`;
        const { stdout } = await execAsync(command, { encoding: 'base64', maxBuffer: 10 * 1024 * 1024 });
        return stdout;
    }
    async getUiXml() {
        try {
            await this.shell('rm -f /data/local/tmp/dump.xml && uiautomator dump /data/local/tmp/dump.xml');
            const xml = await this.shell('cat /data/local/tmp/dump.xml');
            return xml || '';
        }
        catch {
            return '';
        }
    }
    async getCurrentInstagramUser() {
        try {
            const out = await this.shell('su 0 cat /data/data/com.instagram.android/shared_prefs/com.instagram.android_preferences.xml 2>/dev/null');
            if (out) {
                const m1 = out.match(/<string name="current">([\s\S]*?)<\/string>/);
                if (m1) {
                    const u = m1[1].match(/&quot;username&quot;:&quot;([^&"]+)&quot;/);
                    if (u) return u[1];
                }
                const mId = out.match(/<string name="current_user_id">(\d+)<\/string>/);
                if (mId) {
                    const re = new RegExp(`&quot;id&quot;:&quot;${mId[1]}&quot;[\\s\\S]*?&quot;username&quot;:&quot;([^&"]+)&quot;`);
                    const um = out.match(re);
                    if (um) return um[1];
                }
            }
        } catch {}
        return null;
    }
    async enforceUsaLocale() {
        try {
            await this.shell('settings put system system_locales en-US');
            await this.shell('settings put global system_locales en-US');
            await this.shell('su 0 setprop persist.sys.locale en-US');
            await this.shell('su 0 setprop persist.sys.language en');
            await this.shell('su 0 setprop persist.sys.country US');
        } catch {}
    }
    async checkVpnActive() {
        const res = await this.shell('ip route');
        return res.includes('tun0');
    }
    async restartApp(pkg) {
        await this.shell(`am force-stop ${pkg}`);
        await new Promise(r => setTimeout(r, 1000));
        try {
            await this.shell(`am start -n ${pkg}/.activity.MainTabActivity`);
        } catch {
            await this.shell(`am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${pkg}`);
        }
        await new Promise(r => setTimeout(r, 6000));
    }
}
exports.AdbBridge = AdbBridge;
