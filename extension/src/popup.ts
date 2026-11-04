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
