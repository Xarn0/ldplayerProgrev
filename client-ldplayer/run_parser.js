"use strict";
const fs = require("fs");
const path = require("path");
const { AdbBridge } = require("./AdbBridge");
const { HubClient } = require("./Telemetry");
const { AndroidWarmupWorker } = require("./AndroidWorker");

async function runParser() {
    const targetUsername = process.argv[2]; // опциональный username
    const configPath = path.resolve(__dirname, '..', 'config.json');
    if (!fs.existsSync(configPath)) {
        console.error('config.json not found!');
        process.exit(1);
    }
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const hub = new HubClient(cfg.server_hub.api_url, cfg.server_hub.api_key);
    console.log(`[ParserRunner] 🚀 Запуск автономного парсера инсайтов (цель: ${targetUsername || 'все аккаунты'})...`);

    const insightsDbPath = path.resolve(__dirname, '..', 'data', 'account_insights.json');
    let allInsights = {};
    if (fs.existsSync(insightsDbPath)) {
        try {
            allInsights = JSON.parse(fs.readFileSync(insightsDbPath, 'utf-8'));
        } catch (e) {}
    }

    for (const inst of cfg.instances) {
        const adb = new AdbBridge(inst.adb_device, cfg.ldplayer_path);
        const worker = new AndroidWarmupWorker(inst.instance_id, adb, hub, cfg.content_generation?.fallback_spintax || []);

        for (const account of inst.accounts) {
            if (targetUsername && account.username.toLowerCase() !== targetUsername.toLowerCase() && account.account_id !== targetUsername) {
                continue;
            }

            console.log(`[ParserRunner] Обработка @${account.username} на ${inst.instance_id}...`);
            const res = await worker.parseAccountInsights(account);
            if (res) {
                allInsights[account.username] = res;
                fs.writeFileSync(insightsDbPath, JSON.stringify(allInsights, null, 2), 'utf-8');
                console.log(`[ParserRunner] 💾 Сохранены инсайты для @${account.username}`);
            }
        }
    }
    console.log(`[ParserRunner] ✅ Парсинг инсайтов завершён!`);
    process.exit(0);
}

runParser().catch(err => {
    console.error('[ParserRunner] Ошибка:', err);
    process.exit(1);
});
