/* Render only the assistant's supported controls from the selected tab. */
(() => {
    const shell = document.getElementById('assistant-root');
    const status = document.getElementById('detached-status');
    const countdown = document.getElementById('detached-countdown');
    const returnButton = document.getElementById('detached-return');
    const tags = new Set(['DIV','SPAN','P','SMALL','STRONG','DL','DT','DD','H3','H4','SECTION','BUTTON','SVG','PATH',
        'PRE','CODE','DETAILS','SUMMARY','KBD','TEXTAREA','LABEL','SELECT','OPTION','BR']);
    const attributes = new Set(['id','class','type','role','title','tabindex','disabled','hidden','open','selected',
        'placeholder','rows','value','viewBox','d','data-panel-control','data-state','data-info','data-countdown']);
    let token = '';
    let lastHtml: string;
    let requesting = false;

    function safePanelNode(node: Node): Node | null {
        if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
        if (!(node instanceof Element) || !tags.has(node.tagName.toUpperCase())) return null;
        const tag = node.tagName.toLowerCase();
        const element = tag === 'svg' || tag === 'path'
            ? document.createElementNS('http://www.w3.org/2000/svg', tag)
            : document.createElement(tag);
        for (const attr of node.attributes) {
            if (attributes.has(attr.name) || /^aria-[a-z-]+$/.test(attr.name)) element.setAttribute(attr.name, attr.value);
        }
        for (const child of node.childNodes) {
            const copy = safePanelNode(child);
            if (copy) element.appendChild(copy);
        }
        return element;
    }

    function updatePanel(html: string) {
        if (html === lastHtml) return;
        const active = document.activeElement;
        const activeId = active?.getAttribute('data-panel-control');
        const activeMode = active?.matches('[role="tab"]') ? active.id : '';
        const caret = active instanceof HTMLTextAreaElement
            ? [active.selectionStart, active.selectionEnd] as const : null;
        const scrolls = ['.assistant-body', '.assistant-qa-panel'].map(selector =>
            [selector, shell.querySelector(selector)?.scrollTop ?? 0] as const);
        const source = document.createElement('template');
        source.innerHTML = html;
        const content = document.createDocumentFragment();
        for (const child of source.content.childNodes) {
            const copy = safePanelNode(child);
            if (copy) content.appendChild(copy);
        }
        shell.replaceChildren(content);
        for (const [selector, scrollTop] of scrolls) {
            const region = shell.querySelector(selector);
            if (region) region.scrollTop = scrollTop;
        }
        if (activeId) {
            const replacement = shell.querySelector<HTMLElement>('[data-panel-control="' + CSS.escape(activeId) + '"]')
                ?? (activeMode ? shell.querySelector<HTMLElement>('#' + CSS.escape(activeMode)) : null);
            replacement?.focus({preventScroll: true});
            if (caret && replacement instanceof HTMLTextAreaElement) {
                replacement.value = (active as HTMLTextAreaElement).value;
                replacement.setSelectionRange(...caret);
            }
        }
        lastHtml = html;
    }

    async function refresh() {
        if (requesting) return;
        requesting = true;
        try {
            const result = await chrome.runtime.sendMessage({action: 'panel:snapshot'});
            if (!result?.ok) throw Error(result?.error || 'The selected tab did not respond.');
            token = result.token;
            const label = result.title + (result.active ? '' : ' · Select this tab in Chrome for Vision Scan.');
            if (status.textContent !== label) status.textContent = label;
            if (countdown.textContent !== result.countdown) countdown.textContent = result.countdown;
            countdown.hidden = !result.countdown;
            updatePanel(result.html);
        } catch (error) {
            token = '';
            lastHtml = undefined;
            shell.replaceChildren();
            countdown.hidden = true;
            status.textContent = error.message;
        } finally {
            requesting = false;
        }
    }

    async function send(operation: string, control?: HTMLElement, value?: string) {
        if (!token) return;
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'panel:action', token, operation, panelControl: control?.dataset.panelControl, value,
            });
            if (!response?.ok) throw Error(response?.error || 'The selected tab did not respond.');
        } catch (error) {status.textContent = error.message;}
        void refresh();
    }

    async function returnToFloating() {
        try {
            const response = await chrome.runtime.sendMessage({action: 'panel:return'});
            if (response?.error) status.textContent = response.error;
        } catch (error) {status.textContent = error.message;}
    }
    returnButton.addEventListener('click', returnToFloating);
    shell.addEventListener('click', event => {
        const control = (event.target as Element).closest<HTMLElement>('[data-panel-control]');
        if (!control?.matches('button,summary') || control.matches(':disabled')) return;
        event.preventDefault();
        if (control.id === 'assistant-close-btn') {returnToFloating(); return;}
        if (control.classList.contains('assistant-copy-btn')) {
            const code = control.closest('.assistant-code-container')?.querySelector('code')?.textContent;
            if (code === undefined) return;
            void navigator.clipboard.writeText(code).then(() => {
                control.textContent = 'Copied';
                setTimeout(() => {control.textContent = 'Copy';}, 2000);
            }).catch(error => {status.textContent = error.message;});
            return;
        }
        void send('click', control);
    });
    shell.addEventListener('input', event => {
        if (event.target instanceof HTMLTextAreaElement) void send('value', event.target, event.target.value);
    });
    shell.addEventListener('change', event => {
        if (event.target instanceof HTMLSelectElement) void send('value', event.target, event.target.value);
    });
    document.addEventListener('keydown', event => {
        if (event.repeat || event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if (event.altKey) {
            if (key === 'a' || event.code === 'KeyA') {event.preventDefault(); void send('automation');}
            else if (event.shiftKey && (key === 'j' || event.code === 'KeyJ')) {event.preventDefault(); void send('journal');}
            return;
        }
        const focused = event.target as Element;
        if (focused.closest('input,textarea,select,[contenteditable="true"]')) return;
        if (focused.matches('[role="tab"]')) {
            const tabs = [...shell.querySelectorAll<HTMLElement>('[role="tab"]')];
            const index = tabs.indexOf(focused as HTMLElement);
            const next = {arrowright: (index + 1) % tabs.length, arrowleft: (index + tabs.length - 1) % tabs.length,
                home: 0, end: tabs.length - 1}[key];
            if (next !== undefined && tabs[next]) {
                event.preventDefault();
                tabs[next].focus();
                void send('click', tabs[next]);
                return;
            }
        }
        if (key === ']') {event.preventDefault(); returnToFloating();}
        else if (key === '\\') {event.preventDefault(); shell.hidden = false; void send('vision');}
        else if (key === '[') {event.preventDefault(); shell.hidden = !shell.hidden;}
        else if (key === '`') {event.preventDefault(); shell.hidden = false;}
    });

    void refresh();
    setInterval(refresh, 650);
})();
