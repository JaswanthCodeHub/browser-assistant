/* A single window and explicit source tab survive service-worker suspension. */
interface DetachedPanelSession {
    windowId: number;
    targetTabId: number;
    token: string;
}

const DETACHED_PANEL_KEY = 'assistantDetachedPanel';
const DETACHED_PANEL_MODE = 'assistantPanelMode';
const detachedPage = () => chrome.runtime.getURL('detached-panel.html');
let detachedPanelQueue: Promise<unknown> = Promise.resolve();

function serializeDetachedPanel<T>(action: () => Promise<T>): Promise<T> {
    const result = detachedPanelQueue.then(action);
    detachedPanelQueue = result.catch(() => undefined);
    return result;
}

async function detachedPanelSession(): Promise<DetachedPanelSession | undefined> {
    return (await chrome.storage.session.get<{[DETACHED_PANEL_KEY]?: DetachedPanelSession}>(DETACHED_PANEL_KEY))[DETACHED_PANEL_KEY];
}

function messagePanelTab(tabId: number, message: object) {
    return chrome.tabs.sendMessage(tabId, message, {frameId: 0});
}

async function releasePanelTab(session: DetachedPanelSession) {
    await messagePanelTab(session.targetTabId, {action: 'assistantPanelDetach', token: session.token})
        .catch(() => undefined);
}

async function openDetachedPanel(tabId: number) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || !/^https?:\/\//.test(tab.url || '')) {
        throw Error('Open the toolbar on the web tab you want to control.');
    }
    const ready = await messagePanelTab(tabId, {action: 'assistantPanelPing'}).catch(() => null);
    if (!ready?.ok) throw Error('Refresh the web tab to load Browser Assistant, then try again.');

    let previous = await detachedPanelSession();
    const existing = previous && await chrome.windows.get(previous.windowId, {populate: true}).catch(() => null);
    if (previous && !existing?.tabs?.some(item => (item.url || item.pendingUrl) === detachedPage())) {
        await releasePanelTab(previous);
        await chrome.storage.session.remove(DETACHED_PANEL_KEY);
        previous = undefined;
    }

    const created = previous ? undefined : await chrome.windows.create({
        url: detachedPage(), type: 'popup', width: 420, height: 690, focused: true,
    });
    const windowId = previous?.windowId ?? created?.id;
    if (windowId === undefined) throw Error('Chrome could not open the separate panel.');
    if (previous && previous.targetTabId !== tabId) await releasePanelTab(previous);
    const session = previous?.targetTabId === tabId ? previous : {windowId, targetTabId: tabId, token: crypto.randomUUID()};
    await chrome.storage.session.set({[DETACHED_PANEL_KEY]: session});
    await chrome.storage.local.set({[DETACHED_PANEL_MODE]: 'separate'});
    if (previous) await chrome.windows.update(windowId, {focused: true, state: 'normal'});
    return {ok: true};
}

function browserAssistantDetachedMessage(request: AssistantMessage, sender: chrome.runtime.MessageSender, reply: (data: unknown) => void) {
    if (sender.id !== chrome.runtime.id) {reply({error: 'Extension sender required.'}); return false;}
    void serializeDetachedPanel(async () => {
        if (request.action === 'panel:open' && sender.url === chrome.runtime.getURL('popup.html')) {
            if (!Number.isInteger(request.targetTabId)) throw Error('Choose a web tab first.');
            return openDetachedPanel(request.targetTabId);
        }

        const session = await detachedPanelSession();
        if (request.action === 'panel:target-status' && sender.tab && sender.frameId === 0) {
            return {token: session?.targetTabId === sender.tab.id ? session.token : ''};
        }
        if (sender.url !== detachedPage() || !session || sender.tab?.windowId !== session.windowId) {
            throw Error('Open the separate panel from the Browser Assistant toolbar on a web tab.');
        }

        if (request.action === 'panel:return') {
            await chrome.storage.local.set({[DETACHED_PANEL_MODE]: 'floating'});
            await chrome.storage.session.remove(DETACHED_PANEL_KEY);
            await releasePanelTab(session);
            await chrome.windows.remove(session.windowId);
            return {ok: true};
        }

        const tab = await chrome.tabs.get(session.targetTabId).catch(() => null);
        if (!tab) throw Error('The selected tab was closed. Open the toolbar on another web tab to reconnect.');
        if (!/^https?:\/\//.test(tab.url || '')) throw Error('Return to a webpage in the selected tab.');
        if (request.action === 'panel:action' && request.token !== session.token) {
            throw Error('The selected tab changed. Try the control again.');
        }

        const response = await messagePanelTab(tab.id, {
            action: request.action === 'panel:snapshot' ? 'assistantPanelSnapshot' : 'assistantPanelAction',
            token: session.token, panelControl: request.panelControl, operation: request.operation, value: request.value,
        }).catch(() => null);
        if (!response) throw Error('Waiting for Browser Assistant in the selected tab. Refresh that tab if needed.');
        return {...response, token: session.token, title: tab.title || new URL(tab.url).hostname, active: tab.active};
    }).then(reply, error => reply({error: error.message}));
    return true;
}

chrome.windows.onRemoved.addListener(windowId => {
    void serializeDetachedPanel(async () => {
        const session = await detachedPanelSession();
        if (session?.windowId !== windowId) return;
        await chrome.storage.session.remove(DETACHED_PANEL_KEY);
        await releasePanelTab(session);
    }).catch(() => {});
});
