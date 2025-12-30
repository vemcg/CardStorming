// Debug logging system
export const debugLog = {
    entries: [],
    maxEntries: 500,
    muted: false,

    log(level, message, data = null) {
        if (this.muted) return;

        const timestamp = new Date().toISOString();
        const entry = { timestamp, level, message, data };
        this.entries.push(entry);

        // Keep only last maxEntries
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }

        // Also log to console
        const consoleMsg = `[${level.toUpperCase()}] ${message}`;
        if (data) {
            console.log(consoleMsg, data);
        } else {
            console.log(consoleMsg);
        }

        // Update log display if visible
        this.updateDisplay();
    },

    info(message, data) { this.log('info', message, data); },
    warn(message, data) { this.log('warn', message, data); },
    error(message, data) { this.log('error', message, data); },

    clear() {
        this.entries = [];
        this.updateDisplay();
    },

    updateDisplay() {
        const logContent = document.getElementById('log-content');
        if (!logContent) return;

        logContent.innerHTML = this.entries.map(entry => {
            const dataStr = entry.data ? `\n${JSON.stringify(entry.data, null, 2)}` : '';
            return `<div class="log-entry log-${entry.level}">
                <span class="log-time">${entry.timestamp}</span>
                <span class="log-level">[${entry.level.toUpperCase()}]</span>
                <span class="log-message">${entry.message}</span>
                ${dataStr ? `<pre class="log-data">${dataStr}</pre>` : ''}
            </div>`;
        }).join('');

        // Scroll to bottom
        logContent.scrollTop = logContent.scrollHeight;
    }
};
