"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AndroidWarmupWorker = void 0;
class AndroidWarmupWorker {
    instanceId;
    adb;
    hub;
    spintax;
    constructor(instanceId, adb, hub, spintax) {
        this.instanceId = instanceId;
        this.adb = adb;
        this.hub = hub;
        this.spintax = spintax;
    }
    async runAccountSession(account) {
        const sessionId = `ses_${account.account_id}_${Date.now()}`;
        console.log(`\n==================================================`);
        console.log(`[${this.instanceId}] STARTING SESSION FOR @${account.username}`);
        console.log(`==================================================`);
        // 1. Проверка защищенного туннеля VPN (NekoBox)
        const isVpnOn = await this.adb.checkVpnActive();
        if (!isVpnOn) {
            console.error(`[${this.instanceId}] CRITICAL: NekoBox VPN (tun0) is NOT active! Terminating to protect IP.`);
            await this.hub.reportIncident({
                session_id: sessionId,
                account_id: account.account_id,
                username: account.username,
                incident_type: 'VPN_DISCONNECTED',
                details: 'tun0 interface not found. NekoBox proxy dropped.'
            });
            return;
        }
        // 2. Отправка сигнала старта на сервер
        await this.hub.startSession({
            session_id: sessionId,
            account_id: account.account_id,
            username: account.username,
            instance_id: this.instanceId,
            proxy_ip: 'nekobox_tun0'
        });
        // 3. Открываем / перезапускаем Instagram
        await this.adb.restartApp('com.instagram.android');
        // 4. Переключение на нужный аккаунт
        await this.switchToAccount(account.username);
        // 5. Проверка чекпоинтов / блокировок
        const isBlocked = await this.checkCheckpoints(sessionId, account);
        if (isBlocked)
            return;
        // 6. Цикл прогрева с приоритетом нишевых тегов и высокой отказоустойчивостью
        const durationMin = Math.floor(Math.random() * (account.session_minutes[1] - account.session_minutes[0] + 1) + account.session_minutes[0]);
        const endTime = Date.now() + durationMin * 60 * 1000;
        let likes = 0;
        let reels = 0;
        let comments = 0;
        const tags = (account.niche_tags && account.niche_tags.length) ? account.niche_tags : ['dogs', 'pets', 'puppy'];
        console.log(`[${this.instanceId}] Warming up @${account.username} under tags: [${tags.join(', ')}] for ${durationMin} minutes...`);

        // Отказоустойчивый вход в Explore и запуск первого нишевого Reels
        let inReelsChain = false;
        try {
            // Переход на Explore (Лупа)
            await this.adb.humanTap(504, 1230);
            await new Promise(r => setTimeout(r, 2500));
            // Тап по первому видео в Explore для старта нишевой цепочки Reels
            await this.adb.humanTap(200, 350);
            await new Promise(r => setTimeout(r, 3000));
            inReelsChain = true;
            console.log(`[${account.username}] Entered Reels niche chain via Explore`);
        } catch (err) {
            console.warn(`[${account.username}] Explore fallback to main Reels: ${err.message}`);
        }

        let consecutiveErrors = 0;
        while (Date.now() < endTime) {
            try {
                // ПРОВЕРКА ОТКАЗОУСТОЙЧИВОСТИ: VPN всё ещё активен?
                const vpnOk = await this.adb.checkVpnActive();
                if (!vpnOk) {
                    console.error(`[${this.instanceId}] NekoBox dropped during session! Emergency stopping.`);
                    break;
                }

                if (reels < account.daily_limits.max_reels) {
                    // Время просмотра видео: от 8 до 22 секунд (живой интерес)
                    const watchSec = Math.floor(Math.random() * 14 + 8);
                    await new Promise(r => setTimeout(r, watchSec * 1000));
                    reels++;

                    // Проверка на чекпоинты каждые 5 просмотров
                    if (reels % 5 === 0) {
                        const blocked = await this.checkCheckpoints(sessionId, account);
                        if (blocked) {
                            console.error(`[${account.username}] Terminating session due to checkpoint.`);
                            break;
                        }
                    }

                    // Вероятность лайка (25-30% от просмотренных)
                    if (Math.random() < 0.28 && likes < account.daily_limits.max_likes) {
                        // Лайк по иконке сердечка Reels (X: 685, Y: 1000)
                        await this.adb.humanTap(685, 1000);
                        likes++;
                        await this.hub.logAction({
                            session_id: sessionId,
                            account_id: account.account_id,
                            username: account.username,
                            action_type: 'like',
                            details: `Liked Reel under niche [${tags.join(', ')}]`,
                            duration_sec: watchSec
                        });
                        console.log(`[${account.username}] ❤️ Liked Reel (total likes: ${likes}/${account.daily_limits.max_likes})`);
                    } else {
                        await this.hub.logAction({
                            session_id: sessionId,
                            account_id: account.account_id,
                            username: account.username,
                            action_type: 'reels_watch',
                            details: `Watched Reel for ${watchSec}s in [${tags.join(', ')}]`,
                            duration_sec: watchSec
                        });
                        console.log(`[${account.username}] 👁️ Watched Reel #${reels} (${watchSec}s)`);
                    }

                    // ЧЕЛОВЕЧЕСКАЯ МИКРО-ИНТЕРАКЦИЯ 1: Чтение комментариев (каждые 6-9 рилсов с вероятностью 15%)
                    if (Math.random() < 0.15) {
                        const readCommSec = Math.floor(Math.random() * 5 + 4);
                        console.log(`[${account.username}] 💬 Opening comments to read discussion (${readCommSec}s)...`);
                        await this.adb.humanTap(685, 1070); // иконка комментариев под лайком
                        await new Promise(r => setTimeout(r, 1500));
                        // Листаем комментарии вниз
                        await this.adb.humanSwipe(800, 450);
                        await new Promise(r => setTimeout(r, readCommSec * 1000));
                        // Закрываем комментарии свайпом или Back
                        await this.adb.pressKey(4);
                        await new Promise(r => setTimeout(r, 1200));
                    }

                    // ЧЕЛОВЕЧЕСКАЯ МИКРО-ИНТЕРАКЦИЯ 2: Сохранение видео в закладки (Save, 5-8% случаев)
                    if (Math.random() < 0.07) {
                        console.log(`[${account.username}] 🔖 Bookmark saved (high engagement signal)`);
                        await this.adb.humanTap(685, 1220); // иконка закладки
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    // ЧЕЛОВЕЧЕСКАЯ МИКРО-ИНТЕРАКЦИЯ 3: Пересмотр назад (Backtrack, 4% случаев)
                    if (Math.random() < 0.04 && reels > 1) {
                        console.log(`[${account.username}] ↩️ Backtrack: swiped back to re-watch previous reel`);
                        await this.adb.humanSwipe(250, 950); // свайп вниз для возврата
                        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 4 + 3) * 1000));
                        // Возвращаемся вперед
                        await this.adb.humanSwipe(950, 250);
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        // Обычный человеческий свайп вперед с дугой
                        await this.adb.humanSwipe(950, 250);
                    }
                    consecutiveErrors = 0;
                } else {
                    console.log(`[${account.username}] Reached target limit of ${reels} reels!`);
                    break;
                }
            } catch (err) {
                consecutiveErrors++;
                console.error(`[${account.username}] Watchdog caught interaction error (${consecutiveErrors}/3):`, err.message);
                if (consecutiveErrors >= 3) {
                    console.warn(`[${account.username}] 3 consecutive errors. Self-healing: restarting app...`);
                    await this.adb.restartApp('com.instagram.android');
                    await this.switchToAccount(account.username);
                    await this.adb.humanTap(504, 1230);
                    await new Promise(r => setTimeout(r, 2000));
                    await this.adb.humanTap(200, 350);
                    consecutiveErrors = 0;
                } else {
                    // Мягкий recovery: нажать Back
                    await this.adb.pressKey(4);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
        // 7. Финал сессии
        await this.hub.endSession({
            session_id: sessionId,
            likes_count: likes,
            reels_watched: reels,
            comments_count: comments,
            status: 'success'
        });
        console.log(`[${this.instanceId}] Session finished cleanly for @${account.username}`);
    }
    /**
     * Быстрое переключение между аккаунтами внутри одного Instagram
     */
    async switchToAccount(targetUsername) {
        console.log(`[${this.instanceId}] Switching to @${targetUsername}...`);
        const profileX = 648;
        const profileY = 1225;
        // Долгий тап на иконку профиля внизу справа
        await this.adb.shell(`input swipe ${profileX} ${profileY} ${profileX} ${profileY} 1200`);
        await new Promise(r => setTimeout(r, 2000));
        const xml = await this.adb.getUiXml();
        if (xml.includes(targetUsername)) {
            const match = xml.match(new RegExp(`text="${targetUsername}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
            if (match) {
                const cx = Math.floor((parseInt(match[1]) + parseInt(match[3])) / 2);
                const cy = Math.floor((parseInt(match[2]) + parseInt(match[4])) / 2);
                await this.adb.humanTap(cx, cy);
                await new Promise(r => setTimeout(r, 3000));
                return;
            }
        }
        // Fallback: дабл-тап по вкладке профиля
        await this.adb.humanTap(profileX, profileY);
        await new Promise(r => setTimeout(r, 150));
        await this.adb.humanTap(profileX, profileY);
        await new Promise(r => setTimeout(r, 3000));
    }
    async checkCheckpoints(sessionId, account) {
        const xml = await this.adb.getUiXml();
        const badPatterns = ['Suspended', 'Confirm', 'Try Again Later', 'Заблокирован', 'Подтвердите'];
        for (const p of badPatterns) {
            if (xml.toLowerCase().includes(p.toLowerCase())) {
                console.error(`[${account.username}] CHECKPOINT / BLOCK DETECTED: "${p}"`);
                const b64 = await this.adb.captureScreenBase64();
                await this.hub.reportIncident({
                    session_id: sessionId,
                    account_id: account.account_id,
                    username: account.username,
                    incident_type: 'ANDROID_CHECKPOINT',
                    details: `Trigger: ${p}`,
                    screenshot_base64: b64
                });
                return true;
            }
        }
        return false;
    }
}
exports.AndroidWarmupWorker = AndroidWarmupWorker;
