// Background script for Browser Assistant
importScripts('editor-bridge.js');
// Local unpacked development updates: only reload when the files in Chrome's
// own extension folder match the workspace release, and every running task is idle.
let updateCheckRunning = false;
async function checkWorkspaceUpdate() {
    if (updateCheckRunning) return;
    updateCheckRunning = true;
    try {
        const release = await fetch('http://127.0.0.1:8000/extension-release', {cache:'no-store',signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():null);
        const current = chrome.runtime.getManifest().version;
        if (!release?.version || release.version === current) return;
        const disk = await fetch(chrome.runtime.getURL('manifest.json'), {cache:'no-store'}).then(r=>r.json());
        // Never loop reloading an old ZIP extraction. Load the workspace's
        // extension directory once to enable local file updates.
        if (disk.version !== release.version) return;
        const tabs = (await chrome.tabs.query({})).filter(tab=>/^https?:\/\//.test(tab.url || ''));
        const states = await Promise.all(tabs.map(async tab=>{
            try {return {tab,state:await chrome.tabs.sendMessage(tab.id,{action:'assistantUpdateStatus'})};}
            catch {return {tab,state:null};}
        }));
        if (states.some(item=>item.state?.busy)) return;
        for (const {tab,state} of states) {
            if (!state) continue;
            const prepared = await chrome.tabs.sendMessage(tab.id,{action:'assistantPrepareUpdate'});
            if (!prepared?.ready) {await attachUpdatedPanels();return;}
        }
        chrome.runtime.reload();
    } catch { /* Offline server or restricted tab: retry on the next alarm. */ }
    finally {updateCheckRunning=false;}
}
async function attachUpdatedPanels() {
    const tabs=await chrome.tabs.query({url:[
        'https://learning.ccbp.in/*','https://admissions.aurora.edu.in/*','http://127.0.0.1:8000/*',
    ]});
    for(const tab of tabs) {
        try {
            await attachAssistantPanel(tab.id);
        } catch { /* Chrome may restrict particular sites; leave them alone. */ }
    }
}

async function attachAssistantPanel(tabId: number) {
    const target = {tabId};
    const existing = await chrome.scripting.executeScript({target,func:()=>Boolean(document.getElementById('assistant-root'))});
    if (existing[0]?.result) return;
    for (const group of chrome.runtime.getManifest().content_scripts || []) {
        if (group.css?.length) await chrome.scripting.insertCSS({target,files:group.css});
        if (group.js?.length) await chrome.scripting.executeScript({target,files:group.js});
    }
}

chrome.commands?.onCommand.addListener((command,tab) => {
    if (command === 'toggle-automation' && tab?.id) {
        void chrome.tabs.sendMessage(tab.id,{action:'assistantToggleAutomation'}).catch(() => {});
    }
});
chrome.alarms.create('assistant-workspace-update',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== 'assistant-workspace-update') return;
    void checkWorkspaceUpdate();
    void updateJournalBadge();
});
chrome.runtime.onInstalled.addListener(details => {
    void attachUpdatedPanels();
    if (details.reason === 'update') void clearRetiredReminderSettings();
});

async function clearRetiredReminderSettings() {
    try {
        const storage = chrome.storage.local;
        const keys = Object.keys(await storage.get()).filter(key =>
            key === 'assistantJournalReminderConfig' || key.startsWith('assistantJournalReminder:'));
        if (keys.length) await storage.remove(keys);
    } catch (error) {
        console.warn('Could not remove retired journal reminder settings.', error);
    }
}

let journalBadgeRevision = 0;
function activeJournalTimers(data: AssistantJournalTimerData, now = Date.now()): AssistantJournalTimer[] {
    const prefix = 'assistantJournalTimer:';
    const timers = new Map<string, number>();
    const last = data.assistantJournalTimer;
    if (typeof last?.path === 'string') timers.set(last.path.replace(/\/$/, ''), last.deadline);
    for (const [key, deadline] of Object.entries(data)) {
        if (key.startsWith(prefix) && typeof deadline === 'number') timers.set(key.slice(prefix.length), deadline);
    }
    return [...timers].filter(([path, deadline]) => /^\/modules\/reflective-journal\/[^/]+$/.test(path) &&
        Number.isFinite(deadline) && deadline > now && !data[`assistantJournalConfirmed:${path}`])
        .map(([path, deadline]) => ({path, deadline})).sort((a, b) => a.deadline - b.deadline);
}

async function updateJournalBadge() {
    const storage = chrome.storage?.local;
    if (!storage || !chrome.action) return;
    const revision = ++journalBadgeRevision;
    try {
        const timers = activeJournalTimers(await storage.get<AssistantJournalTimerData>());
        const remaining = timers[0]?.deadline - Date.now();
        if (revision !== journalBadgeRevision) return;
        const minutes = Math.ceil(remaining / 60000);
        const active = Number.isFinite(minutes) && minutes > 0;
        const text = active ? (remaining < 60000 ? '<1m' : minutes > 999 ? '999+' : `${minutes}m`) : '';
        await Promise.all([
            chrome.action.setBadgeText({text}),
            chrome.action.setBadgeBackgroundColor({color: '#5b39db'}),
            chrome.action.setTitle({title: active ? `Browser Assistant · ${timers.length > 1 ? 'Next journal' : 'Journal'}: about ${minutes} min left` : 'Browser Assistant'}),
        ]);
    } catch { /* Retry when the timer changes or on the next alarm. */ }
}

chrome.storage?.local.onChanged?.addListener(changes => {
    if (Object.keys(changes).some(key => key.startsWith('assistantJournalTimer') || key.startsWith('assistantJournalConfirmed:'))) {
        void updateJournalBadge();
    }
});
void updateJournalBadge();

// Serialize saves and consumes so a new document cannot replay a checkpoint
// and Stop cannot race a pending save. Page storage is never read here.
let checkpointQueue = Promise.resolve();
function handleAutomationCheckpoint(request: AssistantMessage, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) {
    const storage = chrome.storage?.session;
    if (!storage || sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id)
        || sender.frameId !== 0 || !sender.documentId || !['practice', 'coding'].includes(request.checkpointKind)) {
        reply({ok:false});
        return;
    }
    let page: URL;
    try {
        const source = new URL(sender.url);
        page = new URL(sender.tab.url || sender.url);
        if (page.origin !== source.origin || !['https://learning.ccbp.in', 'http://127.0.0.1:8000'].includes(page.origin)) throw Error();
    } catch { reply({ok:false}); return; }
    const key = `assistantCheckpoint:${sender.tab.id}:${request.checkpointKind}`;
    checkpointQueue = checkpointQueue.then(async () => {
        if (request.action === 'clearCheckpoint') {
            await storage.remove(key);
            return reply({ok:true});
        }
        if (request.action === 'saveCheckpoint') {
            const checkpoint = request.checkpoint;
            if (!checkpoint || checkpoint.kind !== request.checkpointKind || JSON.stringify(checkpoint).length > 120000) return reply({ok:false});
            let path: string;
            if (checkpoint.expectedUrl) {
                const target = new URL(checkpoint.expectedUrl, page);
                if (target.origin !== page.origin) return reply({ok:false});
                path = target.pathname;
            }
            await storage.set({[key]:{origin:page.origin, path, documentId:sender.documentId, expires:Date.now()+120000, value:checkpoint.value}});
            return reply({ok:true});
        }
        const record = (await storage.get(key))[key] as {
            expires:number; origin:string; path?:string; documentId:string; value:unknown;
        } | undefined;
        if (!record) return reply({ok:true});
        if (record.expires <= Date.now() || record.origin !== page.origin) {
            await storage.remove(key);
            return reply({ok:true});
        }
        if (record.path ? record.path !== page.pathname : record.documentId !== sender.documentId) return reply({ok:true});
        await storage.remove(key);
        reply({ok:true,checkpoint:record.value});
    }).catch(() => { reply({ok:false}); });
}

const LOCAL_API = 'http://127.0.0.1:8000';
let pairingDatabase: Promise<IDBDatabase>;
function localPairing(token?: string): Promise<string> {
    pairingDatabase ??= new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('assistant-local-settings', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('settings');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }).catch(error => { pairingDatabase = undefined; throw error; });
    return pairingDatabase.then(database => new Promise((resolve, reject) => {
        const transaction = database.transaction('settings', token === undefined ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('settings');
        const request = token === undefined ? store.get('pairing') : token ? store.put(token, 'pairing') : store.delete('pairing');
        transaction.oncomplete = () => resolve(token ?? request.result ?? '');
        transaction.onabort = () => reject(transaction.error);
    }));
}

function isAssistantPopup(sender: chrome.runtime.MessageSender) {
    const popup = chrome.runtime.getURL('popup.html');
    return sender.id === chrome.runtime.id && sender.url?.split('#', 1)[0] === popup;
}

const tabCaptureEpoch = new Map<number, number>();
function invalidateCapture(windowId: number) {
    tabCaptureEpoch.set(windowId, (tabCaptureEpoch.get(windowId) || 0) + 1);
}
chrome.tabs?.onActivated?.addListener(info => invalidateCapture(info.windowId));
chrome.tabs?.onUpdated?.addListener((_id, change, tab) => {
    if (tab.active && (change.url || change.status === 'loading')) invalidateCapture(tab.windowId);
});
chrome.windows?.onRemoved?.addListener(id => tabCaptureEpoch.delete(id));

chrome.runtime.onMessage.addListener((request: AssistantMessage, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') {
        sendResponse({error:'Invalid extension message'}); return false;
    }
    if (['saveCheckpoint', 'takeCheckpoint', 'clearCheckpoint'].includes(request.action)) {
        handleAutomationCheckpoint(request, sender, sendResponse);
        return true;
    }
    if (['pairLocalServer','unpairLocalServer','pairingStatus','openAssistantOnTab'].includes(request.action)) {
        if (!isAssistantPopup(sender)) { sendResponse({ok:false,error:'Open the Browser Assistant toolbar popup.'}); return false; }
        (async () => {
            if (request.action === 'openAssistantOnTab') {
                const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
                if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw Error('Open an HTTP or HTTPS page first.');
                await attachAssistantPanel(tab.id);
                await chrome.tabs.sendMessage(tab.id,{action:'assistantShowPanel'});
                return {ok:true};
            }
            if (request.action === 'pairingStatus') return {ok:true,paired:Boolean(await localPairing())};
            if (request.action === 'unpairLocalServer') { await localPairing(''); return {ok:true}; }
            if (!/^[A-Za-z0-9_-]{32,128}$/.test(request.token || '')) throw Error('Enter the pairing token shown by your local server.');
            const response = await fetch(LOCAL_API+'/history?limit=1', {
                headers:{'X-Assistant-Token':request.token}, signal:AbortSignal.timeout(4000), redirect:'error', cache:'no-store',
            });
            if (!response.ok) throw Error(response.status === 401 ? 'The local server rejected the token.' : 'Could not verify local server pairing.');
            await localPairing(request.token);
            return {ok:true,paired:true};
        })().then(sendResponse).catch(error => sendResponse({ok:false,error:error.message}));
        return true;
    }
    if (request.action === 'journalCountdowns' && sender.id === chrome.runtime.id) {
        chrome.storage.local.get<AssistantJournalTimerData>().then(data => sendResponse(activeJournalTimers(data)))
            .catch(() => sendResponse([]));
        return true;
    }
    if (request.action === 'questionImage') {
        let url, source;
        try { url=new URL(request.url); source=new URL(sender.url); } catch {}
        if (sender.id !== chrome.runtime.id || !sender.tab || !/^https?:/.test(sender.url || '')
            || !url || !['https:','http:'].includes(url.protocol) || url.username || url.password
            || !source || url.origin !== source.origin) {
            sendResponse({error:'Question image access is not authorized.'}); return false;
        }
        (async()=>{
            const response=await fetch(url.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});
            if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Question image download failed.');
            if (Number(response.headers.get('content-length')) > 10000000) throw new Error('Question image is too large.');
            const reader=response.body.getReader(); const parts=[]; let size=0;
            while (true) {
                const {done,value}=await reader.read();if(done)break;
                size+=value.length;if(size>10000000){await reader.cancel();throw new Error('Question image is too large.');}parts.push(value);
            }
            let binary='';for(const part of parts)for(let i=0;i<part.length;i+=8192)binary+=String.fromCharCode(...part.subarray(i,i+8192));
            return {dataUrl:`data:${response.headers.get('content-type').split(';')[0]};base64,${btoa(binary)}`};
        })().then(sendResponse).catch(error=>sendResponse({error:error.message}));
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
        } catch {}
        if (!sender.tab || sender.id !== chrome.runtime.id || !allowed) {sendResponse({ok:false,error:'Full snippet access is unavailable on this page/frame.'});return false;}
        chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[sender.frameId || 0]},world:'MAIN',func:browserAssistantReadMcqSnippets})
            .then(results=>sendResponse(results[0]?.result || {ok:false,error:(results[0] as typeof results[0] & { error?: { message?: string } })?.error?.message || 'The snippet reader returned no result. The page may still be loading.'}))
            .catch(error=>sendResponse({ok:false,error:error.message}));
        return true;
    }
    if (request.action === 'orderingDrag') {
        if (!sender.tab || sender.id !== chrome.runtime.id || !sender.url?.startsWith('https://learning.ccbp.in/')) {
            sendResponse({ ok: false }); return false;
        }
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN',
            func: browserAssistantOrderingDrag, args: [request.prompt, request.options, request.from, request.to],
        }).then(results => sendResponse(results[0]?.result || { ok: false }))
            .catch(error => sendResponse({ ok: false, error: error.message }));
        return true;
    }
    if (['focusOnlineIde','runOnlineIde','onlineIdeStatus'].includes(request.action)) {
        const questionPath = /^\/question\/([a-f0-9-]{36})\/?$/i;
        let questionId;
        try {
            const page = new URL(sender.tab.url || sender.url);
            const source = new URL(sender.url);
            if (page.origin === 'https://learning.ccbp.in' && source.origin === page.origin) {
                questionId = page.pathname.match(questionPath)?.[1];
            }
        } catch { /* Only a portal question tab can request its IDE. */ }
        if (!questionId || sender.id !== chrome.runtime.id || sender.frameId > 0) {
            sendResponse({ok:false,error:'Online IDE access requires the portal question tab.'});
            return false;
        }
        (async () => {
            const tabs = await chrome.tabs.query({windowId: sender.tab.windowId});
            const matches = tabs.filter(tab => {
                try {
                    const url = new URL(tab.url || tab.pendingUrl);
                    return url.origin === 'https://learning.ccbp.in' && /^\/ide\/[a-z0-9]+\/?$/i.test(url.pathname)
                        && url.searchParams.get('q_id') === questionId;
                } catch { return false; }
            });
            const ide = matches.find(tab => tab.active) || matches[0];
            if (request.action !== 'focusOnlineIde') {
                if (!ide || matches.length !== 1) return {ok:false,error:'A unique IDE tab for this question is required.'};
                const workspace = new URL(ide.url || ide.pendingUrl).pathname.split('/')[2];
                if (request.workspace !== workspace || !/^[a-z0-9]{6,24}$/i.test(workspace)
                    || !/^[a-f0-9-]{36}$/.test(request.token || '')) return {ok:false,error:'The portal submit command and IDE workspace do not match.'};
                if (request.action === 'runOnlineIde' && (!ide.active || typeof request.code !== 'string'
                    || !request.code.trim() || new TextEncoder().encode(request.code).length > 12000)) {
                    return {ok:false,error:'The matching IDE must be active and the app.js source must be at most 12 KB.'};
                }
                const results = await chrome.scripting.executeScript({target:{tabId:ide.id,allFrames:true},world:'MAIN',
                    func:browserAssistantOnlineIde,
                    args:[request.action,workspace,questionId,request.token,request.action === 'runOnlineIde' ? request.code : null]});
                const frameResults = results.map(entry=>entry.result).filter(Boolean);
                return frameResults.length === 1 ? frameResults[0] : {ok:false,retry:true,error:'The IDE workspace is still opening.'};
            }
            if (ide && !ide.active) await chrome.tabs.update(ide.id, {active:true});
            return {ok:true,found:Boolean(ide)};
        })().then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
        return true;
    }
    if (request.action === 'codingEditor') {
        let protocol = '';
        try { protocol = new URL(sender.url).protocol; } catch { /* Invalid senders are rejected below. */ }
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
            sendResponse({error:'Screenshot access is not authorized.'}); return false;
        }
        (async () => {
            const windowId = sender.tab.windowId;
            const epoch = tabCaptureEpoch.get(windowId);
            const expectedUrl = request.url || sender.tab.url || sender.url;
            async function current() {
                const tabs = await chrome.tabs.query({active:true,windowId});
                return tabs.length === 1 && tabs[0].id === sender.tab.id
                    && tabs[0].url === expectedUrl && tabCaptureEpoch.get(windowId) === epoch;
            }
            if (!(await current())) throw Error('The requesting tab is no longer active. Focus it and try Vision Scan again.');
            const dataUrl = await new Promise<string>((resolve, reject) => {
                chrome.tabs.captureVisibleTab(windowId,{format:'png'}, value => {
                    if (chrome.runtime.lastError || !value) reject(Error('Open the extension toolbar on this tab to allow screenshot capture.'));
                    else resolve(value);
                });
            });
            if (!(await current())) throw Error('The tab changed during capture. Try Vision Scan again.');
            return {dataUrl};
        })().then(sendResponse).catch(error => sendResponse({error:error.message}));
        return true;
    }

    if (request.action === "apiRequest") {
        const allowedMethods = {'/health':['GET'],'/solve':['POST'],'/solve-vision':['POST'],
            '/history':['GET','POST','DELETE'],'/journal':['POST'],'/provider-status':['POST'],'/jobs':['POST']};
        const method = request.method || 'POST';
        const permitted = Object.hasOwn(allowedMethods,request.path)
            ? allowedMethods[request.path].includes(method)
            : /^\/jobs\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(request.path || '') && ['GET','DELETE'].includes(method);
        if (sender.id !== chrome.runtime.id || !permitted) {
            sendResponse({ error: "Blocked API sender, path or method" });
            return false;
        }
        let body;
        try { body = request.body === undefined ? undefined : JSON.stringify(request.body); }
        catch { sendResponse({error:'Invalid API request body'}); return false; }
        // Chrome documents an API pulse for bounded long-running operations.
        // Keep only an active inference request alive; never run an idle timer.
        const longRequest = ['/solve','/solve-vision','/journal'].includes(request.path);
        const keepAlive = longRequest && typeof chrome.runtime.getPlatformInfo === 'function'
            ? setInterval(()=>chrome.runtime.getPlatformInfo(()=>{ void chrome.runtime.lastError; }),25000) : null;
        (async () => {
            const headers = {"Content-Type":"application/json"};
            if (request.path !== '/health') {
                const token = await localPairing();
                if (!token) return {status:401,ok:false,data:{detail:'Pair the local server in the Browser Assistant toolbar popup.'}};
                headers['X-Assistant-Token'] = token;
            }
            return fetch(`${LOCAL_API}${request.path}`, {
                signal:AbortSignal.timeout(longRequest ? 360000 : 12000),
                method,headers,body,redirect:'error',cache:'no-store',
            });
        })()
            .then(async (response) => {
                if (!('text' in response)) { sendResponse(response); return; }
                const text = await response.text();
                let data;
                try { data = text ? JSON.parse(text) : {}; }
                catch { data = { detail: text || "Unexpected server response" }; }
                sendResponse({ ok: response.ok, status: response.status, data });
            })
            .catch(error => sendResponse({ error: error.name === 'TimeoutError' ? 'Local server request timed out.' : 'Local server is offline. Start it with: python main.py' }))
            .finally(()=>{if(keepAlive !== null)clearInterval(keepAlive);});
        return true;
    }

    // Unknown action — respond immediately so the sender doesn't hang
    sendResponse({ error: `Unknown action: ${request.action}` });
    return false;
});
