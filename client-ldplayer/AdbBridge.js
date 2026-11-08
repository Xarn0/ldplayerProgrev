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
            throw new Error(`[ADB ${this.deviceId}] Fail: ${err.message}`);
        }
    }
    async humanTap(x, y) {
        const rx = x + Math.floor(Math.random() * 8 - 4);
        const ry = y + Math.floor(Math.random() * 8 - 4);
        await this.shell(`input tap ${rx} ${ry}`);
    }
    async humanSwipe(startY, endY, startX = 360) {
        // Человеческий свайп по дуге (кривая с легким смещением вправо/влево)
        const duration = Math.floor(Math.random() * 200 + 260);
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
            const xml = await this.shell('uiautomator dump /dev/tty');
            return xml;
        }
        catch {
            return '';
        }
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
