// Popup health check script
const el = document.getElementById('server-status');
new Promise<{ groq_configured?: boolean }>((resolve, reject) => {
    chrome.runtime.sendMessage(
        { action: 'apiRequest', path: '/health', method: 'GET' },
        (response) => {
            if (chrome.runtime.lastError || !response || response.error || !response.ok) {
                reject(new Error(response?.error || 'Server unavailable'));
                return;
            }
            resolve(response.data);
        },
    );
})
    .then(d => {
        el.textContent = d.groq_configured ? 'online (Groq ✓)' : 'online (no Groq key)';
        el.className = 'online';
    })
    .catch(() => {
        el.textContent = 'offline';
        el.className = 'offline';
    });

const journalCountdown = document.getElementById('journal-countdown');
let journalTimers: AssistantJournalTimer[] = [];
function showJournalCountdown() {
    const now = Date.now();
    const times = journalTimers.filter(timer => timer.deadline > now).map(timer => {
        const seconds = Math.ceil((timer.deadline - now) / 1000);
        return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    });
    journalCountdown.hidden = !times.length;
    journalCountdown.textContent = times.length ? `Journal time left ≈ ${times.join(' · ')}` : '';
}

const journalTimerStorage = chrome.storage.local;
let journalTimerRevision = 0;
async function refreshPopupJournalTimers() {
    const request = ++journalTimerRevision;
    try {
        const timers = await chrome.runtime.sendMessage<AssistantMessage, AssistantJournalTimer[]>({action: 'journalCountdowns'});
        if (request !== journalTimerRevision) return;
        journalTimers = Array.isArray(timers) ? timers : [];
        showJournalCountdown();
    } catch { /* A closed popup no longer needs an update. */ }
}
journalTimerStorage.onChanged.addListener(changes => {
    if (Object.keys(changes).some(key => key.startsWith('assistantJournalTimer') || key.startsWith('assistantJournalConfirmed:'))) {
        void refreshPopupJournalTimers();
    }
});
void refreshPopupJournalTimers();
setInterval(showJournalCountdown, 1000);

const reminderForm = document.querySelector<HTMLFormElement>('#journal-reminder-form');
if (reminderForm) {
    const key = 'assistantJournalReminderConfig';
    const urlInput = document.querySelector<HTMLInputElement>('#journal-webhook-url');
    const tokenInput = document.querySelector<HTMLInputElement>('#journal-webhook-token');
    const status = document.getElementById('journal-reminder-status');
    const disable = document.querySelector<HTMLButtonElement>('#journal-reminder-disable');
    void journalTimerStorage.get<AssistantJournalReminderData>(key).then(data => {
        const config = data[key];
        if (config) urlInput.value = config.url;
        status.textContent = config ? 'Reminder enabled.' : 'Reminder disabled.';
    }).catch(() => { status.textContent = 'Could not load reminder settings.'; });
    reminderForm.addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const url = new URL(urlInput.value);
            const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
            if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) || url.username || url.password ||
                url.search || url.hash || !url.pathname.includes('/webhook/')) {
                throw Error('Enter the n8n production webhook URL. Use HTTPS for remote n8n.');
            }
            const token = tokenInput.value.trim();
            if (!/^[\x21-\x7e]{20,256}$/.test(token)) throw Error('Use a webhook token of at least 20 characters, with no spaces.');
            await journalTimerStorage.set({[key]: {url: url.href, token}});
            tokenInput.value = '';
            status.textContent = 'Reminder enabled.';
        } catch (error) { status.textContent = error.message; }
    });
    disable.addEventListener('click', async () => {
        try {
            await journalTimerStorage.remove(key);
            urlInput.value = '';
            tokenInput.value = '';
            status.textContent = 'Reminder disabled.';
        } catch { status.textContent = 'Could not disable reminder.'; }
    });
}
