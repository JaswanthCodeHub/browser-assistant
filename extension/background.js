// Background script for Browser Assistant
importScripts('editor-bridge.js');
// Local unpacked development updates: only reload when the files in Chrome's
// own extension folder match the workspace release, and every running task is idle.
let updateCheckRunning = false;
async function checkWorkspaceUpdate() {
    if (updateCheckRunning)
        return;
    updateCheckRunning = true;
    try {
        const release = await fetch('http://127.0.0.1:8000/extension-release', { cache: 'no-store', signal: AbortSignal.timeout(4000) }).then(r => r.ok ? r.json() : null);
        const current = chrome.runtime.getManifest().version;
        if (!release?.version || release.version === current)
            return;
        const disk = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' }).then(r => r.json());
        // Never loop reloading an old ZIP extraction. Load the workspace's
        // extension directory once to enable local file updates.
        if (disk.version !== release.version)
            return;
        const tabs = (await chrome.tabs.query({})).filter(tab => /^https?:\/\//.test(tab.url || ''));
        const states = await Promise.all(tabs.map(async (tab) => {
            try {
                return { tab, state: await chrome.tabs.sendMessage(tab.id, { action: 'assistantUpdateStatus' }) };
            }
            catch {
                return { tab, state: null };
            }
        }));
        if (states.some(item => item.state?.busy))
            return;
        for (const { tab, state } of states) {
            if (!state)
                continue;
            const prepared = await chrome.tabs.sendMessage(tab.id, { action: 'assistantPrepareUpdate' });
            if (!prepared?.ready) {
                await attachUpdatedPanels();
                return;
            }
        }
        chrome.runtime.reload();
    }
    catch { /* Offline server or restricted tab: retry on the next alarm. */ }
    finally {
        updateCheckRunning = false;
    }
}
async function attachUpdatedPanels() {
    const manifest = chrome.runtime.getManifest();
    const tabs = (await chrome.tabs.query({})).filter(tab => /^https?:\/\//.test(tab.url || ''));
    for (const tab of tabs) {
        try {
            const existing = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => Boolean(document.getElementById('assistant-root')) });
            if (existing[0]?.result)
                continue;
            for (const group of manifest.content_scripts) {
                await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: group.css || [] });
                await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: group.js });
            }
        }
        catch { /* Chrome may restrict particular sites; leave them alone. */ }
    }
}
chrome.alarms.create('assistant-workspace-update', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'assistant-workspace-update')
    void checkWorkspaceUpdate(); });
chrome.runtime.onInstalled.addListener(() => { void attachUpdatedPanels(); });
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') {
        sendResponse({ error: 'Invalid extension message' });
        return false;
    }
    if (request.action === 'questionImage') {
        let url;
        try {
            url = new URL(request.url);
        }
        catch { }
        if (sender.id !== chrome.runtime.id || !sender.tab || !/^https?:/.test(sender.url || '')
            || !url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
            sendResponse({ error: 'Question image access is not authorized.' });
            return false;
        }
        (async () => {
            const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(10000) });
            if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
                throw new Error('Question image download failed.');
            if (Number(response.headers.get('content-length')) > 10000000)
                throw new Error('Question image is too large.');
            const reader = response.body.getReader();
            const parts = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.length;
                if (size > 10000000) {
                    await reader.cancel();
                    throw new Error('Question image is too large.');
                }
                parts.push(value);
            }
            let binary = '';
            for (const part of parts)
                for (let i = 0; i < part.length; i += 8192)
                    binary += String.fromCharCode(...part.subarray(i, i + 8192));
            return { dataUrl: `data:${response.headers.get('content-type').split(';')[0]};base64,${btoa(binary)}` };
        })().then(sendResponse).catch(error => sendResponse({ error: error.message }));
        return true;
    }
    if (request.action === 'mcqSnippets') {
        let allowed = false;
        // Chrome's document URL may retain the route where this SPA first
        // loaded. This read-only bridge must also work after in-page navigation
        // and on review routes. Keep the exact portal origin and sender checks;
        // use the tab URL only for a top frame with no document URL.
        try {
            const topFrame = sender.frameId === undefined || sender.frameId === 0;
            const url = new URL(sender.url || (topFrame ? sender.tab?.url : ''));
            allowed = url.origin === 'https://learning.ccbp.in';
        }
        catch { }
        if (!sender.tab || sender.id !== chrome.runtime.id || !allowed) {
            sendResponse({ ok: false, error: 'Full snippet access is unavailable on this page/frame.' });
            return false;
        }
        chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN', func: browserAssistantReadMcqSnippets })
            .then(results => sendResponse(results[0]?.result || { ok: false, error: results[0]?.error?.message || 'The snippet reader returned no result. The page may still be loading.' }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (request.action === 'orderingDrag') {
        if (!sender.tab || sender.id !== chrome.runtime.id || !sender.url?.startsWith('https://learning.ccbp.in/')) {
            sendResponse({ ok: false });
            return false;
        }
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN',
            func: browserAssistantOrderingDrag, args: [request.prompt, request.options, request.from, request.to],
        }).then(results => sendResponse(results[0]?.result || { ok: false }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (['focusOnlineIde', 'runOnlineIde', 'onlineIdeStatus'].includes(request.action)) {
        const questionPath = /^\/question\/([a-f0-9-]{36})\/?$/i;
        let questionId;
        try {
            const page = new URL(sender.tab.url || sender.url);
            const source = new URL(sender.url);
            if (page.origin === 'https://learning.ccbp.in' && source.origin === page.origin) {
                questionId = page.pathname.match(questionPath)?.[1];
            }
        }
        catch { /* Only a portal question tab can request its IDE. */ }
        if (!questionId || sender.id !== chrome.runtime.id || sender.frameId > 0) {
            sendResponse({ ok: false, error: 'Online IDE access requires the portal question tab.' });
            return false;
        }
        (async () => {
            const tabs = await chrome.tabs.query({ windowId: sender.tab.windowId });
            const matches = tabs.filter(tab => {
                try {
                    const url = new URL(tab.url || tab.pendingUrl);
                    return url.origin === 'https://learning.ccbp.in' && /^\/ide\/[a-z0-9]+\/?$/i.test(url.pathname)
                        && url.searchParams.get('q_id') === questionId;
                }
                catch {
                    return false;
                }
            });
            const ide = matches.find(tab => tab.active) || matches[0];
            if (request.action !== 'focusOnlineIde') {
                if (!ide || matches.length !== 1)
                    return { ok: false, error: 'A unique IDE tab for this question is required.' };
                const workspace = new URL(ide.url || ide.pendingUrl).pathname.split('/')[2];
                if (request.workspace !== workspace || !/^[a-z0-9]{6,24}$/i.test(workspace)
                    || !/^[a-f0-9-]{36}$/.test(request.token || ''))
                    return { ok: false, error: 'The portal submit command and IDE workspace do not match.' };
                if (request.action === 'runOnlineIde' && (!ide.active || typeof request.code !== 'string'
                    || !request.code.trim() || new TextEncoder().encode(request.code).length > 12000)) {
                    return { ok: false, error: 'The matching IDE must be active and the source must fit the terminal input limit.' };
                }
                const results = await chrome.scripting.executeScript({ target: { tabId: ide.id, allFrames: true }, world: 'MAIN',
                    func: browserAssistantOnlineIdeTerminal,
                    args: [request.action, workspace, questionId, request.token, request.action === 'runOnlineIde' ? request.code : null] });
                const frameResults = results.map(entry => entry.result).filter(Boolean);
                return frameResults.length === 1 ? frameResults[0] : { ok: false, retry: true, error: 'The IDE workspace is still opening.' };
            }
            if (ide && !ide.active)
                await chrome.tabs.update(ide.id, { active: true });
            return { ok: true, found: Boolean(ide) };
        })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (request.action === 'codingEditor') {
        let protocol = '';
        try {
            protocol = new URL(sender.url).protocol;
        }
        catch { /* Invalid senders are rejected below. */ }
        if (!sender.tab || sender.id !== chrome.runtime.id || !['https:', 'http:'].includes(protocol)
            || !['read', 'write', 'readProject', 'writeProject'].includes(request.operation)
            || (request.operation.endsWith('Project') && new URL(sender.url).origin !== 'https://learning.ccbp.in')) {
            sendResponse({ ok: false, error: 'Editor access is not authorized.' });
            return false;
        }
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN',
            func: browserAssistantEditor, args: [request.operation, request.selector, request.expected ?? null, request.value ?? null],
        }).then(results => sendResponse(results[0]?.result || { ok: false, error: 'Editor unavailable.' }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (request.action === "captureVisibleTab") {
        if (sender.id !== chrome.runtime.id || !sender.tab || !/^https?:\/\//.test(sender.url || sender.tab.url || '')) {
            sendResponse({ error: 'Screenshot access is not authorized.' });
            return false;
        }
        // A tab can lose focus while capture is queued. Never capture another
        // tab/window and send that screenshot with the requesting page's URL.
        chrome.tabs.query({ active: true, windowId: sender.tab.windowId }).then(active => {
            if (active.length !== 1 || active[0].id !== sender.tab.id) {
                sendResponse({ error: 'The requesting tab is no longer active. Focus it and try Vision Scan again.' });
                return;
            }
            chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    console.error("Capture failed:", chrome.runtime.lastError.message);
                    sendResponse({ error: chrome.runtime.lastError.message });
                }
                else {
                    sendResponse({ dataUrl: dataUrl });
                }
            });
        }).catch(() => sendResponse({ error: 'Could not verify the active screenshot tab.' }));
        return true; // Keep the message channel open for async response
    }
    if (request.action === "apiRequest") {
        const allowedMethods = { '/health': ['GET'], '/solve': ['POST'], '/solve-vision': ['POST'],
            '/history': ['GET', 'POST', 'DELETE'], '/journal': ['POST'] };
        const method = request.method || 'POST';
        if (sender.id !== chrome.runtime.id || !allowedMethods[request.path]?.includes(method)) {
            sendResponse({ error: "Blocked API sender, path or method" });
            return false;
        }
        let body;
        try {
            body = request.body === undefined ? undefined : JSON.stringify(request.body);
        }
        catch {
            sendResponse({ error: 'Invalid API request body' });
            return false;
        }
        // Chrome documents an API pulse for bounded long-running operations.
        // Keep only an active inference request alive; never run an idle timer.
        const longRequest = ['/solve', '/solve-vision', '/journal'].includes(request.path);
        const keepAlive = longRequest && typeof chrome.runtime.getPlatformInfo === 'function'
            ? setInterval(() => chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; }), 25000) : null;
        fetch(`http://127.0.0.1:8000${request.path}`, {
            signal: AbortSignal.timeout(['/solve', '/solve-vision', '/journal'].includes(request.path) ? 360000 : 8000),
            method,
            headers: { "Content-Type": "application/json" },
            body,
        })
            .then(async (response) => {
            const text = await response.text();
            let data;
            try {
                data = text ? JSON.parse(text) : {};
            }
            catch {
                data = { detail: text || "Unexpected server response" };
            }
            sendResponse({ ok: response.ok, status: response.status, data });
        })
            .catch(error => sendResponse({ error: error.name === 'TimeoutError' ? 'Local server request timed out.' : 'Local server is offline. Start it with: python main.py' }))
            .finally(() => { if (keepAlive !== null)
            clearInterval(keepAlive); });
        return true;
    }
    // Unknown action — respond immediately so the sender doesn't hang
    sendResponse({ error: `Unknown action: ${request.action}` });
    return false;
});
