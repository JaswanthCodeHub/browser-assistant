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

const separatePanelButton = document.querySelector<HTMLButtonElement>('#open-separate-panel');
const separatePanelStatus = document.getElementById('separate-panel-status');
if (separatePanelButton) {
    void chrome.storage.local.get('assistantPanelMode').then(settings => {
        if (settings.assistantPanelMode === 'separate') separatePanelButton.textContent = 'Resume separate panel for this tab';
    }).catch(() => {});
    separatePanelButton.addEventListener('click', async () => {
        separatePanelButton.disabled = true;
        separatePanelStatus.hidden = true;
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            const result = await chrome.runtime.sendMessage({action: 'panel:open', targetTabId: tab?.id});
            if (!result?.ok) throw Error(result?.error || 'Could not open the separate panel.');
            window.close();
        } catch (error) {
            separatePanelStatus.textContent = error.message;
            separatePanelStatus.hidden = false;
            separatePanelButton.disabled = false;
        }
    });
}
