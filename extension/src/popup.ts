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

const settingsStatus = document.getElementById('settings-status');
const pairingInput = document.querySelector<HTMLInputElement>('#pairing-token');
async function popupAction(action: string, extra: object, success: (result: any) => string) {
    try {
        const result = await chrome.runtime.sendMessage({action,...extra});
        if (!result?.ok) throw Error(result?.error || result?.data?.detail || 'Request failed.');
        settingsStatus.textContent = success(result);
    } catch (error) {
        settingsStatus.textContent = error.message;
    }
}
document.getElementById('open-assistant')?.addEventListener('click', () => {
    void popupAction('openAssistantOnTab', {}, () => 'Panel opened.');
});
document.getElementById('local-pairing')?.addEventListener('submit', event => {
    event.preventDefault();
    const token = pairingInput.value.trim();
    pairingInput.value = '';
    void popupAction('pairLocalServer', {token}, () => 'Local server paired.');
});
document.getElementById('unpair-server')?.addEventListener('click', () => {
    void popupAction('unpairLocalServer', {}, () => 'Local pairing removed.');
});
document.getElementById('check-provider')?.addEventListener('click', () => {
    settingsStatus.textContent = 'Checking configured providers…';
    void popupAction('apiRequest', {path:'/provider-status',method:'POST'}, result =>
        `Groq: ${result.data.groq}. Ollama: ${result.data.ollama}.`);
});
if (settingsStatus) void popupAction('pairingStatus', {}, result => result.paired ? 'Local server token saved.' : 'Pair your local server to scan.');
const saveHistory = document.querySelector<HTMLInputElement>('#save-history');
if (saveHistory) {
    void chrome.storage.local.get({assistantSaveHistory:false}).then(value => {
        saveHistory.checked = value.assistantSaveHistory === true;
    }).catch(() => {});
    saveHistory.addEventListener('change', () => {
        void chrome.storage.local.set({assistantSaveHistory:saveHistory.checked}).catch(() => {
            settingsStatus.textContent = 'Could not save your history preference.';
        });
    });
}
