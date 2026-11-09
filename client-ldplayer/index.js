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

    const runnerPromises = [];

    for (const inst of cfg.instances) {
        const adb = new AdbBridge_1.AdbBridge(inst.adb_device, cfg.ldplayer_path);
        const worker = new AndroidWorker_1.AndroidWarmupWorker(inst.instance_id, adb, hub, cfg.content_generation.fallback_spintax);

        const p = (async () => {
            for (let aIdx = 0; aIdx < inst.accounts.length; aIdx++) {
                const account = inst.accounts[aIdx];
                console.log(`[${inst.instance_id}] >>> ACTIVE_ACCOUNT: @${account.username}`);
                for (let q = aIdx + 1; q < inst.accounts.length; q++) {
                    console.log(`[${inst.instance_id}] >>> QUEUED_ACCOUNT: @${inst.accounts[q].username}`);
                }

                let retries = 0;
                let sessionSuccess = false;
                while (retries < 2 && !sessionSuccess) {
                    try {
                        const success = await worker.runAccountSession(account);
                        if (success) {
                            sessionSuccess = true;
                            console.log(`[${inst.instance_id}] >>> FINISHED_ACCOUNT: @${account.username}`);
                        } else {
                            retries++;
                            if (retries < 2) {
                                console.log(`[${inst.instance_id}] Сессия @${account.username} не удалась. Повторная попытка (2/2) через 15 сек...`);
                                await new Promise(r => setTimeout(r, 15000));
                            } else {
                                console.warn(`[${inst.instance_id}] ⚠️ Не удалось запустить сессию @${account.username} после 2 попыток. Завершаем для перехода к очереди.`);
                                console.log(`[${inst.instance_id}] >>> FINISHED_ACCOUNT: @${account.username}`);
                            }
                        }
                    } catch (err) {
                        retries++;
                        console.error(`[${inst.instance_id}] Ошибка сессии @${account.username}:`, err.message);
                        if (retries < 2) {
                            await new Promise(r => setTimeout(r, 10000));
                        } else {
                            console.log(`[${inst.instance_id}] >>> FINISHED_ACCOUNT: @${account.username}`);
                        }
                    }
                }

                if (aIdx < inst.accounts.length - 1) {
                    const pauseMin = Math.floor(Math.random() * 2 + 2); // 2-3 мин пауза между аккаунтами на одном эмуляторе
                    console.log(`[${inst.instance_id}] ⏳ Пауза ${pauseMin} мин перед запуском следующего аккаунта из очереди (@${inst.accounts[aIdx + 1].username})...`);
                    await new Promise(r => setTimeout(r, pauseMin * 60 * 1000));
                }
            }
            console.log(`[${inst.instance_id}] Все аккаунты на эмуляторе ${inst.adb_device} полностью завершили прогрев!`);
        })();
        runnerPromises.push(p);
    }

    await Promise.all(runnerPromises);
    console.log(`[MasterRunner] Все эмуляторы завершили свои сессии прогрева.`);
}

main().catch(console.error);
