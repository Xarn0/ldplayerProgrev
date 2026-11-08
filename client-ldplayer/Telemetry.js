"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HubClient = exports.SpintaxService = void 0;
class SpintaxService {
    static resolve(spintaxList) {
        if (!spintaxList || spintaxList.length === 0)
            return 'Nice! 👍';
        let text = spintaxList[Math.floor(Math.random() * spintaxList.length)];
        const regex = /\{([^{}]+)\}/;
        while (regex.test(text)) {
            text = text.replace(regex, (_, choices) => {
                const parts = choices.split('|');
                return parts[Math.floor(Math.random() * parts.length)];
            });
        }
        return text.trim();
    }
}
exports.SpintaxService = SpintaxService;
class HubClient {
    apiUrl;
    apiKey;
    constructor(apiUrl, apiKey) {
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
    }
    async startSession(payload) {
        await this.post('/api/warmup/session/start', payload);
    }
    async logAction(payload) {
        await this.post('/api/warmup/log', payload);
    }
    async endSession(payload) {
        await this.post('/api/warmup/session/end', payload);
    }
    async reportIncident(payload) {
        await this.post('/api/warmup/incident', payload);
    }
    async post(endpoint, body) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            await fetch(`${this.apiUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        }
        catch (err) {
            console.warn(`[HubClient] Failed to send telemetry to ${endpoint}: ${err.message}`);
        }
    }
}
exports.HubClient = HubClient;
