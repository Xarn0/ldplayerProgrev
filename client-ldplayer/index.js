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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const AdbBridge_1 = require("./AdbBridge");
const Telemetry_1 = require("./Telemetry");
const AndroidWorker_1 = require("./AndroidWorker");
async function main() {
    const configPath = path.resolve(__dirname, '..', 'config.json');
    if (!fs.existsSync(configPath)) {
        console.error('config.json not found!');
        process.exit(1);
    }
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const hub = new Telemetry_1.HubClient(cfg.server_hub.api_url, cfg.server_hub.api_key);
    console.log(`[MasterRunner] Initializing ${cfg.instances.length} LDPlayer instances...`);
    // Запуск воркеров по каждому инстансу
    for (const inst of cfg.instances) {
        const adb = new AdbBridge_1.AdbBridge(inst.adb_device, cfg.ldplayer_path);
        const worker = new AndroidWorker_1.AndroidWarmupWorker(inst.instance_id, adb, hub, cfg.content_generation.fallback_spintax);
        // В каждом эмуляторе по очереди запускаем оба аккаунта
        (async () => {
            while (true) {
                for (const account of inst.accounts) {
                    try {
                        await worker.runAccountSession(account);
                        // Пауза между аккаунтами внутри одного эмулятора (3-8 минут)
                        const pauseMin = Math.floor(Math.random() * 5 + 3);
                        console.log(`[${inst.instance_id}] Waiting ${pauseMin} min before switching account...`);
                        await new Promise(r => setTimeout(r, pauseMin * 60 * 1000));
                    }
                    catch (err) {
                        console.error(`[${inst.instance_id}] Error in session:`, err);
                        await new Promise(r => setTimeout(r, 30000));
                    }
                }
                // Пауза перед следующим общим циклом (3-4 часа)
                console.log(`[${inst.instance_id}] Full cycle finished. Resting for 3 hours...`);
                await new Promise(r => setTimeout(r, 3 * 60 * 60 * 1000));
            }
        })();
    }
}
main().catch(console.error);
