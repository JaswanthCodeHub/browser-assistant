function formatJournalTime(seconds: number) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function browserAssistantJournal(global) {
    'use strict';
    const keys = ['experience', 'feelings', 'learning', 'application', 'conclusion'];
    const labels = ['Experience', 'Feelings', 'Learning', 'Application', 'Conclusion'];
    function validate(sections) {
        if (!sections || Object.keys(sections).length !== 5 || keys.some(k => typeof sections[k] !== 'string' || !sections[k].trim())) throw Error('Five complete sections are required.');
        const counts = keys.map(k => sections[k].trim().split(/\s+/u).length);
        const count = counts.reduce((n, value) => n + value, 0);
        if (counts.some(value => value !== 80)) throw Error(`Each section must have exactly 80 words (400 total). Actual counts: ${counts.join(', ')}.`);
        return count;
    }
    function metadata(text) {
        const number = text.match(/Reflective\s+Journal\s+(\d+)\b/i);
        const subject = text.match(/Subject\s*:\s*([\s\S]*?)(?:Description\s*:|Due Date\s*:)/i);
        if (!number || !subject) return null;
        return {number: Number(number[1]), subject: subject[1].replace(/\s+/g, ' ').trim()};
    }
    function readableText(root) {
        const parts = [];
        function visit(node) {
            if (node.nodeType === 3) { parts.push(node.textContent); return; }
            if (node.nodeType !== 1 || node.matches('#assistant-root,#assistant-journal,script,style,textarea')) return;
            for (const child of node.childNodes) visit(child);
        }
        visit(root);
        return parts.join(' ').replace(/\s+/g, ' ').trim();
    }
    function pageText(doc) { return readableText(doc.body); }
    function fields(doc) {
        const result = {};
        for (const field of doc.querySelectorAll('textarea,[contenteditable="true"],[contenteditable=""],[role="textbox"]')) {
            if (field.closest('#assistant-root, #assistant-journal') || field.disabled || field.readOnly || !field.getClientRects().length) continue;
            if (field.tagName !== 'TEXTAREA' && !field.hasAttribute('contenteditable') && !field.isContentEditable) continue;
            let node = field.parentElement;
            for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
                const headings = [...node.querySelectorAll('h1,h2,h3,h4,h5,h6,label')];
                const clone = node.cloneNode(true);
                for (const input of clone.querySelectorAll('textarea,[contenteditable],[role="textbox"]')) input.remove();
                const text = headings.length ? headings.map(h => h.textContent).join(' ') : readableText(clone);
                const matches = labels.filter(label => new RegExp(`\\b${label}\\b`, 'i').test(text));
                if (matches.length === 1) {
                    const key = matches[0].toLowerCase();
                    if (result[key] && result[key] !== field) throw Error(`Ambiguous ${key} field.`);
                    result[key] = field;
                    break;
                }
            }
        }
        return keys.every(k => result[k]) ? result : null;
    }
    function readField(field) {
        return field.tagName === 'TEXTAREA' ? field.value : (field.innerText ?? field.textContent ?? '');
    }
    function remainingSeconds(doc) {
        const excluded = node => node.closest('#assistant-root,#assistant-journal,textarea,[contenteditable],script,style');
        const clock = value => {
            const match=value.trim().match(/^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/);
            return match ? (match[3] === undefined ? Number(match[1])*60+Number(match[2])
                : Number(match[1])*3600+Number(match[2])*60+Number(match[3])) : null;
        };
        const labeled = value => {
            const match=value.replace(/\s+/g,' ').trim().match(/^(?:Time(?:\s+(?:Remaining|Left))?|Remaining\s+Time)\s*:?\s*(\d{1,3}:[0-5]\d(?::[0-5]\d)?)$/i);
            return match ? clock(match[1]) : null;
        };
        const explicit = new Set<number>(), values = new Set<number>();
        for (const node of doc.querySelectorAll('[role="timer"],[data-timer],[data-testid*="timer"]')) {
            if (excluded(node) || !node.getClientRects().length) continue;
            const value=clock(node.textContent) ?? labeled(node.textContent);
            if (value !== null) explicit.add(value);
        }
        if (explicit.size) return explicit.size===1 ? [...explicit][0] : null;
        for (const node of doc.querySelectorAll('span,div,p,output,strong,b,time,label')) {
            if (excluded(node) || !node.getClientRects().length) continue;
            const value=labeled(node.innerText ?? node.textContent);
            if (value !== null) values.add(value);
        }
        return values.size===1 ? [...values][0] : null;
    }
    const api = {validate, metadata, fields, pageText, readField, remainingSeconds};
    if (typeof module !== 'undefined') module.exports = api;
    if (!global.document || global.location?.origin !== 'https://admissions.aurora.edu.in') return;
    if (!/^\/modules\/reflective-journal\//.test(global.location.pathname)) return;
    const existing = document.getElementById('assistant-journal');
    const journalBuild = global.chrome?.runtime?.getManifest?.().version || 'development';
    if (existing?.dataset.build === journalBuild) return;
    if (existing && global.BrowserAssistantJournalBusy) return;
    existing?.remove();
    const storageKey = `assistantJournal:${location.pathname}`;
    let info = null, running = false, paused = false, generation = 0, idleState = 'READY';
    let activeRequest: AbortController;
    try { info = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
    const panel = document.createElement('section');
    panel.id = 'assistant-journal';
    panel.dataset.build = journalBuild;
    panel.style.cssText = 'position:fixed;right:16px;top:160px;width:290px;z-index:2147483646;background:white;color:#17233d;padding:16px;border:2px solid #7638ff;border-radius:12px;box-shadow:0 4px 20px #0003;font:14px Arial';
    panel.innerHTML = '<strong>Reflective Journal</strong><p data-info></p><p data-countdown style="font-weight:600;margin:8px 0"></p><textarea aria-label="Your class experience and feelings" placeholder="Describe your actual class experience and how you felt" rows="3" style="width:100%;box-sizing:border-box"></textarea><button type="button" style="margin-top:8px;padding:10px">Prepare Journal Draft</button><p role="status" aria-live="polite"></p>';
    document.body.appendChild(panel);
    const controls = document.createElement('div');
    controls.innerHTML = '<label>Subject <select data-subject aria-label="Journal subject"><option value="">Detect from page</option><option>Backend Development Fundamentals</option><option>Computer Organization and Architecture</option><option>Advanced Data Structures</option><option>Linear Algebra Essentials</option><option>Fundamentals of Artificial Intelligence</option></select></label><label>Module / Journal <select data-number aria-label="Journal number"><option value="">Detect from page</option>' + Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('') + '</select></label>';
    for (const label of controls.querySelectorAll('label')) label.style.cssText = 'display:block;margin:8px 0';
    for (const select of controls.querySelectorAll('select')) select.style.cssText = 'display:block;width:100%;padding:5px;color:#17233d;background:white;border:1px solid #abb3c3';
    panel.insertBefore(controls, panel.querySelector('textarea'));
    const status = panel.querySelector('[role=status]'), button = panel.querySelector('button');
    const countdown = panel.querySelector<HTMLElement>('[data-countdown]');
    const countdownKey = 'assistantJournalTimer';
    const journalPath = location.pathname.replace(/\/$/, '');
    const journalDeadlineKey = `${countdownKey}:${journalPath}`;
    let deadline: number | undefined;
    let lastPortalTime: number | null = null;
    let observedInForeground = false;
    let publishedDeadline: number | undefined;
    let journalConfirmed = false;

    async function loadCountdown() {
        try {
            const cached = sessionStorage.getItem(journalDeadlineKey);
            if (cached && Number.isFinite(Number(cached))) {
                deadline = Number(cached);
                renderCountdown(null);
                return;
            }
        } catch { /* Fall back to extension storage. */ }
        try {
            const data = await global.chrome?.storage?.local.get([journalDeadlineKey, countdownKey]);
            const latest = data?.[countdownKey];
            const saved = data?.[journalDeadlineKey] ?? (latest?.path?.replace(/\/$/, '') === journalPath ? latest.deadline : undefined);
            if (deadline === undefined && Number.isFinite(saved)) {
                deadline = saved;
                renderCountdown(null);
            }
        } catch { /* The portal clock remains available if extension storage is unavailable. */ }
    }

    function renderCountdown(portalTime: number | null) {
        const seconds = portalTime ?? (deadline === undefined ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        const label = portalTime === null ? 'Estimated time left' : 'Portal time left';
        const restoringDraft = portalTime === null && /Unsaved draft detected\./i.test(document.body.innerText || pageText(document));
        const clockText = seconds === null ? 'Waiting for the portal timer to appear' : `${label} ${formatJournalTime(seconds)}`;
        const text = restoringDraft
            ? `${clockText}. To reopen your draft, review the declaration and use the portal’s Accept Terms to Start button.`
            : seconds === null ? `${clockText}.` : clockText;
        if (countdown.textContent !== text) countdown.textContent = text;
    }

    async function recordJournalConfirmation() {
        if (!journalConfirmed && [...document.querySelectorAll('p,h1,h2,h3,[role=status],[role=alert]')].some(node =>
            !node.closest('#assistant-root,#assistant-journal,[contenteditable]') && node.getClientRects().length &&
            /^(?:journal (?:has been )?submitted successfully|journal submission successful)[.!]?$/i.test(node.textContent.trim()))) {
            try {
                await global.chrome?.storage?.local.set({[`assistantJournalConfirmed:${journalPath}`]: true});
                journalConfirmed = true;
            } catch { /* Retry on the next tick while the confirmation is available. */ }
        }
    }

    async function updateCountdown() {
        if (!document.contains(panel) || storageKey !== `assistantJournal:${location.pathname}`) return;
        const observed = remainingSeconds(document);
        // The editor can briefly render zero before the active clock loads.
        const portalTime = observed === 0 && lastPortalTime === null ? null : observed;
        const visible = !document.hidden;
        const returnedToJournal = visible && !observedInForeground;
        observedInForeground = visible;
        if (portalTime !== null && portalTime !== lastPortalTime) {
            deadline = Date.now() + portalTime * 1000;
            lastPortalTime = portalTime;
            // Keep the observed deadline through an immediate same-tab reload,
            // even if the extension storage write is still in flight.
            try { sessionStorage.setItem(journalDeadlineKey, String(deadline)); } catch {}
        }
        renderCountdown(portalTime);
        if (!visible || portalTime === null || deadline === undefined ||
            (!returnedToJournal && publishedDeadline !== undefined && Math.abs(deadline - publishedDeadline) <= 2000)) return;
        const pendingDeadline = deadline;
        publishedDeadline = pendingDeadline;
        try {
            await global.chrome?.storage?.local.set({
                [journalDeadlineKey]: pendingDeadline,
                [countdownKey]: {path: journalPath, deadline: pendingDeadline},
            });
        } catch {
            if (publishedDeadline === pendingDeadline) publishedDeadline = undefined;
        }
    }
    button.title = 'Prepare Journal Draft (Alt + Shift + J)';
    button.setAttribute('aria-keyshortcuts', 'Alt+Shift+J');
    const shortcutHint = document.createElement('p');
    shortcutHint.textContent = 'Shortcut: Alt + Shift + J';
    shortcutHint.style.cssText = 'font-size:12px;margin:6px 0;color:#516078';
    panel.insertBefore(shortcutHint, status);
    const shortcutListener = event => {
        if (!event.isTrusted || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing) return;
        if (event.code !== 'KeyJ' && String(event.key).toLowerCase() !== 'j') return;
        if (!document.contains(panel) || storageKey !== `assistantJournal:${location.pathname}`) return;
        event.preventDefault();
        if (!running && !button.disabled) void prepareDraft();
    };
    document.addEventListener('keydown', shortcutListener, true);
    function notify() {
        document.dispatchEvent(new global.Event('assistant-journal-update'));
    }
    const controller = {
        path: location.pathname,
        start() {return prepareDraft();},
        stop() {
            activeRequest?.abort();
            generation++; running = false; paused = false;
            idleState = 'STOPPED';
            global.BrowserAssistantJournalBusy = false; button.disabled = false;
            status.textContent = 'Draft preparation stopped.';
            notify();
        },
        pause() {if (!running) return; paused = !paused; notify();},
        mount(slot) {
            if (!document.getElementById('assistant-root')) return;
            if (slot) {
                if (panel.parentElement !== slot) slot.appendChild(panel);
                panel.style.cssText = 'display:block;position:static;width:100%;box-sizing:border-box;padding:10px;border:1px solid #6c58aa;border-radius:8px;background:#fff;color:#17233d;font:13px Arial;margin:10px 0;';
                button.hidden = true;
            } else controller.detach();
        },
        detach() {
            if (document.getElementById('assistant-root')) {
                if (panel.parentElement !== document.body) document.body.appendChild(panel);
                panel.style.display = 'none';
            }
        },
        getState() {
            const completed = journalConfirmed ? 1 : 0;
            return {running, paused,
                state: completed ? 'COMPLETED' : paused ? 'PAUSED' : running ? 'PREPARING' : idleState,
                message: completed ? 'Submission confirmed by the portal.' : paused ? 'Paused. Resume to review the draft.'
                    : status.textContent || 'Prepare an editable draft before starting the portal assessment.',
                title: info ? info.subject + ' · Module ' + info.number : 'Select subject and module',
                completed};
        },
    };
    if (global.BrowserAssistantJournal) {global.BrowserAssistantJournal.current = controller;global.BrowserAssistantJournal.opening = false;}
    function assertCurrentPage() {
        if (!document.contains(panel) || storageKey !== `assistantJournal:${location.pathname}`) throw Error('Journal page changed. Draft preparation stopped.');
        if (/assessment not found/i.test(document.querySelector('main')?.textContent || '')) throw Error('Assessment is unavailable. Return to Assessments and check its status.');
    }
    function refreshInfo() {
        const found = metadata(pageText(document));
        if (found) {
            info = found;
            try { sessionStorage.setItem(storageKey, JSON.stringify(info)); } catch {}
        }
        const subject = controls.querySelector<HTMLSelectElement>('[data-subject]').value;
        const number = Number(controls.querySelector<HTMLInputElement>('[data-number]').value);
        if (!found && !controls.hidden && subject && number >= 1 && number <= 10) {
            info = {subject, number};
            try { sessionStorage.setItem(storageKey, JSON.stringify(info)); } catch {}
        }
        controls.hidden = Boolean(info);
        panel.querySelector('[data-info]').textContent = info ? `${info.subject} · Module ${info.number} · 400 words (80 per section)` : 'Subject not detected yet. Select the subject and journal number below, or open Module Information.';
    }
    const preview = document.createElement('section');
    preview.hidden = true;
    preview.setAttribute('aria-label', 'Editable journal draft');
    panel.insertBefore(preview, status);
    const editors = Object.fromEntries(keys.map((key, index) => {
        const group = document.createElement('label');
        group.style.display = 'block';
        const count = document.createElement('span');
        const editor = document.createElement('textarea');
        editor.rows = 4;
        editor.style.width = '100%';
        const updateCount = () => {
            const words = editor.value.trim() ? editor.value.trim().split(/\\s+/u).length : 0;
            count.textContent = labels[index] + ' (' + words + '/80 words)';
        };
        editor.addEventListener('input', updateCount);
        group.append(count, editor);
        preview.appendChild(group);
        return [key, {editor, updateCount}];
    }));
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy reviewed draft';
    copy.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        const sections = Object.fromEntries(keys.map(key => [key, editors[key].editor.value]));
        try {
            validate(sections);
            await navigator.clipboard.writeText(keys.map((key, index) => labels[index] + '\n' + sections[key].trim()).join('\n\n'));
            status.textContent = 'Draft copied. Review, start and submit in the portal.';
        } catch (error) { status.textContent = error.message || 'Could not copy the draft.'; }
        notify();
    });
    preview.appendChild(copy);

    async function prepareDraft() {
        if (running || journalConfirmed) return;
        refreshInfo();
        const notes = panel.querySelector('textarea').value.trim();
        if (!info || !notes) {
            status.textContent = !info ? 'Select the subject and module first.' : 'Add your own class experience and feelings to prepare a draft.';
            notify();
            return;
        }
        running = true;
        global.BrowserAssistantJournalBusy = true;
        button.disabled = true;
        paused = false;
        const run = ++generation;
        status.textContent = 'Preparing the matching module journal…';
        notify();
        try {
            assertCurrentPage();
            activeRequest = new AbortController();
            const response = await browserAssistantLocalInference('/journal',{...info,notes},
                message => chrome.runtime.sendMessage(message),activeRequest.signal);
            if (run !== generation) return;
            assertCurrentPage();
            if (!response?.ok) {
                const detail = response?.data?.detail || response?.error;
                throw Error(typeof detail === 'string' ? detail : detail?.message || 'Journal generation failed.');
            }
            validate(response.data.sections);
            while (run === generation && paused) await new Promise(resolve => setTimeout(resolve, 100));
            if (run !== generation) return;
            assertCurrentPage();
            for (const key of keys) {
                const {editor, updateCount} = editors[key];
                editor.value = response.data.sections[key];
                updateCount();
            }
            preview.hidden = false;
            idleState = 'REVIEW_DRAFT';
            status.textContent = 'Draft ready. Edit the five sections, then review the declaration and start on the portal.';
        } catch (error) {
            if (run === generation) {idleState = 'ERROR'; status.textContent = error.message;}
        } finally {
            if (run === generation) {
                activeRequest = undefined;
                running = false; global.BrowserAssistantJournalBusy = false; button.disabled = false; notify();
            }
        }
    }
    button.addEventListener('click', event => { if (event.isTrusted) void prepareDraft(); });
    refreshInfo();
    void loadCountdown();
    void updateCountdown();
    const clockObserver = global.MutationObserver ? new global.MutationObserver(records => {
        if (records.some(({target}) => !(target.nodeType === 1 ? target : target.parentElement)?.closest('#assistant-root,#assistant-journal'))) {
            void updateCountdown();
        }
    }) : null;
    clockObserver?.observe(document.body, {subtree: true, childList: true, characterData: true});
    controller.mount(document.getElementById('assistant-journal-slot'));
    document.dispatchEvent(new global.Event('assistant-journal-ready'));
    // Poll only the journal page; field discovery never changes platform restrictions.
    const timer = setInterval(() => {
        if (global.BrowserAssistantJournal?.current !== controller && global.BrowserAssistantJournal) {stopWatching(); return;}
        if (!document.contains(panel) || storageKey !== `assistantJournal:${location.pathname}`) {
            activeRequest?.abort();
            generation++; global.BrowserAssistantJournalBusy = false; stopWatching(); panel.remove(); return;
        }
        if (!info) refreshInfo();
        void updateCountdown();
        void recordJournalConfirmation();
        notify();
    }, 1000);
    function stopWatching() {
        clearInterval(timer);
        clockObserver?.disconnect();
        document.removeEventListener('keydown', shortcutListener, true);
    }
}
if (typeof window !== 'undefined' && location.origin === 'https://admissions.aurora.edu.in') {
    window.BrowserAssistantJournal = window.BrowserAssistantJournal || {
        current: null,
        opening: false,
        matches: () => /^\/modules\/(?:reflective-journal\/|assessments\/assessments\/?$)/.test(location.pathname),
        active() {return this.current?.path === location.pathname ? this.current : null;},
        getState() {return this.active()?.getState() || {state:this.opening?'OPENING_JOURNAL':'OPEN_JOURNAL', running:this.opening, completed:0, message:'Open the available ongoing journal to prepare a draft. If several are available, select its pencil button first.'};},
        mount(slot) {this.active()?.mount(slot);},
        detach() {this.current?.detach();},
        stop() {this.active()?.stop();this.opening=false;},
        pause() {this.active()?.pause();},
        start() {
            if (this.active()) return this.active().start();
            if (/^\/modules\/reflective-journal\//.test(location.pathname)) {
                browserAssistantJournal(window);
                return this.active()?.start();
            }
            if (this.opening) return;
            const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/modules/reflective-journal/"]')].filter(link =>
                [...(link.closest('tr,[role="row"]')?.querySelectorAll('*') || [])].some(node => /^Ongoing$/i.test(node.textContent.trim())) && link.getClientRects().length
                && new URL(link.href, location.origin).origin === location.origin
                && /^\/modules\/reflective-journal\//.test(new URL(link.href, location.origin).pathname));
            if (links.length === 1) {
                this.opening=true;
                links[0].click();
            }
        },
    };
    if (!window.BrowserAssistantJournalListShortcut) {
        window.BrowserAssistantJournalListShortcut = true;
        document.addEventListener('keydown', event => {
            if (!event.isTrusted || !/^\/modules\/assessments\/assessments\/?$/.test(location.pathname) || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing) return;
            if (event.code !== 'KeyJ' && String(event.key).toLowerCase() !== 'j') return;
            event.preventDefault();
            window.BrowserAssistantJournal.start();
            document.dispatchEvent(new window.Event('assistant-journal-update'));
        }, true);
    }
}
browserAssistantJournal(typeof window === 'undefined' ? globalThis : window);
if (typeof window !== 'undefined' && location.origin === 'https://admissions.aurora.edu.in' && !window.BrowserAssistantJournalBoot) {
    window.BrowserAssistantJournalBoot = true;
    let lastDeadline: number | undefined;
    const storage = window.chrome?.storage?.local;
    let clockChanged = false;
    function updateJournalListClock() {
        const clock = document.getElementById('assistant-journal-list-clock');
        if (!clock) return;
        clock.hidden = /^\/modules\/reflective-journal\//.test(location.pathname) || !Number.isFinite(lastDeadline);
        if (!clock.hidden) {
            const seconds = Math.max(0, Math.ceil((lastDeadline - Date.now()) / 1000));
            clock.textContent = `Last journal · Estimated time left ${formatJournalTime(seconds)}`;
        }
    }
    function loadJournalListClock(saved: unknown) {
        lastDeadline = typeof saved === 'object' && saved !== null && 'deadline' in saved && typeof saved.deadline === 'number'
            ? saved.deadline : undefined;
        updateJournalListClock();
    }
    storage?.onChanged?.addListener(changes => {
        if (!Object.hasOwn(changes, 'assistantJournalTimer')) return;
        clockChanged = true;
        loadJournalListClock(changes.assistantJournalTimer.newValue);
    });
    void storage?.get('assistantJournalTimer').then(data => {
        if (!clockChanged) loadJournalListClock(data.assistantJournalTimer);
    }).catch(() => {});
    setInterval(() => {
        updateJournalListClock();
        if (/^\/modules\/reflective-journal\//.test(location.pathname) && !document.getElementById('assistant-journal')) browserAssistantJournal(window);
    }, 1000);
}
