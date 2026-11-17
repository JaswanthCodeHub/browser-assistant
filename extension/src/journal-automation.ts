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
    function writeField(field, value) {
        const win = field.ownerDocument.defaultView;
        if (field.tagName === 'TEXTAREA') {
            Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set.call(field, value);
        } else {
            field.textContent = value;
        }
        const event = win.InputEvent ? new win.InputEvent('input', {bubbles:true, inputType:'insertText', data:value}) : new win.Event('input', {bubbles:true});
        field.dispatchEvent(event);
        field.dispatchEvent(new win.Event('change', {bubbles:true}));
    }
    const api = {validate, metadata, fields, pageText, readField, writeField, remainingSeconds};
    if (typeof module !== 'undefined') module.exports = api;
    if (!global.document || global.location?.origin !== 'https://admissions.aurora.edu.in') return;
    if (!/^\/modules\/reflective-journal\//.test(global.location.pathname)) return;
    const existing = document.getElementById('assistant-journal');
    const journalBuild = global.chrome?.runtime?.getManifest?.().version || 'development';
    if (existing?.dataset.build === journalBuild) return;
    if (existing && global.BrowserAssistantJournalBusy) return;
    existing?.remove();
    const storageKey = `assistantJournal:${location.pathname}`;
    let info = null, draft = null, running = false, submitting = false, paused = false, starting = false, startIssued = false, generation = 0, idleState = 'READY';
    let filled = false, waitingForTimer = false;
    try { info = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
    const panel = document.createElement('section');
    panel.id = 'assistant-journal';
    panel.dataset.build = journalBuild;
    panel.innerHTML = '<strong>Reflective Journal</strong><p data-info></p><p data-countdown></p><textarea aria-label="Your class experience and feelings" placeholder="Your actual class experience / feelings (optional)" rows="3"></textarea><button type="button">Fill &amp; Submit Journal</button><p role="status" aria-live="polite"></p>';
    document.body.appendChild(panel);
    const controls = document.createElement('div');
    controls.innerHTML = '<label>Subject <select data-subject aria-label="Journal subject"><option value="">Detect from page</option><option>Backend Development Fundamentals</option><option>Computer Organization and Architecture</option><option>Advanced Data Structures</option><option>Linear Algebra Essentials</option><option>Fundamentals of Artificial Intelligence</option></select></label><label>Module / Journal <select data-number aria-label="Journal number"><option value="">Detect from page</option>' + Array.from({length:10},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('') + '</select></label>';
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
        if (!journalConfirmed && (controller.getState().completed === 1 || [...document.querySelectorAll('p,h1,h2,h3,[role=status],[role=alert]')].some(node =>
            !node.closest('#assistant-root,#assistant-journal,[contenteditable]') && node.getClientRects().length &&
            /^(?:journal (?:has been )?submitted successfully|journal submission successful)[.!]?$/i.test(node.textContent.trim())))) {
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
    button.title = 'Fill & Submit Journal (Alt + Shift + J)';
    button.setAttribute('aria-keyshortcuts', 'Alt+Shift+J');
    const shortcutHint = document.createElement('p');
    shortcutHint.textContent = 'Shortcut: Alt + Shift + J';
    panel.insertBefore(shortcutHint, status);
    const shortcutListener = event => {
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing) return;
        if (event.code !== 'KeyJ' && String(event.key).toLowerCase() !== 'j') return;
        if (!document.contains(panel) || storageKey !== `assistantJournal:${location.pathname}`) return;
        event.preventDefault();
        if (!running && !button.disabled) button.click();
    };
    document.addEventListener('keydown', shortcutListener, true);
    function notify() {
        document.dispatchEvent(new global.Event('assistant-journal-update'));
    }
    const controller = {
        path: location.pathname,
        start() {button.click();},
        stop() {
            generation++; draft = null; running = false; paused = false; submitting = false; starting = false;
            filled = false; waitingForTimer = false;
            idleState = 'STOPPED';
            global.BrowserAssistantJournalBusy = false; button.disabled = false;
            status.textContent = 'Stopped. Any text already entered is retained. A submission already sent cannot be cancelled.';
            notify();
        },
        pause() {if (!running || submitting) return; paused = !paused; notify();},
        mount(slot) {
            if (!document.getElementById('assistant-root')) return;
            if (slot) {
                if (panel.parentElement !== slot) slot.appendChild(panel);
                panel.style.display = '';
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
            return {running, paused, submitting,
                state: paused ? 'PAUSED' : submitting ? 'SUBMITTING' : starting ? 'STARTING_ASSESSMENT' : waitingForTimer ? 'WAITING_FOR_TIMER' : running ? (draft ? 'WAITING_FOR_FORM' : 'PREPARING') : /confirmed by the page/.test(status.textContent) ? 'COMPLETED' : idleState,
                message: paused ? 'Paused. Resume to continue filling and submission.' : status.textContent || 'Start fills 400 words (80 per section), then submits when the portal timer reaches 30:00 remaining.',
                title: info ? `${info.subject} · Module ${info.number}` : 'Select subject and module',
                completed: /confirmed by the page/.test(status.textContent) ? 1 : 0};
        },
    };
    if (global.BrowserAssistantJournal) {global.BrowserAssistantJournal.current = controller;global.BrowserAssistantJournal.opening = false;}
    function assertCurrentPage() {
        if (!document.contains(panel) || storageKey !== `assistantJournal:${location.pathname}`) throw Error('Journal page changed. Filling and submission stopped.');
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
    async function fillAndSubmit() {
        if (!draft || submitting || paused || starting) return;
        const run = generation;
        assertCurrentPage();
        let inputs = fields(document);
        if (!inputs) {
            starting = true;
            try {
                // The user explicitly requested automatic declaration/start handling.
                const declarations = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(box => {
                    if (box.closest('#assistant-root,#assistant-journal') || box.disabled || !box.getClientRects().length) return false;
                    const associated = [...(box.labels || []), ...document.querySelectorAll('label')].filter(label => label.contains(box) || (box.id && label.getAttribute('for') === box.id));
                    const text = [box.getAttribute('aria-label') || '', ...associated.map(label => label.textContent)].join(' ').replace(/\s+/g, ' ');
                    return /I confirm this is my own original work/i.test(text);
                });
                if (!startIssued) {
                    if (declarations.length !== 1) throw Error('Could not uniquely identify the journal declaration checkbox. Start stopped.');
                    if (run !== generation || paused) return;
                    status.textContent = 'Accepting the journal declaration and starting the assessment…'; notify();
                    if (!declarations[0].checked) declarations[0].click();
                    await new Promise(resolve => setTimeout(resolve, 250));
                    if (run !== generation || paused) return;
                    assertCurrentPage();
                    const starts = [...document.querySelectorAll('button')].filter(b => !b.closest('#assistant-root,#assistant-journal') && b.getClientRects().length && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && /^(?:Start Assessment|Accept Terms to Start)$/i.test(b.textContent.trim()));
                    if (starts.length !== 1) throw Error('Journal Start Assessment button is unavailable or ambiguous.');
                    startIssued = true;
                    starts[0].click();
                }
                for (let attempt = 0; attempt < 30; attempt++) {
                    if (run !== generation || paused) return;
                    assertCurrentPage();
                    inputs = fields(document);
                    if (inputs) break;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                if (!inputs) throw Error('The journal started, but all five writing fields did not appear. Submission stopped.');
            } finally { if (run === generation) starting = false; }
        }
        if (run !== generation || paused) return;
        if (!inputs) return;
        submitting = true;
        try {
            validate(draft.sections);
            if (!filled) {
                // Existing complete text is adopted only by an explicit Start.
                if (keys.some(k => readField(inputs[k]).trim())) throw Error('Journal already contains text. Nothing was overwritten.');
                for (const key of keys) writeField(inputs[key], draft.sections[key]);
                await new Promise(resolve => setTimeout(resolve, 700));
                if (run !== generation) return;
                filled = true;
            }
            assertCurrentPage();
            const current = fields(document);
            if (!current || keys.some(k => readField(current[k]).trim() !== draft.sections[k].trim())) throw Error('The page did not retain all journal fields. Submission stopped.');
            const count = validate(Object.fromEntries(keys.map(k => [k, readField(current[k])])));
            const remaining = remainingSeconds(document);
            if (remaining === null || remaining > 30*60) {
                waitingForTimer = true;
                const time=remaining === null ? 'Waiting for the portal timer to become readable.'
                    : `Current timer: ${formatJournalTime(remaining)}.`;
                status.textContent = `${count} words ready. Waiting to submit at 30:00 remaining. ${time}`;
                return;
            }
            if (paused) return;
            waitingForTimer = false;
            if (remaining === 0) throw Error('The portal timer expired. Check the journal status; no automatic click was sent.');
            const candidates = [...document.querySelectorAll('button')].filter(b => !panel.contains(b) && b.getClientRects().length && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && /^Submit Journal$/i.test(b.textContent.trim()));
            if (candidates.length !== 1) throw Error('Could not uniquely identify an enabled Submit Journal button. Content is filled; submit manually.');
            // Consume the draft before clicking: observers must never submit twice.
            draft = null;
            candidates[0].click();
            status.textContent = `${count} words filled. Submit clicked; checking the result…`;
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (run !== generation) return;
            const dialogs = [...document.querySelectorAll('[role=dialog],dialog[open]')].filter(d => d.getClientRects().length);
            const confirm = dialogs.flatMap(d => [...d.querySelectorAll('button')]).filter(b => !b.disabled && /^(?:Confirm(?: Submission| Submit)?|Yes,? Submit|Submit Journal)$/i.test(b.textContent.trim()));
            if (confirm.length === 1) confirm[0].click();
            await new Promise(resolve => setTimeout(resolve, 1200));
            if (run !== generation) return;
            const page = document.body.cloneNode(true) as HTMLElement;
            page.querySelector('#assistant-journal')?.remove();
            status.textContent = /(?:journal|reflection)\s+(?:has been\s+)?submitted successfully|successfully submitted|submission successful/i.test(page.textContent)
                ? `${count} words. Submission confirmed by the page.`
                : `${count} words filled; Submit clicked. Check the page for confirmation or any remaining dialog.`;
        } catch (error) { if (run === generation) {draft = null; filled = false; waitingForTimer = false; idleState = 'ERROR'; status.textContent = error.message;} }
        finally { if (run === generation) {submitting = false; if (!waitingForTimer) {running = false; global.BrowserAssistantJournalBusy = false; button.disabled = false;} notify();} }
    }
    button.addEventListener('click', async () => {
        if (running) return;
        try { assertCurrentPage(); } catch (error) {status.textContent = error.message; return;}
        refreshInfo();
        const manualSubject = controls.querySelector<HTMLSelectElement>('[data-subject]').value;
        const manualNumber = controls.querySelector<HTMLInputElement>('[data-number]').value;
        if (!controls.hidden && Boolean(manualSubject) !== Boolean(manualNumber)) {
            status.textContent = 'For manual selection, choose both Subject and Module / Journal.';
            return;
        }
        if (!info) { status.textContent = 'Select both Subject and Module / Journal above, then click Fill & Submit Journal.'; return; }
        running = true; global.BrowserAssistantJournalBusy = true; submitting = false; button.disabled = true;
        idleState = 'READY';
        paused = false;
        filled = false; waitingForTimer = false;
        startIssued = false;
        const run = ++generation;
        status.textContent = 'Preparing the matching module journal…';
        notify();
        try {
            const existingInputs = fields(document);
            if (existingInputs && keys.some(key => readField(existingInputs[key]).trim())) {
                const existingSections = Object.fromEntries(keys.map(key => [key,readField(existingInputs[key]).trim()]));
                validate(existingSections);
                draft = {sections: existingSections};
                filled = true;
            } else {
                const response = await chrome.runtime.sendMessage({action: 'apiRequest', path: '/journal', body: {...info, notes: panel.querySelector('textarea').value}});
                if (run !== generation) return;
                assertCurrentPage();
                if (!response?.ok) {
                    const detail = response?.data?.detail || response?.error || 'Journal generation failed.';
                    if (typeof detail === 'string' && detail.includes('Subject does not uniquely match the supplied syllabus')) {
                        throw Error('The running server could not match this subject. If you just added this syllabus, restart the updated server once, then try again. Otherwise check the selected subject. No journal was submitted.');
                    }
                    throw Error(typeof detail === 'string' ? detail : detail.message || 'Journal generation failed.');
                }
                validate(response.data.sections);
                draft = response.data;
            }
            status.textContent = 'Content ready. Filling the journal, then waiting for 30:00 remaining before submission…';
            notify();
            await fillAndSubmit();
        } catch (error) { if (run !== generation) return; draft = null; filled = false; waitingForTimer = false; running = false; idleState = 'ERROR'; global.BrowserAssistantJournalBusy = false; button.disabled = false; status.textContent = String(error.message); notify(); }
    });
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
    try {
        const pending = JSON.parse(sessionStorage.getItem('assistantPendingJournal') || 'null');
        if (pending?.path === location.pathname && Date.now() - pending.createdAt < 300000) {
            sessionStorage.removeItem('assistantPendingJournal');
            button.click();
        }
    } catch { /* Opening the journal without auto-start remains available. */ }
    // Poll only the journal page; field discovery never changes platform restrictions.
    const timer = setInterval(() => {
        if (global.BrowserAssistantJournal?.current !== controller && global.BrowserAssistantJournal) {stopWatching(); return;}
        if (!document.contains(panel) || storageKey !== `assistantJournal:${location.pathname}`) {
            draft = null; global.BrowserAssistantJournalBusy = false; stopWatching(); panel.remove(); return;
        }
        if (!info) refreshInfo();
        void updateCountdown();
        void recordJournalConfirmation();
        notify();
        if (draft && !submitting && !starting) {
            const run = generation;
            void fillAndSubmit().catch(error => {
                if (run !== generation) return;
                draft = null; filled = false; waitingForTimer = false; running = false; idleState = 'ERROR';
                global.BrowserAssistantJournalBusy = false; button.disabled = false; status.textContent = error.message; notify();
            });
        }
    }, 1000);
    function stopWatching() {
        clearInterval(timer);
        clockObserver?.disconnect();
        document.removeEventListener('keydown', shortcutListener, true);
    }
}
if (typeof window !== 'undefined' && location.origin === 'https://admissions.aurora.edu.in') {
    const ongoingJournalStartLink = (): HTMLAnchorElement | null => {
        const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/modules/reflective-journal/"]')].filter(link =>
            [...(link.closest('tr,[role="row"]')?.querySelectorAll('*') || [])].some(node => /^Ongoing$/i.test(node.textContent.trim())) && link.getClientRects().length
            && new URL(link.href, location.origin).origin === location.origin
            && /^\/modules\/reflective-journal\//.test(new URL(link.href, location.origin).pathname));
        return links.length === 1 ? links[0] : null;
    };
    window.BrowserAssistantJournal = window.BrowserAssistantJournal || {
        current: null,
        opening: false,
        matches: () => /^\/modules\/(?:reflective-journal\/|assessments\/assessments\/?$)/.test(location.pathname),
        active() {return this.current?.path === location.pathname ? this.current : null;},
        getState() {return this.active()?.getState() || {state:this.opening?'OPENING_JOURNAL':'OPEN_JOURNAL', running:this.opening, completed:0, message:'Click Start to open the available ongoing journal. If several are available, select its pencil button first.'};},
        mount(slot) {this.active()?.mount(slot);},
        detach() {this.current?.detach();},
        stop() {this.active()?.stop();this.opening=false;try {sessionStorage.removeItem('assistantPendingJournal');} catch {}},
        pause() {this.active()?.pause();},
        getStartLink() {return ongoingJournalStartLink();},
        start() {
            if (this.active()) return this.active().start();
            if (/^\/modules\/reflective-journal\//.test(location.pathname)) {
                browserAssistantJournal(window);
                return this.active()?.start();
            }
            if (this.opening) return;
            const link = ongoingJournalStartLink();
            if (link) {
                this.opening=true;
                try {sessionStorage.setItem('assistantPendingJournal', JSON.stringify({path:new URL(link.href, location.origin).pathname,createdAt:Date.now()}));} catch {}
                link.click();
            }
        },
    };
    if (!window.BrowserAssistantJournalListShortcut) {
        window.BrowserAssistantJournalListShortcut = true;
        document.addEventListener('keydown', event => {
            if (!/^\/modules\/assessments\/assessments\/?$/.test(location.pathname) || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing) return;
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
