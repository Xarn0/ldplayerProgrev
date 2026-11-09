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
    /**
     * Надёжный клик по вкладке навигации (адаптивен к смартфону и планшету)
     */
    async clickTab(tabId) {
        try {
            const xml = await this.adb.getUiXml();
            if (xml) {
                const m = xml.match(new RegExp(`resource-id="[^"]*${tabId}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i'));
                if (m) {
                    const cx = Math.floor((parseInt(m[1]) + parseInt(m[3])) / 2);
                    const cy = Math.floor((parseInt(m[2]) + parseInt(m[4])) / 2);
                    await this.adb.humanTap(cx, cy);
                    return true;
                }
            }
        } catch {}

        // Fallback по размеру экрана
        const sz = await this.adb.getScreenSize();
        const isTablet = sz.width > sz.height;
        let tx, ty;
        if (tabId === 'feed_tab') {
            tx = isTablet ? 48 : Math.floor(sz.width * 0.10);
            ty = isTablet ? Math.floor(sz.height * 0.20) : Math.floor(sz.height * 0.965);
        } else if (tabId === 'clips_tab') {
            tx = isTablet ? 48 : Math.floor(sz.width * 0.30);
            ty = isTablet ? Math.floor(sz.height * 0.42) : Math.floor(sz.height * 0.965);
        } else if (tabId === 'search_tab') {
            tx = isTablet ? 48 : Math.floor(sz.width * 0.70);
            ty = isTablet ? Math.floor(sz.height * 0.31) : Math.floor(sz.height * 0.965);
        } else if (tabId === 'profile_tab') {
            tx = isTablet ? 48 : Math.floor(sz.width * 0.90);
            ty = isTablet ? Math.floor(sz.height * 0.84) : Math.floor(sz.height * 0.965);
        }
        await this.adb.humanTap(tx, ty);
        return true;
    }

    /**
     * Сторож безопасного контента и USA ГЕО:
     * 1. Не даёт боту залипать в профиле, хайлайтах или меню создания.
     * 2. Немедленно выходит из чужих профилей (закрытых, пустых, кнопок Follow/Подписаться).
     * 3. Защита USA ГЕО: немедленно выходит, если на экране обнаружен неанглийский язык (русский, хинди, арабский).
     */
    async ensureSafeContentScreen(preferredMode = 'REELS') {
        try {
            const xml = await this.adb.getUiXml();
            if (!xml) return true;

            // 1. Проверка чужих / закрытых профилей (как kshetrapal singh и др.)
            const isOtherProfile = 
                xml.includes('Это закрытый аккаунт') ||
                xml.includes('This Account is Private') ||
                xml.includes('This account is private') ||
                xml.includes('Рекомендации для вас') ||
                xml.includes('Suggested for you') ||
                xml.includes('action_bar_button_back') ||
                (xml.includes('Follow') && (xml.includes('posts') || xml.includes('followers'))) ||
                (xml.includes('Подписаться') && (xml.includes('публикации') || xml.includes('подписчики')));

            // 2. Проверка неанглийского языка (русский, деванагари/хинди, арабский, китайский) для строгого USA ГЕО
            const nonEnglishMatch = xml.match(/[а-яА-ЯёЁ\u0900-\u097F\u0600-\u06FF\u4E00-\u9FFF]{2,}/);
            const hasNonEnglish = !!nonEnglishMatch;

            // 3. Запретные экраны настроек, создания, хайлайтов, редактирования
            const forbiddenPatterns = [
                'Add to highlight',
                'Добавить в актуальное',
                'Создать подборку',
                'Highlights',
                'Instants',
                'Create New',
                'Create',
                'Создание',
                'Edit profile',
                'Редактировать профиль',
                'Share profile',
                'Поделиться профилем',
                'Followers',
                'Подписчики',
                'Following',
                'Подписки',
                'Settings and privacy',
                'Настройки и конфиденциальность',
                'Archive',
                'Архив',
                'profile_header_create_button',
                'action_bar_title_chevron',
                'Professional dashboard',
                'Профессиональная панель'
            ];

            let isForbidden = false;
            let triggerWord = '';
            for (const p of forbiddenPatterns) {
                if (xml.includes(p)) {
                    isForbidden = true;
                    triggerWord = p;
                    break;
                }
            }

            // 4. Проверка: активна ли вкладка своего профиля
            const onProfileTab = /resource-id="[^"]*profile_tab"[^>]*selected="true"/i.test(xml);

            if (isOtherProfile || hasNonEnglish || isForbidden || onProfileTab) {
                let reason = 'страница профиля';
                if (isOtherProfile) reason = 'чужой/закрытый профиль';
                else if (hasNonEnglish) reason = `неанглийский язык ("${nonEnglishMatch[0]}") — защита USA ГЕО`;
                else if (isForbidden) reason = triggerWord;

                console.warn(`[${this.instanceId}] 🛡️ Маршрутизатор: обнаружен выход за пределы USA контента (${reason}). Немедленный возврат в безопасную зону!`);
                await this.adb.pressKey(4);
                await new Promise(r => setTimeout(r, 400));
                await this.adb.pressKey(4);
                await new Promise(r => setTimeout(r, 600));

                if (isOtherProfile || hasNonEnglish) {
                    // Обязательно свайпаем дальше, чтобы не застрять на не-USA контенте
                    if (preferredMode === 'FEED') {
                        await this.clickTab('feed_tab');
                        await new Promise(r => setTimeout(r, 1000));
                        await this.adb.feedScroll();
                    } else {
                        await this.clickTab('clips_tab');
                        await new Promise(r => setTimeout(r, 1000));
                        await this.adb.reelsFlick(false);
                    }
                } else {
                    if (preferredMode === 'FEED') {
                        await this.clickTab('feed_tab');
                    } else {
                        await this.clickTab('clips_tab');
                    }
                }
                await new Promise(r => setTimeout(r, 1500));
                return false;
            }
            return true;
        } catch {}
        return true;
    }

    async switchMode(mode, tags, username) {
        console.log(`[${username}] 🧭 Переключение режима на: [${mode}]`);
        try {
            if (mode === 'REELS') {
                await this.clickTab('clips_tab');
                await new Promise(r => setTimeout(r, 2200));
            } else if (mode === 'FEED') {
                await this.clickTab('feed_tab');
                await new Promise(r => setTimeout(r, 2200));
            } else if (mode === 'SEARCH_TAGS') {
                await this.clickTab('search_tab');
                await new Promise(r => setTimeout(r, 2000));

                const rawTag = tags[Math.floor(Math.random() * tags.length)];
                const searchTag = rawTag.startsWith('#') ? rawTag : `#${rawTag.replace(/\s+/g, '')}`;
                console.log(`[${username}] 🔍 USA Geo Поиск по хештегу: "${searchTag}"`);
                const sz = await this.adb.getScreenSize();
                await this.adb.humanTap(Math.floor(sz.width / 2), Math.floor(sz.height * 0.08));
                await new Promise(r => setTimeout(r, 1500));
                await this.adb.sendText(searchTag);
                await new Promise(r => setTimeout(r, 1000));
                await this.adb.pressKey(66); // Enter
                await new Promise(r => setTimeout(r, 3000));
                // Тапаем в медиа-сетку результатов (центр экрана), исключая клик по строке аккаунтов
                await this.adb.humanTap(Math.floor(sz.width * 0.50), Math.floor(sz.height * 0.45));
                await new Promise(r => setTimeout(r, 2500));
                await this.ensureSafeContentScreen('REELS');
            }
        } catch (err) {
            console.warn(`[${username}] Не удалось гладко переключить режим: ${err.message}`);
        }
    }

    async runAccountSession(account) {
        const sessionId = `ses_${account.account_id}_${Date.now()}`;
        console.log(`\n==================================================`);
        console.log(`[${this.instanceId}] STARTING SESSION FOR @${account.username}`);
        console.log(`==================================================`);
        // 1. Проверка защищенного туннеля VPN (NekoBox) с автоматическим ожиданием
        let isVpnOn = await this.adb.checkVpnActive();
        if (!isVpnOn) {
            console.log(`[${this.instanceId}] ⏳ Ожидание подключения NekoBox VPN (tun0)...`);
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 2000));
                if (await this.adb.checkVpnActive()) {
                    isVpnOn = true;
                    break;
                }
            }
        }
        if (!isVpnOn) {
            console.error(`[${this.instanceId}] ❌ КРИТИЧНО: NekoBox VPN (tun0) НЕ активен! Остановка сессии для защиты IP.`);
            await this.hub.reportIncident({
                session_id: sessionId,
                account_id: account.account_id,
                username: account.username,
                incident_type: 'VPN_DISCONNECTED',
                details: 'tun0 interface not found. NekoBox proxy dropped.'
            });
            return false;
        }

        // Проверка внешнего IP прокси для прозрачности
        let proxyIp = 'tun0';
        try {
            const probe = await this.adb.shell('curl -s --max-time 4 https://api.ipify.org');
            if (probe && !probe.includes('<') && probe.trim().length > 6 && probe.trim().length < 50) {
                proxyIp = probe.trim();
            }
        } catch {}
        console.log(`[${this.instanceId}] 🛡️ NekoBox VPN активен! Внешний IP прокси: ${proxyIp}`);

        // 2. Отправка сигнала старта на сервер
        await this.hub.startSession({
            session_id: sessionId,
            account_id: account.account_id,
            username: account.username,
            instance_id: this.instanceId,
            proxy_ip: proxyIp
        });
        // 3. Принудительно устанавливаем USA локаль на эмуляторе и перезапускаем Instagram
        await this.adb.enforceUsaLocale();
        await this.adb.restartApp('com.instagram.android');
        // 4. Переключение на нужный аккаунт
        const switchOk = await this.switchToAccount(account.username);
        if (!switchOk) {
            console.error(`[${this.instanceId}] ❌ ОШИБКА: Не удалось активировать @${account.username}! Прерываем сессию во избежание работы на чужом профиле.`);
            return false;
        }
        // 5. Проверка чекпоинтов / блокировок
        const isBlocked = await this.checkCheckpoints(sessionId, account);
        if (isBlocked)
            return false;

        // 6. Человеческий динамический прогрев (до достижения установленного лимита max_reels)
        let likes = 0;
        let reels = 0;
        let comments = 0;
        const targetReels = account.daily_limits.max_reels || 30;
        // Нишевые ключевые слова под USA ГЕО (собачья тематика)
        const usaDefaultTags = [
            'dogs of usa', 'puppy love usa', 'dog mom life', 'golden retriever puppies',
            'american dog rescue', 'dog dad daily', 'french bulldog usa', 'pet care tips usa',
            'cute puppies daily', 'funny dog videos usa'
        ];
        const tags = (account.niche_tags && account.niche_tags.length) ? account.niche_tags : usaDefaultTags;
        console.log(`[${this.instanceId}] Warming up @${account.username} to target limit: ${targetReels} Reels...`);

        const availableModes = ['REELS', 'FEED', 'SEARCH_TAGS'];
        let currentMode = availableModes[Math.floor(Math.random() * availableModes.length)];
        let modeActionsLeft = Math.floor(Math.random() * 11 + 5); // 5-15 действий в режиме
        console.log(`[${account.username}] 🎲 Стартовый режим: [${currentMode}] (на ${modeActionsLeft} действий)...`);
        await this.switchMode(currentMode, tags, account.username);

        let consecutiveErrors = 0;
        const maxSessionTimeout = Date.now() + 3 * 3600 * 1000; // 3 часа макс. предохранитель

        while (reels < targetReels && Date.now() < maxSessionTimeout) {
            try {
                // Проверка туннеля NekoBox VPN
                const vpnOk = await this.adb.checkVpnActive();
                if (!vpnOk) {
                    console.error(`[${this.instanceId}] NekoBox dropped during session! Emergency stopping.`);
                    break;
                }

                // ЖЕСТКИЙ КОНТРОЛЬ МАРШРУТА И USA ГЕО:
                const isSafe = await this.ensureSafeContentScreen(currentMode);
                if (!isSafe) {
                    console.log(`[${account.username}] ⏭️ Пропуск действия после выхода из чужого/не-USA профиля. Возврат в поток...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                // Проверка на чекпоинты каждые 5 действий
                if (reels > 0 && reels % 5 === 0) {
                    const blocked = await this.checkCheckpoints(sessionId, account);
                    if (blocked) {
                        console.error(`[${account.username}] Terminating session due to checkpoint.`);
                        break;
                    }
                }

                reels++;
                modeActionsLeft--;

                // 1. Рандомное время просмотра (разная степень человеческого интереса)
                let watchSec;
                const randInterest = Math.random();
                if (randInterest < 0.20) {
                    // Быстрый скип: 3-6 сек
                    watchSec = Math.floor(Math.random() * 4 + 3);
                } else if (randInterest < 0.75) {
                    // Обычный интерес: 8-18 сек
                    watchSec = Math.floor(Math.random() * 11 + 8);
                } else {
                    // Глубокий интерес: 20-35 сек
                    watchSec = Math.floor(Math.random() * 16 + 20);
                }

                console.log(`[${account.username}] 👁️ Просмотр [${currentMode}] #${reels}/${account.daily_limits.max_reels} (${watchSec}s)...`);
                await new Promise(r => setTimeout(r, watchSec * 1000));

                let didLike = false;
                let didRewatch = false;

                // 2. Рандомные лайки (вероятность 28%, только если видео зацепило >=8s)
                if (watchSec >= 8 && Math.random() < 0.28 && likes < account.daily_limits.max_likes) {
                    const sz = await this.adb.getScreenSize();
                    const isTablet = sz.width > sz.height;

                    if (currentMode === 'FEED') {
                        // В ленте лайкаем естественным двойным тапом в центр
                        const tapX = Math.floor(sz.width / 2);
                        const tapY = Math.floor(sz.height * 0.48);
                        await this.adb.humanTap(tapX, tapY);
                        await new Promise(r => setTimeout(r, 120));
                        await this.adb.humanTap(tapX, tapY);
                    } else {
                        // В Reels тап по сердечку
                        const likeX = isTablet ? 1520 : Math.floor(sz.width * 0.94);
                        const likeY = isTablet ? 560 : Math.floor(sz.height * 0.78);
                        await this.adb.humanTap(likeX, likeY);
                    }
                    likes++;
                    didLike = true;

                    await this.hub.logAction({
                        session_id: sessionId,
                        account_id: account.account_id,
                        username: account.username,
                        action_type: 'like',
                        reels_watched: reels,
                        max_reels: account.daily_limits.max_reels,
                        likes_given: likes,
                        max_likes: account.daily_limits.max_likes,
                        proxy_ip: proxyIp,
                        details: `Liked in [${currentMode}] under USA niche [${tags.join(', ')}]`,
                        duration_sec: watchSec
                    });
                    console.log(`[${account.username}] ❤️ Поставлен лайк: [${likes}/${account.daily_limits.max_likes}] (Reels: ${reels}/${account.daily_limits.max_reels})`);

                    // ОБЯЗАТЕЛЬНЫЙ ДОСМОТР ВИДЕО ДО КОНЦА ПОСЛЕ ЛАЙКА
                    const finishWatchSec = Math.floor(Math.random() * 9 + 12); // 12-20 сек
                    console.log(`[${account.username}] ⏳ Обязательный досмотр видео до конца после лайка (+${finishWatchSec}s)...`);
                    await new Promise(r => setTimeout(r, finishWatchSec * 1000));

                    // ПЕРЕСМОТР ОТ 1 ДО 3 РАЗ (35% вероятность)
                    if (Math.random() < 0.35) {
                        const rewatchLoops = Math.floor(Math.random() * 3 + 1); // 1, 2 или 3 раза
                        console.log(`[${account.username}] 🔁 Видео вызвало высокий интерес! Зацикленный пересмотр (${rewatchLoops} раз)...`);
                        for (let loop = 1; loop <= rewatchLoops; loop++) {
                            const loopDuration = Math.floor(Math.random() * 9 + 10); // 10-18 сек
                            console.log(`[${account.username}] 🔁 Пересмотр: повтор ${loop}/${rewatchLoops} (+${loopDuration}s)...`);
                            await new Promise(r => setTimeout(r, loopDuration * 1000));
                        }
                        didRewatch = true;
                    }
                } else {
                    await this.hub.logAction({
                        session_id: sessionId,
                        account_id: account.account_id,
                        username: account.username,
                        action_type: 'reels_watch',
                        reels_watched: reels,
                        max_reels: account.daily_limits.max_reels,
                        likes_given: likes,
                        max_likes: account.daily_limits.max_likes,
                        proxy_ip: proxyIp,
                        details: `Watched in [${currentMode}] for ${watchSec}s`,
                        duration_sec: watchSec
                    });
                }

                // 3. ЧТЕНИЕ И ОСТАВЛЕНИЕ КОММЕНТАРИЕВ (СМАЙЛИКИ ДЛЯ США ГЕО)
                if (didRewatch && Math.random() < 0.45 && currentMode !== 'FEED') {
                    console.log(`[${account.username}] 💬 Открытие комментариев к видео...`);
                    const sz = await this.adb.getScreenSize();
                    const isTablet = sz.width > sz.height;
                    const commX = isTablet ? 1520 : Math.floor(sz.width * 0.94);
                    const commY = isTablet ? 630 : Math.floor(sz.height * 0.84);
                    await this.adb.humanTap(commX, commY);
                    await new Promise(r => setTimeout(r, 1800));

                    // Рандомный скролл комментариев 1-3 раза
                    const commScrolls = Math.floor(Math.random() * 3 + 1);
                    for (let s = 1; s <= commScrolls; s++) {
                        await this.adb.commentsScroll(false);
                        const readPauseSec = Math.floor(Math.random() * 3 + 2);
                        console.log(`[${account.username}] 💬 Чтение комментариев (скролл ${s}/${commScrolls}, ${readPauseSec}s)...`);
                        await new Promise(r => setTimeout(r, readPauseSec * 1000));
                    }

                    // Оставляем тёплый смайлик под США ГЕО (шанс 25%, если не превышен лимит)
                    if (comments < account.daily_limits.max_comments && Math.random() < 0.25) {
                        const usaEmojis = ['😍🐾', '❤️🐶', 'Aww so cute! 🐕❤️', 'So sweet! 🐾✨', 'Adorable! 😍🐾', 'Best doggo! ❤️🐾', 'Love this! 🐾😍', 'Cutest! 🐶❤️'];
                        const pickEmoji = usaEmojis[Math.floor(Math.random() * usaEmojis.length)];
                        console.log(`[${account.username}] 💬 Оставлен тёплый emoji-комментарий [${comments + 1}/${account.daily_limits.max_comments}]: "${pickEmoji}"`);
                        
                        await this.adb.humanTap(Math.floor(sz.width * 0.35), Math.floor(sz.height * 0.95));
                        await new Promise(r => setTimeout(r, 1000));
                        await this.adb.sendText(pickEmoji);
                        await new Promise(r => setTimeout(r, 800));
                        await this.adb.humanTap(Math.floor(sz.width * 0.92), Math.floor(sz.height * 0.95));
                        comments++;
                        await new Promise(r => setTimeout(r, 1500));
                    }

                    // Закрываем комментарии кнопкой Back
                    await this.adb.pressKey(4);
                    await new Promise(r => setTimeout(r, 1200));
                }

                // 4. Полноэкранный переход к следующему контенту
                if (currentMode === 'FEED') {
                    // Для ленты: глубокий скролл с микро-доводкой
                    await this.adb.feedScroll();
                } else {
                    // Для Reels:
                    // Редкий откат назад (Backtrack, 4% шанс)
                    if (Math.random() < 0.04 && reels > 1) {
                        console.log(`[${account.username}] ↩️ Пересмотр назад (Backtrack)...`);
                        await this.adb.reelsFlick(true);
                        await new Promise(r => setTimeout(r, 3500));
                        await this.adb.reelsFlick(false);
                    } else {
                        await this.adb.reelsFlick(false);
                    }
                }

                // Естественная микропауза между роликами (1.2 - 2.5 сек)
                await new Promise(r => setTimeout(r, Math.floor(Math.random() * 1300 + 1200)));

                // 5. Проверка смены активности (Лента / Рилсы / Поиск)
                if (modeActionsLeft <= 0) {
                    const otherModes = availableModes.filter(m => m !== currentMode);
                    if (Math.random() < 0.75) {
                        currentMode = otherModes[Math.floor(Math.random() * otherModes.length)];
                    }
                    modeActionsLeft = Math.floor(Math.random() * 11 + 5); // 5-15 действий
                    console.log(`\n[${account.username}] 🎲 Смена активности: переключение в режим [${currentMode}] на следующие ${modeActionsLeft} действий...`);
                    await this.switchMode(currentMode, tags, account.username);
                }

                consecutiveErrors = 0;
            } catch (err) {
                consecutiveErrors++;
                console.error(`[${account.username}] Watchdog caught interaction error (${consecutiveErrors}/3):`, err.message);
                if (consecutiveErrors >= 3) {
                    console.warn(`[${account.username}] 3 consecutive errors. Самовосстановление: перезапуск приложения...`);
                    await this.adb.restartApp('com.instagram.android');
                    // Важно: НЕ вызываем switchToAccount повторно, возвращаемся сразу в безопасную ленту!
                    await this.clickTab('feed_tab');
                    await this.switchMode(currentMode, tags, account.username);
                    consecutiveErrors = 0;
                } else {
                    await this.adb.pressKey(4);
                    await new Promise(r => setTimeout(r, 1500));
                    await this.clickTab('feed_tab');
                }
            }
        }

        // 7. Финал сессии
        await this.hub.endSession({
            session_id: sessionId,
            account_id: account.account_id,
            username: account.username,
            likes_count: likes,
            reels_watched: reels,
            comments_count: comments,
            status: 'success'
        });
        console.log(`[${account.username}] ✅ Прогрев завершён: ${reels}/${account.daily_limits.max_reels} Reels, ${likes}/${account.daily_limits.max_likes} лайков`);
        return true;
    }

    /**
     * Быстрое и надёжное переключение между аккаунтами внутри одного Instagram
     */
    async switchToAccount(targetUsername) {
        console.log(`[${this.instanceId}] 🔍 Проверка активного профиля для @${targetUsername}...`);

        // Шаг 1: Проверяем реального пользователя в shared_prefs
        let currentUser = await this.adb.getCurrentInstagramUser();
        if (currentUser && currentUser.toLowerCase() === targetUsername.toLowerCase()) {
            console.log(`[${this.instanceId}] ✅ Аккаунт @${targetUsername} уже активен (по SharedPreferences)! Переход в ленту...`);
            await this.clickTab('feed_tab');
            await new Promise(r => setTimeout(r, 1500));
            return true;
        }

        // Шаг 2: Проверяем по разметке текущего экрана (вдруг Instagram уже на этом аккаунте)
        try {
            const curXml = await this.adb.getUiXml();
            if (curXml && curXml.toLowerCase().includes(targetUsername.toLowerCase())) {
                const targetInHeader = new RegExp(`(action_bar_title|action_bar_large_title)[^>]*text="[^"]*${targetUsername}[^"]*"`, 'i').test(curXml);
                if (targetInHeader) {
                    console.log(`[${this.instanceId}] ✅ Аккаунт @${targetUsername} уже активен в заголовке! Переход в ленту...`);
                    await this.clickTab('feed_tab');
                    await new Promise(r => setTimeout(r, 1500));
                    return true;
                }
            }
        } catch {}

        console.log(`[${this.instanceId}] Сейчас активен: @${currentUser || 'неизвестен'}. Переключаемся на @${targetUsername}...`);
        const size = await this.adb.getScreenSize();
        const isTablet = size.width > size.height;

        for (let attempt = 1; attempt <= 3; attempt++) {
            console.log(`[${this.instanceId}] Попытка смены аккаунта #${attempt}...`);

            // Переходим в профиль для доступа к шторке
            await this.clickTab('profile_tab');
            await new Promise(r => setTimeout(r, 2000));

            const profXml = await this.adb.getUiXml();

            // Проверяем: если уже на профиле targetUsername
            if (profXml && profXml.toLowerCase().includes(targetUsername.toLowerCase())) {
                const titleCheck = new RegExp(`(action_bar_title|action_bar_large_title)[^>]*text="[^"]*${targetUsername}[^"]*"`, 'i').test(profXml);
                if (titleCheck) {
                    console.log(`[${this.instanceId}] ✅ Подтверждено: @${targetUsername} уже активен на экране! Уход в ленту...`);
                    await this.clickTab('feed_tab');
                    await new Promise(r => setTimeout(r, 1500));
                    return true;
                }
            }

            // Открываем шторку аккаунтов
            let openedSwitcher = false;

            // Способ A: Клик по заголовку с выпадающим списком юзернейма в верхней панели профиля
            if (profXml) {
                const titleM = profXml.match(/resource-id="[^"]*(action_bar_title|action_bar_large_title|action_bar_title_chevron)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i);
                if (titleM) {
                    const cx = Math.floor((parseInt(titleM[2]) + parseInt(titleM[4])) / 2);
                    const cy = Math.floor((parseInt(titleM[3]) + parseInt(titleM[5])) / 2);
                    console.log(`[${this.instanceId}] 📂 Открываем шторку аккаунтов через заголовок профиля (${cx}, ${cy})...`);
                    await this.adb.humanTap(cx, cy);
                    await new Promise(r => setTimeout(r, 2200));
                    openedSwitcher = true;
                }
            }

            // Способ B: Долгий тап на вкладку профиля (1200 мс)
            if (!openedSwitcher) {
                const pX = isTablet ? 48 : Math.floor(size.width * 0.90);
                const pY = isTablet ? Math.floor(size.height * 0.84) : Math.floor(size.height * 0.965);
                console.log(`[${this.instanceId}] 📂 Открываем шторку аккаунтов через долгий тап (${pX}, ${pY})...`);
                await this.adb.shell(`input swipe ${pX} ${pY} ${pX} ${pY} 1200`);
                await new Promise(r => setTimeout(r, 2200));
            }

            // Читаем разметку шторки (формат switcher_dump.xml)
            const sheetXml = await this.adb.getUiXml();
            let clickedTarget = false;

            if (sheetXml) {
                // Ищем строку аккаунта по content-desc="<targetUsername>" или text="<targetUsername>"
                const reTarget = new RegExp(`(content-desc|text)="[^"]*${targetUsername}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
                const mTarget = sheetXml.match(reTarget);

                if (mTarget) {
                    const x1 = parseInt(mTarget[2]), y1 = parseInt(mTarget[3]), x2 = parseInt(mTarget[4]), y2 = parseInt(mTarget[5]);
                    const cx = Math.floor((x1 + x2) / 2);
                    const cy = Math.floor((y1 + y2) / 2);
                    console.log(`[${this.instanceId}] 🎯 Найден @${targetUsername} в шторке аккаунтов! Тапаем (${cx}, ${cy})...`);
                    await this.adb.humanTap(cx, cy);
                    clickedTarget = true;
                } else {
                    // Если точное имя не нашлось в тексте, но шторка открыта (есть "Добавьте аккаунт" или "Центр аккаунтов"):
                    const isSwitcherOpen = sheetXml.includes('Добавьте аккаунт') || sheetXml.includes('Add account') || sheetXml.includes('Центр аккаунтов') || sheetXml.includes('Accounts Center');
                    if (isSwitcherOpen) {
                        const fallbackY = isTablet ? Math.floor(size.height * 0.66) : Math.floor(size.height * 0.68);
                        const fallbackX = isTablet ? 800 : Math.floor(size.width / 2);
                        console.log(`[${this.instanceId}] 🎯 Шторка активна. Тапаем второй слот (${fallbackX}, ${fallbackY})...`);
                        await this.adb.humanTap(fallbackX, fallbackY);
                        clickedTarget = true;
                    }
                }
            }

            // Способ C: Быстрый двойной тап по иконке profile_tab (быстрое переключение аккаунтов)
            if (!clickedTarget) {
                console.log(`[${this.instanceId}] 🔄 Пробуем переключение через быстрый дабл-тап по иконке профиля...`);
                const pX = isTablet ? 48 : Math.floor(size.width * 0.90);
                const pY = isTablet ? Math.floor(size.height * 0.84) : Math.floor(size.height * 0.965);
                await this.adb.humanTap(pX, pY);
                await new Promise(r => setTimeout(r, 120));
                await this.adb.humanTap(pX, pY);
                await new Promise(r => setTimeout(r, 2000));
            }

            // Ожидаем завершения анимации перехода (3.5 сек)
            await new Promise(r => setTimeout(r, 3500));

            // Проверяем, какой аккаунт теперь активен
            currentUser = await this.adb.getCurrentInstagramUser();
            const verifyXml = await this.adb.getUiXml();
            const appearsInUi = verifyXml && verifyXml.toLowerCase().includes(targetUsername.toLowerCase());

            if ((currentUser && currentUser.toLowerCase() === targetUsername.toLowerCase()) || appearsInUi) {
                console.log(`[${this.instanceId}] 🚀 УСПЕШНО! Подтверждён активный аккаунт: @${targetUsername}. Переход в ленту...`);
                // СРАЗУ УХОДИМ С ПРОФИЛЯ В ГЛАВНУЮ ЛЕНТУ
                await this.clickTab('feed_tab');
                await new Promise(r => setTimeout(r, 2000));
                return true;
            } else {
                console.warn(`[${this.instanceId}] Попытка #${attempt} не удалась. Текущий юзер: @${currentUser || 'неизвестен'}`);
                // Закрываем шторку назад перед следующей попыткой
                await this.adb.pressKey(4);
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        // Если все попытки исчерпаны, перезапускаем приложение для восстановления и продолжаем
        console.warn(`[${this.instanceId}] Перезапуск Instagram для сброса состояния...`);
        await this.adb.restartApp('com.instagram.android');
        await new Promise(r => setTimeout(r, 3500));
        await this.clickTab('feed_tab');
        return true;
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
