// Browser Assistant Content Script v3.0 — High Accuracy Edition

function mountJournalCountdown(signal: AbortSignal) {
    const storage = chrome.storage.local;
    const badge = document.createElement('div');
    badge.id = 'assistant-journal-countdown-badge';
    const clock = document.createElement('span');
    clock.setAttribute('role', 'timer');
    badge.attachShadow({mode: 'closed'}).append(clock);
    let timers: AssistantJournalTimer[] = [];
    let tick: number | undefined;
    let revision = 0;

    function renderCountdown() {
        window.clearTimeout(tick);
        if (signal.aborted) return;
        const now = Date.now();
        const active = timers.filter(timer => timer.deadline > now);
        const path = location.pathname.replace(/\/$/, '');
        const aurora = location.origin === 'https://admissions.aurora.edu.in';
        const visible = active.filter(timer => !aurora || (path.startsWith('/modules/reflective-journal/') && timer.path !== path));
        if (!visible.length) badge.remove();
        else {
            const times = visible.map(timer => {
                const seconds = Math.ceil((timer.deadline - now) / 1000);
                return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
            });
            clock.textContent = `${times.length === 1 ? 'Journal time left' : 'Journal times left'} ≈ ${times.join(' · ')}`;
            if (!badge.isConnected) document.body.appendChild(badge);
        }
        if (active.length && !document.hidden) tick = window.setTimeout(renderCountdown, 1000);
    }

    async function refreshCountdown() {
        const request = ++revision;
        try {
            const next = await chrome.runtime.sendMessage<AssistantMessage, AssistantJournalTimer[]>({action: 'journalCountdowns'});
            if (request !== revision || signal.aborted) return;
            timers = Array.isArray(next) ? next : [];
            renderCountdown();
        } catch { /* Reloading the extension can invalidate the old tab context. */ }
    }

    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>) => {
        if (Object.keys(changes).some(key => key.startsWith('assistantJournalTimer') || key.startsWith('assistantJournalConfirmed:'))) {
            void refreshCountdown();
        }
    };
    storage.onChanged.addListener(onStorageChange);
    document.addEventListener('visibilitychange', renderCountdown, {signal});
    signal.addEventListener('abort', () => {
        window.clearTimeout(tick);
        storage.onChanged.removeListener(onStorageChange);
        badge.remove();
    }, {once: true});
    void refreshCountdown();
    return badge;
}

(function () {
    // Abort on pages without a body (about:blank, PDFs, XML docs, etc.)
    if (!document.body) return;
    const extensionVersion = chrome.runtime.getManifest().version;

    const lifecycle = new AbortController();
    const pendingTimeouts = new Set<number>();
    const scheduleTimeout = window.setTimeout.bind(window);
    let disposed = false;
    const setTimeout = (fn, delay) => {
        if (disposed) return 0;
        const id = scheduleTimeout(() => {pendingTimeouts.delete(id); if (!disposed) fn();},delay);
        pendingTimeouts.add(id);
        return id;
    };
    const navigationCleanup = [];

    console.log("Browser Assistant v3.0 loaded.");

    const SERVER = 'http://localhost:8000';

    const root = document.createElement('div');
    root.id = 'assistant-root';
    document.body.appendChild(root);
    const journalCountdownBadge = ['http:', 'https:'].includes(location.protocol)
        ? mountJournalCountdown(lifecycle.signal) : null;

    // ── Move panel ───────────────────────────────────────────────────────────
    // Drag the header to put the panel anywhere on the current page. The saved
    // location is restored after a refresh on that site.
    const POSITION_KEY = 'browserAssistantPosition';
    let dragState: { dragging: boolean; moved: boolean; collapsedBadge?: boolean; startX: number; startY: number; origX: number; origY: number } = { dragging: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 };
    let suppressNextClick = false;

    function clampPanelPosition(x, y) {
        return {
            x: Math.max(0, Math.min(window.innerWidth - root.offsetWidth, x)),
            y: Math.max(0, Math.min(window.innerHeight - root.offsetHeight, y)),
        };
    }

    function setPanelPosition(x, y) {
        const position = clampPanelPosition(x, y);
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.left = `${position.x}px`;
        root.style.top = `${position.y}px`;
        return position;
    }

    function restorePanelPosition() {
        try {
            const saved = JSON.parse(localStorage.getItem(POSITION_KEY));
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                requestAnimationFrame(() => setPanelPosition(saved.x, saved.y));
            }
        } catch { /* Position persistence is optional. */ }
    }

    function initDrag() {
        root.addEventListener('pointerdown', (event) => {
            // The expanded panel moves by its header; the collapsed round badge
            // itself is also draggable.
            const isHeader = (event.target as Element).closest('.assistant-header');
            const isCollapsedBadge = (event.target as Element).closest('.assistant-tab.collapsed');
            if ((!isHeader && !isCollapsedBadge) || ((event.target as Element).closest('button') && !isCollapsedBadge)) return;
            const rect = root.getBoundingClientRect();
            dragState = {
                dragging: true,
                moved: false,
                collapsedBadge: Boolean(isCollapsedBadge),
                startX: event.clientX,
                startY: event.clientY,
                origX: rect.left,
                origY: rect.top,
            };
            root.setPointerCapture?.(event.pointerId);
            root.classList.add('assistant-dragging');
            event.preventDefault();
        });

        root.addEventListener('pointermove', (event) => {
            if (!dragState.dragging) return;
            if (Math.abs(event.clientX - dragState.startX) > 4 || Math.abs(event.clientY - dragState.startY) > 4) {
                dragState.moved = true;
            }
            setPanelPosition(
                dragState.origX + event.clientX - dragState.startX,
                dragState.origY + event.clientY - dragState.startY,
            );
        });

        const stopDragging = () => {
            if (!dragState.dragging) return;
            suppressNextClick = dragState.moved;
            dragState.dragging = false;
            root.classList.remove('assistant-dragging');
            try {
                const rect = root.getBoundingClientRect();
                localStorage.setItem(POSITION_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
            } catch { /* Position persistence is optional. */ }
            // Some browsers do not emit a click after a pointer drag. Clear the
            // guard shortly afterwards so the user's next deliberate click on
            // the badge always opens the panel.
            if (suppressNextClick) {
                setTimeout(() => { suppressNextClick = false; }, 250);
            }
            // Pointer capture retargets the eventual click to the root, so a
            // stationary badge press must open here rather than lose its click.
            if (!dragState.moved && dragState.collapsedBadge) openPanel();
        };
        root.addEventListener('pointerup', stopDragging);
        root.addEventListener('pointercancel', stopDragging);
        root.addEventListener('click', (event) => {
            if (!suppressNextClick) return;
            suppressNextClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        window.addEventListener('resize', () => {
            const rect = root.getBoundingClientRect();
            if (root.style.left) setPanelPosition(rect.left, rect.top);
        }, {signal:lifecycle.signal});
    }

    initDrag();
    restorePanelPosition();

    let isCollapsed = true;
    // Scan type and visible tab are intentionally separate. Switching away
    // from QA Control must never stop an authorized automation run.
    let selectedMode = 'auto'; // 'auto', 'mcq', 'aptitude', 'code'
    let selectedTab = 'auto'; // 'auto', 'mcq', 'aptitude', 'code', 'qa'
    let isMinimalMode = false;
    let lastResultSummary = "";
    let isHidden = false;
    let serverOnline = null; // null = unknown, true/false = checked
    let isScanning = false;
    let extensionAlive = true; // false after extension reload invalidates context
    let historyItems = [];
    let isHistoryOpen = false;
    const automationPolicy = window.BrowserAssistantAutomationPolicy;
    const automation: AssistantAutomationState = {
        state: 'IDLE', running: false, paused: false, runId: 0,
        processed: new Set(), completed: 0, error: '', currentSignature: '',
    };

    const updateListener = (request, _sender, sendResponse) => {
        const busy = automation.running || isScanning || Boolean(window.BrowserAssistantJournalBusy);
        if (request.action === 'assistantUpdateStatus') {sendResponse({busy});return false;}
        if (request.action !== 'assistantPrepareUpdate') return false;
        if (busy) {sendResponse({ready:false});return false;}
        try {sessionStorage.setItem('browserAssistantReopenAfterUpdate',isCollapsed?'false':'true');} catch {}
        disposed = true; extensionAlive = false; automation.runId++;
        lifecycle.abort();
        for (const cleanup of navigationCleanup) cleanup();
        for (const timer of pendingTimeouts) window.clearTimeout(timer);
        pendingTimeouts.clear(); root.remove();
        chrome.runtime.onMessage.removeListener(updateListener);
        sendResponse({ready:true});
        return false;
    };
    chrome.runtime.onMessage.addListener(updateListener);
    document.addEventListener('assistant-journal-update', updateAutomationUI, {signal:lifecycle.signal});
    document.addEventListener('assistant-journal-ready', () => {
        if (!window.BrowserAssistantJournal?.matches()) return;
        selectedTab = 'qa'; isCollapsed = false; isHidden = false; root.style.display = 'block'; render();
    }, {signal:lifecycle.signal});

    function getAutomationContext() {
        const target = automationPolicy?.resolveTarget(window.location, document) || null;
        const pageType = target?.pageTypes?.[0] || null;
        const context: AssistantContext = {
            authorizationVerified: Boolean(target),
            target: target ? { ...target, authorized: true } : { authorized: false },
            page: { type: pageType, authorized: Boolean(target && pageType) },
        };
        context.mode = automationPolicy?.determineMode(context) || 'ASSIST';
        return context;
    }

    function getAutomationAdapter(context = getAutomationContext()) {
        return context.mode === 'FULL' ? automationPolicy?.getAdapter(context.target.adapter) || null : null;
    }

    function normalizeAutomationText(value) {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    function questionSignature(questionText, options) {
        return `${normalizeAutomationText(questionText)}|${options.map(option => normalizeAutomationText(option.text)).join('|')}`;
    }

    function hasSameQuestionOptions(before, after) {
        if (!before || !after || before.options.length !== after.options.length) return false;
        if (normalizeAutomationText(before.identityText || before.text) !== normalizeAutomationText(after.identityText || after.text)) return false;
        return before.options.every((option, index) =>
            normalizeAutomationText(option.identityText || option.text) === normalizeAutomationText(after.options[index]?.identityText || after.options[index]?.text),
        );
    }

    function getAuthorizedQuestion(context = getAutomationContext()) {
        // The dashboard contains mentor feedback radios, not quiz answers.
        if (window.location.origin === 'https://learning.ccbp.in' && window.location.pathname === '/') return null;
        // Problem-list filters are checkboxes, not an MCQ question.
        if (window.location.pathname.replace(/\/$/, '') === '/problems-set') return null;
        const adapter = getAutomationAdapter(context);
        if (!adapter || !automationPolicy.canExecute('detect', context) || !automationPolicy.canExecute('read', context)) return null;
        const coding = window.BrowserAssistantCoding?.getQuestion(document);
        if (coding) {
            // CCBP re-renders description content while an answer is being
            // generated (images, examples and status UI can change). Its
            // CCBP's UUID route uniquely identifies the problem. Its title can
            // disappear when React replaces the description, so neither the
            // title nor a prefix of mutable example text is an identity there.
            const stableRoute = window.location.origin === 'https://learning.ccbp.in'
                && /^\/question\/[a-f0-9-]{36}\/?$/i.test(window.location.pathname);
            const identity = stableRoute ? '' : (normalizeAutomationText(coding.title)
                || normalizeAutomationText(coding.text).slice(0, 240));
            return { ...coding, signature: `code:${window.location.pathname}:${coding.language}:${identity}` };
        }
        const question = adapter.getQuestion(document);
        if (!question || !normalizeAutomationText(question.text) || (question.type !== 'short-answer' && question.options.length < 2)) return null;
        return { ...question, text: normalizeAutomationText(question.text), options: question.options.map((option, index) => ({
            ...option, index, text: normalizeAutomationText(option.text),
        })), signature: questionSignature(question.identityText || question.text, question.options)
            + (window.BrowserAssistantQuestionVisuals?.nodes(question).length ? `|visual:${window.BrowserAssistantQuestionVisuals.fingerprint(question)}` : '') };
    }

    const AUTO_RESUME_KEY = 'browserAssistantResumeAuthorizedQa';

    function questionDetectionError() {
        const codingPage = window.location.origin === 'https://learning.ccbp.in'
            && /^\/question\//.test(window.location.pathname);
        if (codingPage) return window.BrowserAssistantCoding?.getDetectionError()
            || 'The coding question/editor has not finished loading.';
        return 'The question/options did not finish loading or could not be identified. Restart on the current question.';
    }

    async function waitForReadableQuestion(runId, timeoutMs = 15000) {
        let deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline && automation.running && automation.runId === runId) {
            const pausedAt = Date.now();
            if (!(await waitWhilePaused(runId))) return null;
            deadline += Date.now() - pausedAt;
            const context = getAutomationContext();
            if (context.mode !== 'FULL' || context.target.id !== automation.targetId) return null;
            const question = getAuthorizedQuestion(context);
            if (question) return question;
            automation.state = 'WAITING_FOR_QUESTION'; updateAutomationUI();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
    }
    let lastObservedAutomationUrl = window.location.href;
    function revalidateAutomationAfterNavigation() {
        const currentUrl = window.location.href;
        const navigated = currentUrl !== lastObservedAutomationUrl;
        lastObservedAutomationUrl = currentUrl;
        if (navigated && automation.running) {
            const context = getAutomationContext();
            if (automation.pendingNavigation && context.mode === 'FULL' && context.target.id === automation.targetId) {
                automation.pendingNavigation = false;
                updateAutomationUI();
                return;
            }
            stopAutomation('NAVIGATED');
            return;
        }
        if (!automation.running) {
            updateAutomationUI();
            return;
        }
        const context = getAutomationContext();
        if (context.mode !== 'FULL' || context.target.id !== automation.targetId) {
            stopAutomation('UNAUTHORIZED');
            return;
        }
        updateAutomationUI();
    }

    function watchSpaNavigation() {
        const check = () => setTimeout(revalidateAutomationAfterNavigation, 0);
        window.addEventListener('popstate', check, {signal:lifecycle.signal});
        window.addEventListener('hashchange', check, {signal:lifecycle.signal});
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            const wrapped = function (...args) {
                const result = original.apply(this, args);
                check();
                return result;
            };
            history[method] = wrapped;
            navigationCleanup.push(()=>{if(history[method]===wrapped)history[method]=original;});
        }
        const navigationTimer = setInterval(() => {
            if (window.location.href !== lastObservedAutomationUrl) revalidateAutomationAfterNavigation();
        }, 500);
        navigationCleanup.push(()=>clearInterval(navigationTimer));
    }
    watchSpaNavigation();

    function answerIndexesFromResult(results, question) {
        const raw = results?.[0]?.answer;
        if (!Array.isArray(results) || results.length !== 1 || (typeof raw !== 'string' && typeof raw !== 'number')) return [];
        const answer = String(raw).trim();
        if (!answer) return [];
        const normalize = value => value.trim().replace(/\r\n/g, '\n').replace(/(\d) +%/g, '$1%');
        const matrixSyntax = /\\begin\{(?:[bpBvV]?matrix|smallmatrix)\}/;
        const matrixQuestion = matrixSyntax.test(question.text ?? '') || question.options.some(option => matrixSyntax.test(option.text));
        const matrixKey = (value: string) => {
            const text = value.trim().replace(/^\${1,2}|\${1,2}$/g, '')
                .replace(/^\\[\[(]|\\[\])]$/g, '').trim().replace(/−/g, '-');
            const latex = /^\\begin\{([bpBvV]?matrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}$/.exec(text);
            const array = /^\[\s*(\[[^\[\]]+\](?:\s*,\s*\[[^\[\]]+\])*)\s*\]$/.exec(text);
            const rows = latex ? latex[2].split(/\\\\/).map(row => row.split('&'))
                : array ? [...array[1].matchAll(/\[([^\[\]]+)\]/g)].map(row => row[1].split(',')) : [];
            const cells = rows.map(row => row.map(cell => cell.trim()));
            return cells.length && cells.every(row => row.length === cells[0].length
                && row.every(cell => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cell))) ? JSON.stringify(cells) : '';
        };
        const matchesOption = (option: string, candidate: string) => {
            if (normalize(option) === normalize(candidate)) return true;
            const matrix = matrixQuestion && matrixKey(option);
            return Boolean(matrix && matrix === matrixKey(candidate));
        };
        const choices = question.selectionType === 'multiple'
            ? answer.split(/;\s*(?=(?:option\s+)?[a-z]\s*[:.)])/i) : [answer];
        const indexes = choices.map(choice => {
            const labeled = /^(?:option\s+)?([a-z])\s*[:.)]\s*(\S[\s\S]*)$/i.exec(choice.trim());
            if (labeled) {
                const index = labeled[1].toUpperCase().charCodeAt(0) - 65;
                const option = question.options[index];
                return option && matchesOption(option.text, labeled[2]) ? index : -1;
            }
            const matches = question.options.map((option, index) => matchesOption(option.text, choice) ? index : -1)
                .filter(index => index >= 0);
            return matches.length === 1 ? matches[0] : -1;
        });
        return indexes.includes(-1) || new Set(indexes).size !== indexes.length ? [] : indexes;
    }

    function updateAutomationUI() {
        if (disposed) return;
        const status = document.getElementById('assistant-automation-status');
        const statusBadge = document.getElementById('assistant-automation-state');
        const page = document.getElementById('assistant-automation-page');
        const completed = document.getElementById('assistant-automation-completed');
        const question = document.getElementById('assistant-automation-question');
        const progress = document.getElementById('assistant-automation-progress');
        const latest = document.getElementById('assistant-automation-latest');
        const start = document.getElementById('assistant-auto-start-btn') as HTMLButtonElement;
        const pause = document.getElementById('assistant-auto-pause-btn') as HTMLButtonElement;
        const stop = document.getElementById('assistant-auto-stop-btn') as HTMLButtonElement;
        const journal = window.BrowserAssistantJournal;
        if (journal?.matches()) {
            const current = journal.getState();
            journal.mount(document.getElementById('assistant-journal-slot'));
            if (status) status.textContent = `Build ${extensionVersion} · Reflective Journal · ${current.state}`;
            if (statusBadge) {statusBadge.textContent = current.state; statusBadge.dataset.state = current.state.toLowerCase();}
            if (page) page.textContent = 'Aurora · Reflective Journal';
            if (completed) completed.textContent = String(current.completed || 0);
            if (question) question.textContent = current.title || 'Select an ongoing reflective journal';
            if (progress) progress.textContent = `${current.completed || 0} / 1`;
            if (latest) {latest.textContent = current.message; latest.classList.remove('has-error');}
            if (start) {start.disabled = current.running; start.textContent = '▶ Start journal automation';}
            if (pause) {pause.disabled = !current.running || current.submitting; pause.textContent = current.paused ? 'Resume' : 'Pause';}
            if (stop) stop.disabled = !current.running;
            const diagnostic = document.getElementById('assistant-export-question-btn');
            if (diagnostic) diagnostic.hidden = true;
            return;
        }
        if (start) start.textContent = '▶ Start automation';
        const diagnostic = document.getElementById('assistant-export-question-btn');
        if (diagnostic) diagnostic.hidden = false;
        const context = getAutomationContext();
        const authorized = context.mode === 'FULL';
        const currentQuestion = automation.batch?.title || (automation.running && automation.codingQuestionText)
            || (authorized ? getAuthorizedQuestion(context)?.text : '');
        const pageName = authorized ? context.target.id : window.location.hostname;
        const deferred = automation.deferredQuestions?.size ?? 0;
        if (status) {
            status.textContent = authorized
                ? `Build ${extensionVersion} · ${context.target.id}: ${automation.state} · Completed: ${automation.completed}${automation.error ? ` · ${automation.error}` : ''}`
                : `Assist Mode — ${window.location.origin} is not authorized by target policy.`;
        }
        if (statusBadge) {
            statusBadge.textContent = automation.state;
            statusBadge.dataset.state = automation.state.toLowerCase();
        }
        if (page) page.textContent = pageName;
        if (completed) completed.textContent = String(automation.completed);
        if (question) question.textContent = currentQuestion || '—';
        if (progress) progress.textContent = deferred ? `${automation.completed} completed · ${deferred} deferred` : `${automation.completed} / —`;
        if (latest) {
            const reviewing = ['WAITING_FOR_REVIEW', 'DEFERRING_QUESTION', 'REVIEW_NEEDED'].includes(automation.state);
            latest.textContent = automation.error
                ? reviewing ? automation.error : `⚠ ${automation.error}`
                : authorized
                    ? `Current status: ${automation.state.replace(/_/g, ' ').toLowerCase()}.`
                    : 'Automation is available only on an authorized QA page.';
            latest.classList.toggle('has-error', Boolean(automation.error) && !reviewing);
        }
        if (start) start.disabled = !authorized || automation.running;
        if (pause) { pause.disabled = !automation.running; pause.textContent = automation.paused ? 'Resume' : 'Pause'; }
        if (stop) stop.disabled = !automation.running;
    }

    function pauseOrResumeAutomation() {
        if (window.BrowserAssistantJournal?.matches()) {window.BrowserAssistantJournal.pause(); updateAutomationUI(); return;}
        if (!automation.running) return;
        automation.paused = !automation.paused;
        automation.state = automation.paused ? 'PAUSED' : 'DETECTING';
        updateAutomationUI();
    }

    function stopAutomation(reason = 'STOPPED') {
        if (window.BrowserAssistantJournal?.matches()) {window.BrowserAssistantJournal.stop(); updateAutomationUI(); return;}
        try { sessionStorage.removeItem('browserAssistantCodingBatch'); } catch { /* Stop must work when site storage is blocked. */ }
        automation.batch = null;
        automation.runId += 1;
        automation.running = false;
        automation.paused = false;
        automation.pendingNavigation = false;
        automation.state = reason;
        if (reason === 'REVIEW_NEEDED') automation.error = 'Review deferred questions on the portal.';
        updateAutomationUI();
    }

    async function waitWhilePaused(runId) {
        while (automation.running && automation.paused && automation.runId === runId) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return automation.running && automation.runId === runId;
    }

    async function waitForOptionSelection(question, index, runId) {
        const started = Date.now();
        let deadline = started + 2500;
        let settledSince = null;
        while (Date.now() < deadline && automation.running && automation.runId === runId) {
            if (!(await waitWhilePaused(runId))) return null;
            const context = getAutomationContext();
            if (context.mode !== 'FULL' || !automationPolicy.canExecute('validate', context)) return null;
            const fresh = getAuthorizedQuestion(context);
            // Never trust detached pre-click nodes, or confirmation on a
            // different question that arrived during an asynchronous render.
            if (fresh && !hasSameQuestionOptions(question, fresh)) return null;
            if (getAutomationAdapter(context)?.getSubmittedAdvance?.(document)) {
                return { ...(fresh || question), submitted: true };
            }
            const option = fresh?.options[index];
            const saving = option?.getSaveState?.() === 'saving' || getAutomationAdapter(context)?.isSaving?.(document);
            if (saving) {
                deadline = started + 30000;
                settledSince = null;
                automation.state = 'WAITING_FOR_SAVE'; updateAutomationUI();
            } else if (option && (option.isSelected?.() || option.input?.checked)) {
                if (settledSince === null) settledSince = Date.now();
                if (Date.now() - settledSince >= 150) return fresh;
            } else settledSince = null;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return null;
    }

    async function waitForQuestionSubmit(question, runId, adapter, answerIndexes, answerText) {
        let deadline = Date.now() + 15000;
        while (Date.now() < deadline && automation.running && automation.runId === runId) {
            const pausedAt = Date.now();
            if (!(await waitWhilePaused(runId))) return null;
            deadline += Date.now() - pausedAt;
            const context = getAutomationContext();
            if (context.mode !== 'FULL' || context.target.id !== automation.targetId
                || getAutomationAdapter(context)?.id !== adapter.id
                || !automationPolicy.canExecute('submit', context)) {
                throw new Error('Target policy does not permit submission on this page.');
            }
            const fresh = getAuthorizedQuestion(context);
            if (fresh && fresh.signature !== question.signature) {
                throw new Error('Question changed before submission. No Submit was clicked.');
            }
            if (adapter.isSaving?.(document)) {
                automation.state = 'WAITING_FOR_SAVE'; updateAutomationUI();
            } else if (adapter.getSubmittedAdvance?.(document)) {
                return { submitted: true };
            } else if (fresh) {
                if ((question.type === 'short-answer' && fresh.input?.value !== answerText)
                    || (answerIndexes && question.type !== 'short-answer' && question.type !== 'ordering'
                        && fresh.options.some(option => Boolean(option.isSelected?.() || option.input?.checked) !== answerIndexes.includes(option.index)))) {
                    throw new Error('The selected answer changed while waiting. No Submit was clicked.');
                }
                const button = adapter.getSubmit(document, fresh);
                if (button?.isConnected && button.getClientRects().length && !button.disabled
                    && button.getAttribute('aria-disabled') !== 'true') return { button };
                automation.state = 'WAITING_FOR_SUBMIT'; updateAutomationUI();
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (automation.running && automation.runId === runId) {
            throw new Error('The portal did not enable a unique Submit button within 15 seconds. The selected answer was kept.');
        }
        return null;
    }

    async function waitForPracticeTransition(previousSignature, runId) {
        let deadline = Date.now() + 15000;
        while (Date.now() < deadline && automation.running && automation.runId === runId) {
            if (!(await waitWhilePaused(runId))) return false;
            const context = getAutomationContext();
            const adapter = getAutomationAdapter(context);
            if (context.mode !== 'FULL') return false;
            const blocked = adapter?.getBlockingReason?.(document);
            if (blocked) return { blocked };
            if (adapter?.isComplete(document)) return 'complete';
            if (adapter?.isWaitingForParticipants?.(document)) {
                deadline = Date.now() + 15000;
                automation.state = 'WAITING_FOR_CLASS'; updateAutomationUI();
                await new Promise(resolve => setTimeout(resolve, 250));
                continue;
            }
            const next = getAuthorizedQuestion(context);
            if (next && next.signature !== previousSignature
                && (previousSignature !== null || !adapter?.getSubmittedAdvance?.(document))) return 'next';
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }

    async function submitCompletedQuiz(button, adapter, runId) {
        if (!automationPolicy.canExecute('submit', getAutomationContext())) return false;
        automation.state = 'SUBMITTING_QUIZ'; automation.pendingNavigation = true; updateAutomationUI();
        button.click();
        const deadline = Date.now() + 20000;
        let confirmed = false;
        while (Date.now() < deadline && automation.running && automation.runId === runId) {
            if (!(await waitWhilePaused(runId))) return false;
            const context = getAutomationContext();
            if (context.mode !== 'FULL' || getAutomationAdapter(context)?.id !== adapter.id) return false;
            if (adapter.isComplete(document)) return true;
            const confirmation = adapter.getQuizConfirmation?.(document);
            if (confirmation && !confirmed && automationPolicy.canExecute('submit', context)) {
                confirmed = true;
                confirmation.click();
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }

    async function waitForAdvanceOrTransition(previousSignature, runId, adapter) {
        let deadline = Date.now() + 15000;
        while (Date.now() < deadline && automation.running && automation.runId === runId) {
            if (!(await waitWhilePaused(runId))) return false;
            const context = getAutomationContext();
            if (context.mode !== 'FULL' || getAutomationAdapter(context)?.id !== adapter.id) return false;
            const blocked = adapter.getBlockingReason?.(document);
            if (blocked) return { blocked };
            if (adapter.isComplete(document)) return 'complete';
            const confirmation = adapter.getQuizConfirmation?.(document);
            if (confirmation) return { advance: confirmation, context };
            if (adapter.isWaitingForParticipants?.(document)) {
                deadline = Date.now() + 15000;
                automation.state = 'WAITING_FOR_CLASS'; updateAutomationUI();
                await new Promise(resolve => setTimeout(resolve, 250));
                continue;
            }
            const proceed = adapter.getCompletionProceed?.(document);
            if (proceed) return { proceed, context };
            const nextQuestion = getAuthorizedQuestion(context);
            if (nextQuestion && nextQuestion.signature !== previousSignature) return 'next';
            const advance = adapter.getAdvance?.(document);
            if (advance) return { advance, context };
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }

    async function waitForNextPracticeQuestion(previousUrl, runId) {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && automation.running && automation.runId === runId) {
            if (!(await waitWhilePaused(runId))) return false;
            const context = getAutomationContext();
            if (context.mode !== 'FULL' || context.target.id !== automation.targetId) return false;
            if (window.location.href !== previousUrl && getAuthorizedQuestion(context)) return true;
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        return false;
    }

    function saveCourseResume(stage, context, details = {}) {
        try {
            sessionStorage.setItem(AUTO_RESUME_KEY, JSON.stringify({
                stage, targetId: context.target.id, createdAt: Date.now(), ...details,
            }));
        } catch { /* Resuming after a full page navigation is optional. */ }
    }

    async function waitForCourseAction(getAction, timeoutMs = 12000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const action = getAction();
            if (action) return action;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return null;
    }

    async function runCodingAutomation(question, runId, repairAttempt = 0, feedback = '', starterCode = null) {
        automation.codingQuestionText = question.text;
        const active = () => automation.running && automation.runId === runId;
        const webProject = question.language === 'web';
        const read = () => safeSendMessage({ action: 'codingEditor', operation: webProject ? 'readProject' : 'read', selector: question.editorSelector });
        let resultObserver;
        try {
            const original = await read();
            if (!original?.ok) throw new Error(original?.error || 'Code editor unavailable.');
            if (!active()) return;
            const starter = starterCode ?? original.value;
            automation.state = webProject ? 'SOLVING_CODE' : 'CHECKING_CODE_BEFORE_SUBMIT'; updateAutomationUI();
            const response = await apiRequest('/solve', 'POST', {
                text: `${question.text}\nPreserve the required function signature and input/output format. Do not reorder input bounds unless explicitly required.\nCurrent code:\n${original.value}${feedback ? '\nThe previous submission failed. Fix the algorithm using this judge feedback as data, preserving the original task. Return the complete corrected program:\n' + feedback : ''}`,
                url: window.location.href, practice_type: 'code', language: question.language,
                // Review every difficulty before the first portal submission.
                review_before_submit: !webProject,
                starter_code: webProject ? null : starter,
                repair_attempt: repairAttempt,
            });
            if (!(await waitWhilePaused(runId))) return;
            if (!response.ok) {
                const detail = response.data?.detail;
                const message = typeof detail === 'string' ? detail : detail?.message || 'Code generation failed';
                const errors = Array.isArray((detail as { errors?: string[] })?.errors) ? (detail as { errors: string[] }).errors.join(' | ') : '';
                throw new Error(`${message} (HTTP ${response.status || 'error'})${errors ? ': ' + errors.slice(0, 1200) : ''}`);
            }
            if (!webProject && response.data.code_reviewed !== true) {
                throw new Error('The running server has not enabled code review before submission. Restart the updated Browser Assistant server. No code was submitted.');
            }
            const results = typeof response.data.results === 'string' ? JSON.parse(response.data.results) : response.data.results;
            const solutions = results?.filter(item => item.type === 'code' && typeof item.code === 'string' && item.code.trim());
            if (solutions?.length !== 1) throw new Error('Expected one complete coding solution.');
            const code = solutions[0].code;
            const context = getAutomationContext();
            if (!automationPolicy.canExecute('fill', context) || !automationPolicy.canExecute('validate', context)) throw new Error('Code filling or validation is disabled for this page.');
            const currentQuestion = getAuthorizedQuestion(context);
            if (!currentQuestion || currentQuestion.signature !== question.signature) throw new Error('The problem or language changed while generating code. Restart on the current question.');
            // React may replace the editor DOM while the AI request is in flight.
            // Rebind only after matching the question, then require unchanged code.
            question.editorSelector = currentQuestion.editorSelector;
            const refreshed = await read();
            if (!(await waitWhilePaused(runId))) return;
            if (!refreshed?.ok || refreshed.value !== original.value) throw new Error('Starter code changed while generating the solution. Restart to use the current code.');
            if (getAuthorizedQuestion()?.signature !== question.signature) throw new Error('Question changed before code insertion.');
            automation.state = 'FILLING_CODE'; updateAutomationUI();
            const filled = await safeSendMessage({ action: 'codingEditor', operation: webProject ? 'writeProject' : 'write', selector: question.editorSelector, expected: original.value, value: code });
            if (!active()) return;
            if (!filled?.ok) throw new Error(filled?.error || 'Code insertion failed.');
            if (!(await waitWhilePaused(runId))) return;
            const verified = await read();
            if (!active()) return;
            const current = getAutomationContext();
            if (!verified?.ok || verified.value !== code || getAuthorizedQuestion(current)?.signature !== question.signature) throw new Error('Editor or question changed before submission.');
            const submit = window.BrowserAssistantCoding.getSubmit(document);
            if (!automationPolicy.canExecute('submit', current) || !submit) throw new Error('Code filled. No unique enabled Submit button found.');
            const previousResult = window.BrowserAssistantCoding.getResult(document);
            let resultChanged = false;
            if (webProject && typeof MutationObserver !== 'undefined') {
                const result = document.querySelector('#submitResultContainer');
                if (result?.parentElement) {
                    resultObserver = new MutationObserver(records => {
                        if (records.some(record => (record.target as Element).closest?.('#submitResultContainer')
                            || [...record.addedNodes, ...record.removedNodes].some(node => (node as Element).id === 'submitResultContainer'))) resultChanged = true;
                    });
                    resultObserver.observe(result.parentElement, { childList: true, subtree: true, characterData: true });
                }
            }
            const submissionUrl = window.location.href;
            automation.state = 'SUBMITTING'; updateAutomationUI();
            submit.click();
            automation.state = 'WAITING_FOR_RESULT'; updateAutomationUI();
            const deadline = Date.now() + 60000;
            let sawPending = !previousResult;
            while (Date.now() < deadline) {
                if (!(await waitWhilePaused(runId))) return;
                if (window.location.href !== submissionUrl) throw new Error('Page changed while waiting for the coding result.');
                const afterSubmit = getAuthorizedQuestion();
                // Submissions replaces Description on this portal. Result detection
                // must continue even when the original prompt is no longer mounted.
                if (afterSubmit && afterSubmit.signature !== question.signature) throw new Error('Question changed while waiting for the coding result.');
                const status = window.BrowserAssistantCoding.getResult(document);
                if (!status) sawPending = true;
                if (sawPending || resultChanged || status !== previousResult) {
                    if (status === 'failed') {
                        if (repairAttempt >= 2) throw new Error('Tests still fail after two automatic repairs. Review the latest judge feedback.');
                        const feedback = window.BrowserAssistantCoding.getFailureFeedback(document);
                        if (!feedback) throw new Error('Tests failed, but readable judge feedback was not available.');
                        automation.state = 'REPAIRING_CODE'; updateAutomationUI();
                        const description = window.BrowserAssistantCoding.getDescriptionTab(document);
                        description?.click();
                        const repairDeadline = Date.now() + 15000;
                        while (Date.now() < repairDeadline) {
                            if (!(await waitWhilePaused(runId))) return;
                            if (window.location.href !== submissionUrl) throw new Error('Page changed before repair.');
                            const restored = getAuthorizedQuestion();
                            if (restored?.signature === question.signature) {
                                return await runCodingAutomation(restored, runId, repairAttempt + 1, feedback, starter);
                            }
                            await new Promise(resolve => setTimeout(resolve, 250));
                        }
                        throw new Error('Could not reopen the original description for code repair.');
                    }
                    if (status === 'passed') { automation.completed += 1; if (!automation.batch) stopAutomation('COMPLETED'); return true; }
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            throw new Error('Code submitted; success was not confirmed. Check the judge result.');
        } catch (error) {
            if (!active()) return;
            automation.error = error.message;
            stopAutomation('PAUSED');
        } finally {
            resultObserver?.disconnect();
        }
    }

    const CODING_BATCH_KEY = 'browserAssistantCodingBatch';

    function codingQuestionPath(value, baseUrl) {
        if (!value) return '';
        try { return new URL(value, baseUrl).pathname.replace(/\/$/, ''); }
        catch { return ''; }
    }

    function rememberCompletedCodingQuestion(batch) {
        batch.done ||= [];
        batch.doneUrls ||= [];
        if (batch.title && !batch.done.includes(batch.title)) batch.done.push(batch.title);
        const path = codingQuestionPath(batch.questionUrl, batch.listUrl);
        if (path && !batch.doneUrls.includes(path)) batch.doneUrls.push(path);
    }

    function wasCompletedCodingQuestion(batch, row) {
        const titleSeen = (batch.done || []).includes(row.title);
        const rowPath = codingQuestionPath(row.href, batch.listUrl);
        const urlSeen = Boolean(rowPath && (batch.doneUrls || []).includes(rowPath));
        return titleSeen || urlSeen;
    }

    async function startCodingBatch(saved = null) {
        const context = getAutomationContext();
        if (context.mode !== 'FULL' || !automationPolicy.canExecute('navigate', context)) return;
        const batch = saved || { origin: location.origin, listUrl: location.href, phase: 'list', done: [], doneUrls: [], completed: 0 };
        batch.done ||= [];
        batch.doneUrls ||= [];
        if (batch.origin !== location.origin) return;
        automation.runId += 1;
        const runId = automation.runId;
        automation.running = true; automation.paused = false; automation.error = '';
        automation.targetId = context.target.id; automation.batch = batch;
        automation.completed = batch.completed;
        isCollapsed = false; selectedTab = 'qa'; render();
        const persist = phase => {
            batch.phase = phase; batch.updatedAt = Date.now();
            sessionStorage.setItem(CODING_BATCH_KEY, JSON.stringify(batch));
        };
        const waitFor = async (predicate, timeout = 20000) => {
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                if (!(await waitWhilePaused(runId))) return null;
                const value = predicate();
                if (value) return value;
                // CCBP navigates client-side; short polling keeps the batch
                // moving as soon as its list or next question is rendered.
                await new Promise(resolve => setTimeout(resolve, 125));
            }
            return null;
        };
        const visited = new Set();
        let filterChanges = 0;
        try {
            if (batch.phase === 'busy') throw new Error('Page reloaded during solving/submission. Check the judge result, then restart from the problem list.');
            while (await waitWhilePaused(runId)) {
                if (location.origin !== batch.origin || getAutomationContext().mode !== 'FULL') throw new Error('Batch left its starting website.');
                if (batch.phase === 'question' || batch.phase === 'return') {
                    if (batch.phase === 'question') {
                    automation.state = 'LOADING_QUESTION'; updateAutomationUI();
                    const question = await waitFor(() => {
                        const found = getAuthorizedQuestion();
                        const matches = window.BrowserAssistantCodingBatch.matchesQuestion?.(found, batch, location.href)
                            ?? (found?.type === 'code' && normalizeAutomationText(found.text).toLowerCase().includes(batch.title.toLowerCase()));
                        return matches ? found : null;
                    });
                    if (!automation.running || automation.runId !== runId) return;
                    if (!question) throw new Error(window.BrowserAssistantCoding.getDetectionError() || 'Selected coding question did not load or its title did not match.');
                    persist('busy');
                    const passed = await runCodingAutomation(question, runId);
                    if (!passed || !automation.running || automation.runId !== runId) return;
                    // Keep both title and URL. CCBP may leave a newly accepted
                    // item marked "In Progress" briefly after returning to the
                    // list, so status alone is not enough to prevent a retry.
                    rememberCompletedCodingQuestion(batch); batch.completed = automation.completed;
                    }
                    persist('list');
                    automation.state = 'RETURNING_TO_LIST'; automation.pendingNavigation = true; updateAutomationUI();
                    const back = window.BrowserAssistantCodingBatch.getBackControl(document, batch.listUrl);
                    if (!back) throw new Error('Accepted. Question Bank Back button was not found; return to the list to continue.');
                    back.click();
                    let saveConfirmed = false;
                    const returned = await waitFor(() => {
                        if (location.pathname.replace(/\/$/, '') === new URL(batch.listUrl).pathname.replace(/\/$/, '')
                            && window.BrowserAssistantCodingBatch.pageRange(document)) return true;
                        const yes = window.BrowserAssistantCodingBatch.getSaveBeforeLeaving?.(document);
                        if (yes && !saveConfirmed) {
                            saveConfirmed = true;
                            automation.state = 'SAVING_BEFORE_LEAVING'; updateAutomationUI();
                            yes.click();
                        }
                        return false;
                    });
                    if (!automation.running || automation.runId !== runId) return;
                    if (!returned) throw new Error('Accepted. Back was clicked, but the problem list did not load.');
                    visited.clear(); batch.title = ''; persist('list');
                    continue;
                }
                automation.state = 'FINDING_UNSOLVED'; updateAutomationUI();
                const listReady = await waitFor(() => location.pathname.replace(/\/$/, '') === new URL(batch.listUrl).pathname.replace(/\/$/, '')
                    && window.BrowserAssistantCodingBatch.pageRange(document));
                if (!automation.running || automation.runId !== runId) return;
                if (!listReady) throw new Error('Problem list or pagination count did not load.');
                const filterStep = window.BrowserAssistantCodingBatch.courseFilterStep?.(document);
                if (filterStep?.error) throw new Error(filterStep.error);
                if (filterStep?.control) {
                    if (++filterChanges > 20) throw new Error('Course filters are not updating. Check the filter selection and restart.');
                    automation.state = 'FILTERING_COURSES'; updateAutomationUI();
                    filterStep.control.click();
                    await new Promise(resolve => setTimeout(resolve, 750));
                    continue;
                }
                const rows = window.BrowserAssistantCodingBatch.rows(document);
                const next = rows.find(row => !wasCompletedCodingQuestion(batch, row));
                if (next) {
                    batch.title = next.title; batch.questionUrl = next.href || null; persist('question');
                    automation.state = 'OPENING_QUESTION'; automation.pendingNavigation = true; updateAutomationUI();
                    next.action.click();
                    continue;
                }
                const key = window.BrowserAssistantCodingBatch.pageKey(document);
                if (visited.has(key)) throw new Error('Pagination repeated the same problem list.');
                visited.add(key);
                const range = window.BrowserAssistantCodingBatch.pageRange(document);
                const nextPage = window.BrowserAssistantCodingBatch.nextPage(document);
                if (!nextPage) {
                    if (range && range.end >= range.total) { stopAutomation('COMPLETED'); return; }
                    throw new Error('No Not Attempted or In Progress questions on this page; the next-page control could not be identified.');
                }
                persist('list');
                automation.state = 'NEXT_LIST_PAGE'; automation.pendingNavigation = true; updateAutomationUI();
                nextPage.click();
                const changed = await waitFor(() => {
                    const updated = window.BrowserAssistantCodingBatch.pageRange(document);
                    return updated && updated.start !== range.start;
                });
                if (!automation.running || automation.runId !== runId) return;
                if (!changed) throw new Error('Next problem-list page did not load.');
            }
        } catch (error) {
            if (automation.runId !== runId) return;
            automation.error = error.message; stopAutomation('PAUSED');
        }
    }

    async function resumeCodingBatch() {
        let saved;
        try { saved = JSON.parse(sessionStorage.getItem(CODING_BATCH_KEY) || 'null'); } catch { return false; }
        if (!saved) return false;
        if (saved.origin !== location.origin || Date.now() - saved.updatedAt > 120000) {
            sessionStorage.removeItem(CODING_BATCH_KEY); return false;
        }
        await startCodingBatch(saved);
        return true;
    }

    async function runOnlineIdeAutomation(question: AssistantOnlineIdeQuestion) {
        if (question.solved) {
            stopAutomation('ALREADY_SOLVED');
            return;
        }
        const url = location.href;
        automation.runId += 1;
        const runId = automation.runId;
        automation.running = true;
        automation.paused = false;
        automation.completed = 0;
        automation.error = '';
        automation.codingQuestionText = question.title;
        automation.state = 'PREPARING_APP_JS';
        updateAutomationUI();
        const current = () => location.href === url && automation.runId === runId;
        async function openOnlineIde() {
            let ide = await safeSendMessage({action:'focusOnlineIde'});
            if (!(await waitWhilePaused(runId)) || !current()) return;
            if (!ide?.found) {
                const fresh = window.BrowserAssistantCoding.getOnlineIdeQuestion(document, location);
                if (!fresh || fresh.text !== question.text) throw new Error('The IDE question changed before opening.');
                fresh.button.click();
                const deadline = Date.now() + 10000;
                do {
                    if (!(await waitWhilePaused(runId)) || !current()) return;
                    ide = await safeSendMessage({action:'focusOnlineIde'});
                    if (ide?.found || Date.now() >= deadline) break;
                    await new Promise(resolve => setTimeout(resolve, 500));
                } while (!ide?.found && Date.now() < deadline);
            }
            return ide;
        }
        try {
            const [ide, response] = await Promise.all([openOnlineIde(), apiRequest('/solve', 'POST', {
                url, practice_type:'code', language:'javascript', review_before_submit:true,
                text: `${question.text}\n\nGenerate the complete app.js for the online Node.js IDE. Use the stated database, route methods, response bodies and module format. Use parameterized SQL where applicable. Return source code for app.js only.`,
            })]);
            if (!(await waitWhilePaused(runId)) || !current()) return;
            if (!response?.ok) throw window.BrowserAssistantAnswerRequests.failure(response);
            const solutions = JSON.parse(response.data.results);
            if (!Array.isArray(solutions) || solutions.length !== 1 || solutions[0].type !== 'code'
                || typeof solutions[0].code !== 'string' || !solutions[0].code.trim()) {
                throw new Error('The server did not return a complete app.js solution.');
            }
            const solution = solutions[0];
            let instructions = ide?.found
                ? 'Copy into app.js in the IDE tab after the workspace is ready, then save.'
                : 'Use the portal Open IDE button, then copy into app.js and save.';
            const context = getAutomationContext();
            if (ide?.found && question.workspace && response.data.code_reviewed === true
                && automationPolicy.canExecute('fill',context) && automationPolicy.canExecute('submit',context)) {
                const token = crypto.randomUUID();
                const target = {workspace:question.workspace,token};
                automation.state = 'WAITING_FOR_IDE';
                updateAutomationUI();
                const deadline = Date.now() + 120000;
                let launched;
                do {
                    if (!(await waitWhilePaused(runId)) || !current()) return;
                    launched = await safeSendMessage({action:'runOnlineIde',...target,code:solution.code});
                    if (!launched?.retry) break;
                    await new Promise(resolve=>setTimeout(resolve,1000));
                } while (Date.now() < deadline);
                if (!current()) return;
                if (launched?.alreadyPassed) {stopAutomation('ALREADY_SOLVED'); return;}
                if (launched?.started) {
                    automation.state = 'WAITING_FOR_IDE_GRADING';
                    updateAutomationUI();
                    const resultDeadline = Date.now() + 240000;
                    while (current() && Date.now() < resultDeadline) {
                        if (!(await waitWhilePaused(runId)) || !current()) return;
                        const result = await safeSendMessage({action:'onlineIdeStatus',...target});
                        if (!current()) return;
                        if (result?.done) {
                            if (result.passed) automation.completed = 1;
                            else if (result.saveUnconfirmed) automation.error = 'Code was pasted into app.js, but the saved file did not match. Check app.js and save before running it.';
                            else automation.error = result.submitted ? 'Grading finished. Review the test results in the IDE.' : 'The IDE command finished without a confirmed submission. Check the terminal.';
                            stopAutomation(result.passed ? 'COMPLETED' : 'CHECK_IDE_RESULT');
                            return;
                        }
                        if (result?.ok === false && !result.retry) break;
                        await new Promise(resolve=>setTimeout(resolve,1000));
                    }
                    if (current()) {
                        automation.error = 'The command was sent. Check its result in the IDE terminal.';
                        stopAutomation('CHECK_IDE_RESULT');
                    }
                    return;
                }
                if (launched?.error) instructions = `${launched.error} ${instructions}`;
            }
            stopAutomation('CODE_READY');
            displayResults([{...solution, title:'app.js', approach:[instructions, solution.approach].filter(Boolean).join(' ')}], response.data.provider);
        } catch (error) {
            if (current()) { automation.error = error.message; stopAutomation('ERROR'); }
        } finally {
            if (automation.runId === runId) stopAutomation('STOPPED');
        }
    }

    async function continueAfterUnverifiedQuestion(question, runId, reason, allowSkip = true) {
        if (!(await waitWhilePaused(runId))) return false;
        const initial = getAutomationContext();
        const adapter = getAutomationAdapter(initial);
        if (!adapter || initial.target.id !== automation.targetId) {
            stopAutomation('UNAUTHORIZED');
            return false;
        }
        const fresh = getAuthorizedQuestion(initial);
        const sameQuestion = fresh?.signature === question.signature && hasSameQuestionOptions(question, fresh);
        const practice = initial.target.id === 'ccbp-learning-practice'
            && /^\/(?:default-question|primitive-coding(?:-review)?)\/practice\//.test(location.pathname);
        const hasDraft = fresh?.input?.value?.trim() || fresh?.options.some(option => option.isSelected?.() || option.input?.checked);
        if (allowSkip && practice && sameQuestion && !hasDraft && question.type !== 'ordering'
            && !adapter.isSaving?.(document) && !adapter.getSubmittedAdvance?.(document)
            && automationPolicy.canExecute('click', initial) && automationPolicy.canExecute('validate', initial)) {
            const skip = adapter.getPracticeSkip?.(document, fresh);
            if (skip) {
                automation.state = 'DEFERRING_QUESTION';
                automation.error = reason;
                automation.pendingNavigation = true;
                updateAutomationUI();
                skip.click();
                const transition = await waitForPracticeTransition(question.signature, runId);
                if (!automation.running || automation.runId !== runId) return false;
                automation.pendingNavigation = false;
                if (transition === 'next' || transition === 'complete') {
                    automation.deferredQuestions.add(question.signature);
                    automation.error = '';
                    return true;
                }
            }
        }

        automation.state = 'WAITING_FOR_REVIEW';
        automation.error = `${reason} Use the page controls to review and move to the next question. Automation will continue here.`;
        updateAutomationUI();
        while (await waitWhilePaused(runId)) {
            if (automation.state !== 'WAITING_FOR_REVIEW') {
                automation.state = 'WAITING_FOR_REVIEW';
                updateAutomationUI();
            }
            const context = getAutomationContext();
            const currentAdapter = getAutomationAdapter(context);
            if (context.mode !== 'FULL' || context.target.id !== initial.target.id || currentAdapter?.id !== adapter.id) {
                stopAutomation('UNAUTHORIZED');
                return false;
            }
            const blocked = currentAdapter.getBlockingReason?.(document);
            if (blocked) {
                automation.error = blocked;
                stopAutomation('PAUSED');
                return false;
            }
            if (!currentAdapter.isSaving?.(document)) {
                const current = getAuthorizedQuestion(context);
                if (currentAdapter.getSubmittedAdvance?.(document) || currentAdapter.isComplete(document)
                    || (current && current.signature !== question.signature && !hasSameQuestionOptions(question, current))) {
                    automation.error = '';
                    return true;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        return false;
    }

    async function startPracticeAutomation() {
        if (window.BrowserAssistantJournal?.matches()) {
            await window.BrowserAssistantJournal.start(); updateAutomationUI(); return;
        }
        if (window.location.origin === 'https://learning.ccbp.in' && window.location.pathname === '/') {
            automation.state = 'OPEN_PRACTICE';
            automation.error = 'Open a practice or quiz question first. Mentor feedback on the Home page is not a quiz.';
            updateAutomationUI();
            return;
        }
        // A question opened by the user uses the one-question solver below.
        // Only an explicit Start on the problem list begins a filtered batch.
        // Do not enter the batch's return phase before solving this question.
        if (window.location.pathname.replace(/\/$/, '') === '/problems-set') {
            await startCodingBatch(); return;
        }
        const initialContext = getAutomationContext();
        const adapter = getAutomationAdapter(initialContext);
        if (initialContext.mode !== 'FULL' || !adapter) {
            automation.state = 'UNAUTHORIZED';
            automation.error = 'This origin or page is not authorized.';
            updateAutomationUI();
            return;
        }
        const onlineIde = window.BrowserAssistantCoding?.getOnlineIdeQuestion?.(document, location);
        if (onlineIde && automationPolicy.canExecute('navigate', initialContext)) {
            await runOnlineIdeAutomation(onlineIde);
            return;
        }
        // Course instruction pages have no options yet. Start the selected
        // practice first, then resume when its first question is available.
        if (!getAuthorizedQuestion(initialContext)) {
            const startPractice = adapter.getStartPractice?.(document);
            if (startPractice && automationPolicy.canExecute('navigate', initialContext)) {
                automation.state = 'STARTING_PRACTICE';
                automation.targetId = initialContext.target.id;
                updateAutomationUI();
                saveCourseResume('solve', initialContext);
                startPractice.click();
                setTimeout(() => { void resumeAuthorizedQaAfterNavigation(); }, 900);
                return;
            }
        }
        automation.runId += 1;
        const runId = automation.runId;
        automation.running = true;
        automation.paused = false;
        automation.error = '';
        automation.completed = 0;
        automation.deferredQuestions = new Set();
        automation.targetId = initialContext.target.id;
        automation.pendingNavigation = false;
        automation.currentSignature = null;
        automation.processed.clear();
        updateAutomationUI();

        while (automation.running && automation.runId === runId) {
            if (!(await waitWhilePaused(runId))) break;
            const context = getAutomationContext();
            const currentAdapter = getAutomationAdapter(context);
            if (context.mode !== 'FULL' || currentAdapter?.id !== adapter.id) { stopAutomation('UNAUTHORIZED'); break; }
            const blocked = currentAdapter.getBlockingReason?.(document);
            if (blocked) { automation.error = blocked; stopAutomation('PAUSED'); break; }
            if (currentAdapter.isSaving?.(document)) {
                automation.state = 'WAITING_FOR_SAVE'; updateAutomationUI();
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }
            const finalSubmit = currentAdapter.getFinalQuizSubmit?.(document);
            if (finalSubmit) {
                const submitted = await submitCompletedQuiz(finalSubmit, currentAdapter, runId);
                if (!automation.running || automation.runId !== runId) break;
                if (!submitted) automation.error = 'Final Submit was clicked; the portal did not show a submission confirmation. Check its status.';
                stopAutomation(submitted ? 'COMPLETED' : 'PAUSED');
                break;
            }
            if (currentAdapter.isWaitingForParticipants?.(document)) {
                automation.state = 'WAITING_FOR_CLASS'; updateAutomationUI();
                await new Promise(resolve => setTimeout(resolve, 250));
                continue;
            }
            const submittedAdvance = currentAdapter.getSubmittedAdvance?.(document);
            if (submittedAdvance) {
                if (!automationPolicy.canExecute('click', context)) {
                    automation.error = 'Target policy does not permit Next.'; stopAutomation('UNAUTHORIZED'); break;
                }
                const previousSignature = getAuthorizedQuestion(context)?.signature || automation.currentSignature;
                automation.state = 'OPENING_NEXT_QUESTION'; updateAutomationUI();
                submittedAdvance.click();
                const transition = await waitForPracticeTransition(previousSignature, runId);
                if (!automation.running || automation.runId !== runId) break;
                if (transition === 'next' || transition === 'complete') {
                    automation.completed += 1;
                    automation.deferredQuestions.delete(previousSignature);
                }
                if (transition === 'complete') { stopAutomation(automation.deferredQuestions.size ? 'REVIEW_NEEDED' : 'COMPLETED'); break; }
                if (transition !== 'next') {
                    automation.error = (transition as { blocked?: string })?.blocked || 'Next question did not appear after the submitted answer.'; stopAutomation('PAUSED'); break;
                }
                continue;
            }
            if (currentAdapter.isComplete(document)) {
                if (automation.deferredQuestions.size) {
                    stopAutomation('REVIEW_NEEDED');
                    break;
                }
                const nextPractice = currentAdapter.getNextPractice?.(document);
                if (!nextPractice) { stopAutomation('COMPLETED'); break; }
                if (!automationPolicy.canExecute('navigate', context) && !automationPolicy.canExecute('click', context)) {
                    stopAutomation('COMPLETED');
                    break;
                }
                automation.state = 'OPENING_NEXT_PRACTICE';
                automation.pendingNavigation = true;
                updateAutomationUI();
                const previousUrl = window.location.href;
                try {
                    sessionStorage.setItem(AUTO_RESUME_KEY, JSON.stringify({ targetId: automation.targetId, fromUrl: previousUrl, createdAt: Date.now() }));
                } catch { /* Resuming after a full page navigation is optional. */ }
                nextPractice.click();
                if (!(await waitForNextPracticeQuestion(previousUrl, runId))) {
                    automation.error = 'Next practice did not load in time.';
                    stopAutomation('PAUSED');
                    break;
                }
                continue;
            }
            automation.state = 'DETECTING'; updateAutomationUI();
            let question = getAuthorizedQuestion(context);
            if (!question) question = await waitForReadableQuestion(runId);
            if (!automation.running || automation.runId !== runId) break;
            if (!question) {
                automation.error = questionDetectionError();
                stopAutomation('PAUSED'); break;
            }
            if (question.type === 'code') { await runCodingAutomation(question, runId); break; }
            if (automation.deferredQuestions.has(question.signature)) {
                automation.currentSignature = question.signature;
                if (await continueAfterUnverifiedQuestion(question, runId, 'This question was deferred earlier.', false)) continue;
                break;
            }
            if (automation.processed.has(question.signature)) { automation.error = 'Repeated question detected.'; stopAutomation('PAUSED'); break; }
            automation.currentSignature = question.signature;
            automation.state = 'SOLVING'; updateAutomationUI();
            let response;
            try {
                let requestText = question.text;
                if (location.origin === 'https://learning.ccbp.in' && /^\/primitive-coding\/practice\//.test(location.pathname)
                    && document.querySelector('.ace_editor,.monaco-editor,.CodeMirror')) {
                    const snapshot = await readMcqSnippetSnapshot(question, runId);
                    if (!snapshot?.ok) throw new Error(snapshot?.error || 'Full code snippet could not be read.');
                    if (!(await waitWhilePaused(runId))) break;
                    const fresh = getAuthorizedQuestion();
                    if (!hasSameQuestionOptions(question, fresh)) throw new Error('Question changed while reading the code.');
                    // The snapshot fills option code from full models, not the
                    // rows visible when this question was initially detected.
                    question = fresh;
                    automation.currentSignature = question.signature;
                    question.codeSnapshot = JSON.stringify(snapshot.editorSources || snapshot.sources);
                    if (snapshot.sources.length) requestText = `${question.identityText || question.text}\nComplete code snippets:\n${snapshot.sources.join('\n\n')}`;
                }
                const requestBody = {
                    text: `${requestText}\nQuestion format: ${question.type === 'short-answer' ? 'Free response. Return only the exact value to enter in the JSON answer field, without an option label, explanation, or Markdown.' : question.selectionType === 'multiple' ? 'select all that apply; return every correct option as "Option A: ...; Option B: ...".' : 'select one answer.'}\n${question.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option.text}`).join('\n')}`,
                    ...(question.type === 'ordering' ? { text: `${question.text}\nReorder ALL items. Return the complete permutation as a JSON array of 1-based item numbers in the answer field (example: [2,1,3]). Check every item appears exactly once.\n${question.options.map((option, index) => `${index + 1}. ${option.text}`).join('\n')}` } : {}),
                    url: window.location.href, practice_type: 'mcq', verify_answer: true,
                };
                const visuals = window.BrowserAssistantQuestionVisuals;
                if (visuals?.nodes(question).length) {
                    automation.state = 'READING_CHART'; updateAutomationUI();
                    await visuals.requireBackend(apiRequest, visuals.nodes(question).length);
                    const snapshot = await visuals.capture(question, safeSendMessage);
                    if (!(await waitWhilePaused(runId))) break;
                    const fresh = getAuthorizedQuestion();
                    if (!hasSameQuestionOptions(question, fresh) || visuals.fingerprint(fresh) !== snapshot.fingerprint) {
                        throw new Error('Question or illustration changed while loading. Please restart.');
                    }
                    question.visualSnapshot = snapshot.fingerprint;
                    automation.state = 'SOLVING'; updateAutomationUI();
                    response = await requestPracticeAnswer(question, runId, '/solve-vision', {
                        image:snapshot.images[0], images:snapshot.images.slice(1),
                        text:requestBody.text, url:requestBody.url, practice_type:'mcq', verify_answer:true,
                    });
                } else {
                    response = await requestPracticeAnswer(question, runId, '/solve', requestBody);
                }
            } catch (error) {
                if (!automation.running || automation.runId !== runId) break;
                automation.error = error.message || 'Local AI server unavailable.';
                if (['answer_unconfirmed', 'vision_unconfirmed'].includes(error.code)) {
                    if (await continueAfterUnverifiedQuestion(question, runId, automation.error)) continue;
                } else stopAutomation('ERROR');
                break;
            }
            if (!automation.running || automation.runId !== runId || !response) break;
            automation.error = ''; automation.state = 'SOLVING'; updateAutomationUI();
            if (response.data?.answer_verified !== true) {
                automation.error = 'Answer verification is required. Restart the updated Browser Assistant backend.';
                stopAutomation('PAUSED'); break;
            }
            let results;
            try { results = JSON.parse(response.data.results); } catch { automation.error = 'AI returned an invalid answer.'; stopAutomation('ERROR'); break; }
            if (!Array.isArray(results) || results.length !== 1 || results[0]?.type !== 'mcq') {
                automation.error = 'Expected one verified answer for the current question.';
                stopAutomation('PAUSED'); break;
            }
            if (question.codeSnapshot) {
                let snapshot;
                try { snapshot = await readMcqSnippetSnapshot(question, runId); } catch { snapshot = null; }
                if (!automation.running || automation.runId !== runId) break;
                if (!snapshot?.ok || JSON.stringify(snapshot.editorSources || snapshot.sources) !== question.codeSnapshot) {
                    automation.error = 'The full code snippet changed while solving. Restart on the current question.';
                    stopAutomation('PAUSED'); break;
                }
            }
            const shortAnswer = question.type === 'short-answer';
            const ordering = question.type === 'ordering';
            const rawAnswer = results?.[0]?.answer;
            const answerText = typeof rawAnswer === 'string' || typeof rawAnswer === 'number' ? String(rawAnswer).trim() : '';
            let answerIndexes = shortAnswer ? (answerText ? [0] : []) : answerIndexesFromResult(results, question);
            if (ordering) {
                try {
                    const order = Array.isArray(rawAnswer) ? rawAnswer : JSON.parse(answerText);
                    answerIndexes = Array.isArray(order) && order.length === question.options.length && new Set(order).size === order.length
                        && order.every(value => Number.isInteger(value) && value >= 1 && value <= order.length) ? order.map(value => value - 1) : [];
                } catch { answerIndexes = []; }
            }
            const currentContext = getAutomationContext();
            let current = getAuthorizedQuestion(currentContext);
            if (question.visualSnapshot && (!current || window.BrowserAssistantQuestionVisuals.fingerprint(current) !== question.visualSnapshot)) {
                automation.error = 'Question illustration changed while solving. No answer was selected.';
                stopAutomation('PAUSED'); break;
            }
            // Syntax highlighting can rewrite a visible code block while the
            // AI call is in flight. The ordered option set is the action
            // target, so keep the safety check focused on it rather than on
            // transient code-block markup.
            if (!answerIndexes.length || !current || !hasSameQuestionOptions(question, current)) {
                automation.error = !answerIndexes.length ? 'The verified answer did not match the displayed options exactly.' : !current ? 'Question controls disappeared while solving.' : 'Question text or options changed while solving. Please retry.';
                if (!answerIndexes.length && current?.signature === question.signature && hasSameQuestionOptions(question, current)) {
                    if (await continueAfterUnverifiedQuestion(question, runId, automation.error)) continue;
                    break;
                }
                stopAutomation('PAUSED'); break;
            }
            if (!automationPolicy.canExecute('select', currentContext) || !automationPolicy.canExecute('validate', currentContext)) { automation.error = 'Target policy does not permit selection or validation.'; stopAutomation('UNAUTHORIZED'); break; }
            automation.state = 'SELECTING'; updateAutomationUI();
            if (ordering) {
                const active = () => automation.running && automation.runId === runId && getAutomationContext().mode === 'FULL';
                const nativeDrag = (prompt, options, from, to) => safeSendMessage({ action: 'orderingDrag', prompt, options, from, to });
                if (!(await currentAdapter.applyOrder(document, current, answerIndexes, active, nativeDrag))) {
                    automation.error = 'Drag-and-drop order could not be verified. This page may need a different drag adapter.'; stopAutomation('PAUSED'); break;
                }
                const reordered = getAuthorizedQuestion();
                if (!reordered || reordered.text !== question.text || !answerIndexes.every((index, position) => reordered.options[position]?.text === question.options[index].text)) {
                    automation.error = 'Reordered question changed unexpectedly.'; stopAutomation('PAUSED'); break;
                }
                question.signature = reordered.signature;
            }
            if (shortAnswer) {
                if (current.type !== 'short-answer' || !automationPolicy.canExecute('fill', currentContext)) { automation.error = 'Answer field changed or filling is disabled.'; stopAutomation('PAUSED'); break; }
                const field = current.input;
                const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, answerText);
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
                if (field.value !== answerText) { automation.error = 'Answer entry could not be verified.'; stopAutomation('PAUSED'); break; }
            }
            if (!shortAnswer && !ordering && current.selectionType === 'multiple') {
                for (const option of current.options) {
                    if (!answerIndexes.includes(option.index) && (option.isSelected?.() || option.input?.checked)) (option.input || option.control)?.click();
                }
            }
            for (const answerIndex of shortAnswer || ordering ? [] : answerIndexes) {
                const option = current.options[answerIndex];
                if (!option || (!option.isSelected?.() && !option.input?.checked)) (option?.input || option?.control)?.click();
                const selected = await waitForOptionSelection(question, answerIndex, runId);
                if (!automation.running || automation.runId !== runId) break;
                if (!selected) { automation.error = 'Selection could not be verified.'; stopAutomation('PAUSED'); break; }
                current = selected;
                if (current.submitted) break;
            }
            if (!automation.running) break;
            if (current.submitted || currentAdapter.getSubmittedAdvance?.(document)) continue;
            if (!shortAnswer && !ordering && current.selectionType === 'multiple' && current.options.some(option => Boolean(option.isSelected?.() || option.input?.checked) !== answerIndexes.includes(option.index))) {
                automation.error = 'Multiple-answer selection could not be verified.'; stopAutomation('PAUSED'); break;
            }
            let ready;
            try { ready = await waitForQuestionSubmit(question, runId, currentAdapter, answerIndexes, answerText); }
            catch (error) { automation.error = error.message; stopAutomation('PAUSED'); break; }
            if (!ready || !automation.running || automation.runId !== runId) break;
            if (ready.submitted) continue;
            const submit = ready.button;
            automation.state = 'SUBMITTING'; updateAutomationUI();
            automation.processed.add(question.signature);
            submit.click();
            automation.state = 'WAITING_FOR_NEXT'; updateAutomationUI();
            let transition = await waitForAdvanceOrTransition(question.signature, runId, currentAdapter);
            if ((transition as { proceed?: HTMLElement })?.proceed) {
                automation.state = 'OPENING_COURSE';
                automation.pendingNavigation = true;
                updateAutomationUI();
                saveCourseResume('course', (transition as { context: AssistantContext }).context, {
                    currentTitle: currentAdapter.getCurrentPracticeTitle?.(document) || '',
                });
                (transition as { proceed: HTMLElement }).proceed.click();
                return;
            }
            if ((transition as { advance?: HTMLElement })?.advance) {
                if (!automationPolicy.canExecute('click', (transition as { context: AssistantContext }).context)) { automation.error = 'Target policy does not permit Next.'; stopAutomation('UNAUTHORIZED'); break; }
                (transition as { advance: HTMLElement }).advance.click();
                transition = await waitForPracticeTransition(question.signature, runId);
            }
            if (transition === 'complete') {
                automation.completed += 1;
                stopAutomation(automation.deferredQuestions.size ? 'REVIEW_NEEDED' : 'COMPLETED');
                break;
            }
            if (transition !== 'next') { automation.error = (transition as { blocked?: string })?.blocked || 'Next question did not appear in time.'; stopAutomation('PAUSED'); break; }
            automation.completed += 1;
        }
    }

    async function readMcqSnippetSnapshot(question, runId) {
        let lastError = 'Full code snippet could not be read.';
        for (let attempt=0;attempt<3;attempt++) {
            if (!(await waitWhilePaused(runId))) return null;
            if (!hasSameQuestionOptions(question,getAuthorizedQuestion())) throw new Error('Question changed while reading the full code snippet.');
            let snapshot;
            try {snapshot=await safeSendMessage({action:'mcqSnippets'});} catch(error) {lastError=error.message;}
            if (snapshot?.ok && snapshot.sources?.length) {
                if (typeof browserAssistantCacheMcqSnippets === 'function') browserAssistantCacheMcqSnippets(snapshot);
                return snapshot;
            }
            if (snapshot?.ok && !snapshot.sources?.length) lastError='The full snippet editor is still loading; no source was returned.';
            if (snapshot?.error) lastError=snapshot.error;
            // Some pages block MAIN-world injection. The isolated reader can
            // still recover an Ace snippet if its DOM proves every row exists.
            if (typeof browserAssistantReadMcqSnippets === 'function') {
                const fallback=browserAssistantReadMcqSnippets();
                if (fallback.ok && fallback.sources.length) {
                    if (typeof browserAssistantCacheMcqSnippets === 'function') browserAssistantCacheMcqSnippets(fallback);
                    return fallback;
                }
            }
            if (attempt<2) await new Promise(resolve=>setTimeout(resolve,attempt===0?200:500));
        }
        throw new Error(lastError);
    }

    async function requestPracticeAnswer(question, runId, path, body) {
        return window.BrowserAssistantAnswerRequests.run({
            request:()=>apiRequest(path,'POST',body),
            active:()=>automation.running && automation.runId===runId,
            ready:()=>waitWhilePaused(runId),
            current:()=>{
                if (location.href!==body.url) return false;
                const fresh=getAuthorizedQuestion();
                return hasSameQuestionOptions(question,fresh) && (!question.visualSnapshot
                    || window.BrowserAssistantQuestionVisuals.fingerprint(fresh)===question.visualSnapshot);
            },
            onRetry:({attempt,attempts,message})=>{
                automation.state='RETRYING_REQUEST';
                automation.error=`Temporary answer service issue. Retrying ${attempt}/${attempts}: ${message}`;
                updateAutomationUI();
            },
            sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
        });
    }

    /**
     * Safely send a message to the background script.
     * Handles:
     *  - Extension context invalidated (after reload/update)
     *  - No response from background (unknown action)
     *  - Timeout (background hung)
     */
    function safeSendMessage(msg: AssistantMessage, timeoutMs = 10000): Promise<AssistantMessageResponse> {
        if (!extensionAlive) {
            return Promise.reject(new Error("Extension was reloaded — please refresh the page"));
        }
        return new Promise<AssistantMessageResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error("Background script did not respond (timeout)"));
            }, timeoutMs);
            try {
                chrome.runtime.sendMessage(msg, (response) => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        const errMsg = chrome.runtime.lastError.message || "";
                        if (errMsg.includes("Extension context invalidated")) {
                            extensionAlive = false;
                        }
                        reject(new Error(errMsg || "Message failed"));
                    } else {
                        resolve(response);
                    }
                });
            } catch (e) {
                clearTimeout(timer);
                if (e.message && e.message.includes("Extension context invalidated")) {
                    extensionAlive = false;
                }
                reject(e);
            }
        });
    }

    // Route local API traffic through the extension service worker instead of
    // the page context, so visited sites cannot directly access the API.
    async function apiRequest(path: string, method = 'POST', body?: object) {
        const response = await safeSendMessage(
            { action: 'apiRequest', path, method, body },
            370000,
        );
        if (!response) throw new Error('Local server did not respond');
        if (response.error) throw new Error(response.error);
        return response;
    }

    async function saveScanHistory(results, provider, scanType, language = null) {
        try {
            const response = await apiRequest('/history', 'POST', {
                scan_type: scanType,
                url: window.location.href,
                provider: provider || 'unknown',
                results: JSON.stringify(results),
                language,
            });
            if (!response.ok) throw new Error('History could not be saved');
        } catch (error) {
            // Answers remain available even if optional history persistence fails.
            console.warn('History save failed:', error.message);
        }
    }

    async function openHistory() {
        isHistoryOpen = true;
        render();
        renderHistoryLoading();
        try {
            const response = await apiRequest('/history', 'GET');
            if (!response.ok) throw new Error((response.data?.detail as string) || 'Could not load history');
            historyItems = response.data?.items || [];
            renderHistory();
        } catch (error) {
            renderHistoryError(error.message);
        }
    }

    async function clearHistory() {
        const button = document.getElementById('assistant-clear-history-btn') as HTMLButtonElement;
        if (button) { button.disabled = true; button.textContent = 'Clearing…'; }
        try {
            const response = await apiRequest('/history', 'DELETE');
            if (!response.ok) throw new Error('Could not clear history');
            historyItems = [];
            renderHistory();
        } catch (error) {
            renderHistoryError(error.message);
        }
    }

    // ── Server health check ───────────────────────────────────────────────────
    async function checkServer() {
        try {
            const res = await apiRequest('/health', 'GET');
            serverOnline = res.ok;
        } catch {
            serverOnline = false;
        }
        // Re-render if panel is open to show status
        if (!isCollapsed) render();
    }

    // Check once on load
    checkServer();

    // ── Smart text extraction ────────────────────────────────────────────────
    function extractSmartText() {
        const textLimit = ['code','mcq'].includes(detectPracticeType()) ? 60000 : 12000;
        /**
         * Instead of grabbing ALL page text (which includes navigation, ads,
         * footers, etc.), this function extracts only question-relevant content.
         * Falls back to full body text if smart extraction finds nothing.
         */

        // A user-highlighted question is the strongest possible signal.
        const selectedText = window.getSelection?.().toString().trim();
        if (selectedText && selectedText.length >= 10) {
            console.log(`Using selected text: ${selectedText.length} chars`);
            return selectedText.substring(0, textLimit);
        }

        // Priority 1: Try to find the main content area
        const contentSelectors = [
            // Common question/problem containers
            '[class*="question"]',
            '[class*="problem"]',
            '[class*="challenge"]',
            '[class*="exercise"]',
            '[class*="quiz"]',
            '[class*="test-"]',
            '[class*="exam"]',
            '[class*="mcq"]',
            '[class*="task-"]',
            '[id*="question"]',
            '[id*="problem"]',
            '[id*="challenge"]',
            // Code editors and output areas
            '[class*="editor"]',
            '[class*="code-"]',
            '[class*="CodeMirror"]',
            '[class*="monaco"]',
            '[class*="ace_editor"]',
            // Common content wrappers
            'main',
            'article',
            '[role="main"]',
            '[class*="content-area"]',
            '[class*="main-content"]',
            '[class*="practice"]',
            '[class*="assessment"]',
        ];

        let smartText = '';
        const seen = new Set();

        for (const selector of contentSelectors) {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // Skip our own assistant UI
                    if (el.closest('#assistant-root')) return;
                    const text = (el as HTMLElement).innerText?.trim();
                    if (text && text.length > 20 && !seen.has(text)) {
                        seen.add(text);
                        smartText += text + '\n\n';
                    }
                });
            } catch (e) {
                // Selector might be invalid, skip
            }
        }

        // If smart extraction got meaningful content, use it
        if (smartText.length > 100) {
            console.log(`Smart extraction: ${smartText.length} chars from targeted selectors`);
            return smartText.substring(0, textLimit);
        }

        // Fallback: Use full body text but strip common noise
        console.log("Smart extraction fallback: using cleaned body text");
        return cleanBodyText(textLimit);
    }

    function cleanBodyText(textLimit = 12000) {
        /**
         * Extract body text while removing common noise elements
         * (navigation, footer, ads, sidebars, etc.)
         */
        const noiseSelectors = [
            'script', 'style', 'noscript', 'template', 'input[type="password"]',
            'nav', 'footer', 'header',
            '[class*="sidebar"]', '[class*="nav"]',
            '[class*="footer"]', '[class*="header"]',
            '[class*="menu"]', '[class*="toolbar"]',
            '[class*="cookie"]', '[class*="banner"]',
            '[class*="advertisement"]', '[class*="ad-"]',
            '[class*="social"]', '[class*="share"]',
            '[role="navigation"]', '[role="banner"]',
            '[role="complementary"]',
            '#assistant-root',
        ];

        // Clone body to avoid modifying the real DOM
        const clone = document.body.cloneNode(true) as HTMLElement;

        // Remove noise elements from the clone
        noiseSelectors.forEach(sel => {
            try {
                clone.querySelectorAll(sel).forEach(el => el.remove());
            } catch (e) { /* skip invalid selectors */ }
        });

        // textContent works on detached nodes; innerText requires layout
        const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        return text.substring(0, textLimit);
    }

    // ── Panel open/close helpers (idempotent) ──────────────────────────────
    /**
     * OPEN the panel. Idempotent: if already open, does nothing.
     * Does NOT trigger a scan — just shows the UI.
     */
    function openPanel() {
        if (!isCollapsed && !isHidden) return; // already open — no-op
        isHidden = false;
        isCollapsed = false;
        root.style.display = 'block';
        render();
    }

    /**
     * CLOSE the panel. Idempotent: if already closed, does nothing.
     * Collapses to badge AND hides it completely.
     */
    function closePanel() {
        if (isCollapsed && isHidden) return; // already closed — no-op
        isCollapsed = true;
        isHidden = true;
        root.style.display = 'none';
    }

    function handleAutomationShortcut(e) {
        if (e.repeat || e.isComposing || e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey
            || (e.code !== 'KeyA' && String(e.key).toLowerCase() !== 'a')) return false;
        e.preventDefault();
        e.stopPropagation();
        selectedTab = 'qa'; isHidden = false; isCollapsed = false;
        root.style.display = 'block'; render();
        const journal = window.BrowserAssistantJournal;
        if (journal?.matches() && journal.getState().running) {
            journal.pause(); updateAutomationUI();
        } else if (automation.running) {
            pauseOrResumeAutomation();
        } else {
            void startPracticeAutomation().catch(error => {
                automation.error = error.message || 'Automation could not start.';
                stopAutomation('ERROR');
            });
        }
        return true;
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        // Block held-key auto-repeat to prevent rapid-fire race conditions
        if (e.repeat || e.isComposing) return;
        // Explicit automation chord also works while the code editor has focus.
        if (handleAutomationShortcut(e)) return;

        const active = document.activeElement;
        const isTyping =
            active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement ||
            active instanceof HTMLSelectElement ||
            (active as HTMLElement)?.isContentEditable ||
            active?.getAttribute?.('role') === 'textbox';

        if (isTyping) return;

        switch (e.key) {
            // ── ` = OPEN panel ──
            case '`':
                e.preventDefault();
                e.stopPropagation();
                openPanel();
                break;

            // ── ] = CLOSE panel ──
            case ']':
                e.preventDefault();
                e.stopPropagation();
                closePanel();
                break;

            // ── \ = Vision scan (opens + scans screenshot) ──
            case '\\':
                e.preventDefault();
                e.stopPropagation();
                openPanel();
                visionScan();
                break;

            // ── [ = Toggle minimal mode ──
            case '[':
                e.preventDefault();
                e.stopPropagation();
                isMinimalMode = !isMinimalMode;
                render();
                break;
        }
    }, {capture:true,signal:lifecycle.signal});

    // ── Vision scan ───────────────────────────────────────────────────────────
    async function visionScan(continueExistingScan: boolean | Event = false, requestedLanguage = null, practiceType = selectedMode) {
        if (isScanning && !continueExistingScan) return;
        const scanWasAlreadyRunning = isScanning;
        isScanning = true;
        isCollapsed = false;
        render();
        setLoading("Capturing screen…");

        let timeoutId;
        let panelVisibility = '';
        const countdownVisibility = journalCountdownBadge?.style.visibility;
        try {
            // Keep extension UI out of the captured screenshot.
            panelVisibility = root.style.visibility;
            root.style.visibility = 'hidden';
            if (journalCountdownBadge) journalCountdownBadge.style.visibility = 'hidden';
            const context = await prepareVisionQuestionContext();
            const visuals = window.BrowserAssistantQuestionVisuals;
            let images;
            if (context.question && visuals?.nodes(context.question).length) {
                setLoading('Reading complete question illustrations…');
                const snapshot = await visuals.capture(context.question, safeSendMessage);
                images = snapshot.images;
                context.visualSnapshot = snapshot.fingerprint;
            } else {
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const response = await safeSendMessage({ action: "captureVisibleTab" });
                if (!response?.dataUrl || response.error) throw new Error(response?.error || 'Screenshot capture failed');
                images = [response.dataUrl];
            }
            root.style.visibility = panelVisibility;
            if (journalCountdownBadge) journalCountdownBadge.style.visibility = countdownVisibility;
            await assertVisionQuestionCurrent(context);
            setLoading("Analyzing and cross-checking…");

            const res = await apiRequest('/solve-vision', 'POST', {
                image: images[0], images: images.slice(1), text: context.text,
                url: context.url,
                practice_type: context.question ? 'mcq' : practiceType,
                language: context.question ? undefined : requestedLanguage,
                verify_answer: true,
            });

            if (!res.ok) {
                const err = res.data || {};
                const msg = typeof err.detail === 'string' ? err.detail : (err.detail?.message || err.message || 'Vision server error');
                throw new Error(msg);
            }

            const data = res.data;
            await assertVisionQuestionCurrent(context);
            let parsed;
            try {
                parsed = JSON.parse(data.results);
            } catch (e) {
                throw new Error('Vision returned an invalid answer format. Please scan a clear, complete question again.');
            }
            if (!Array.isArray(parsed) || !parsed.length) throw new Error('The complete question could not be read. No guessed answer was returned.');
            assertVerifiedScanAnswers(parsed, data.answer_verified, context.question);
            if (parsed.some(item => item?.type === 'code') && data.code_reviewed !== true) {
                throw new Error('The code has not passed review against the screenshot.');
            }
            displayResults(parsed, data.provider);
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            console.error("Vision scan error:", error);
            const msg = error.name === 'AbortError'
                ? "Request timed out — server may be busy, please try again"
                : error.message;
            showError(`Vision Error: ${msg}`);
        } finally {
            root.style.visibility = panelVisibility;
            if (journalCountdownBadge) journalCountdownBadge.style.visibility = countdownVisibility;
            // Text Scan can hand off to Vision without a visible error. In that
            // case, leave its in-progress state for the caller to clear.
            if (!scanWasAlreadyRunning) {
                isScanning = false;
                updateScanControls();
            }
        }
    }

    function assertVerifiedScanAnswers(results, verified, question) {
        if (question && (!Array.isArray(results) || results.length !== 1 || results[0]?.type !== 'mcq')) {
            throw new Error('Expected one verified answer for the current question.');
        }
        if (!Array.isArray(results) || !results.some(item => item?.type === 'mcq')) return;
        if (verified !== true) {
            throw new Error('Answer verification is required. Restart the updated Browser Assistant backend.');
        }
        if (question && question.type !== 'short-answer' && question.type !== 'ordering'
            && !answerIndexesFromResult(results, question).length) {
            throw new Error('The verified answer did not match the displayed options exactly.');
        }
    }

    async function prepareVisionQuestionContext() {
        const context: {
            url: string;
            text: string;
            question: ReturnType<typeof getAuthorizedQuestion>;
            visualSnapshot?: string;
            codeSnapshot?: string;
        } = {url: location.href, text: '', question: getAuthorizedQuestion()};
        if (!context.question || context.question.type === 'code') {
            context.question = null;
            return context;
        }
        let sources = [];
        if (location.origin === 'https://learning.ccbp.in' && document.querySelector('.ace_editor,.monaco-editor,.CodeMirror')) {
            let snapshot = await safeSendMessage({action:'mcqSnippets'});
            if (!snapshot?.ok && typeof browserAssistantReadMcqSnippets === 'function') snapshot = browserAssistantReadMcqSnippets();
            if (!snapshot?.ok || !snapshot.sources?.length) throw new Error('Complete option code could not be read. No answer was guessed from partial lines.');
            if (typeof browserAssistantCacheMcqSnippets === 'function') browserAssistantCacheMcqSnippets(snapshot);
            const fresh = getAuthorizedQuestion();
            if (!hasSameQuestionOptions(context.question, fresh)) throw new Error('Question changed while loading. Please scan again.');
            context.question = fresh;
            context.codeSnapshot = JSON.stringify(snapshot.editorSources || snapshot.sources);
            sources = snapshot.sources;
        }
        const question = context.question;
        const ordering = question.type === 'ordering';
        context.text = `${question.identityText || question.text}\n${sources.length ? 'Complete code snippets:\n' + sources.join('\n\n') + '\n' : ''}`
            + (ordering ? 'Reorder ALL items. Return the complete permutation as a JSON array of 1-based item numbers.'
                : question.type === 'short-answer' ? 'Free response: return only the exact value.'
                : question.selectionType === 'multiple' ? 'Select ALL correct options.' : 'Select one answer.')
            + '\n' + question.options.map((option,index)=>`${ordering ? index + 1 : String.fromCharCode(65+index)}. ${option.text}`).join('\n');
        return context;
    }

    async function assertVisionQuestionCurrent(context) {
        if (context.url !== location.href) throw new Error('Page changed while scanning. Please scan the current question again.');
        if (!context.question) return;
        const fresh = getAuthorizedQuestion();
        if (!hasSameQuestionOptions(context.question, fresh)
            || (context.visualSnapshot && window.BrowserAssistantQuestionVisuals.fingerprint(fresh) !== context.visualSnapshot)) {
            throw new Error('Question or illustration changed while scanning. Please scan again.');
        }
        if (context.codeSnapshot) {
            const snapshot = await safeSendMessage({action:'mcqSnippets'});
            if (!snapshot?.ok || JSON.stringify(snapshot.editorSources || snapshot.sources) !== context.codeSnapshot) {
                throw new Error('The complete code changed while scanning. Please scan again.');
            }
        }
    }

    // ── Page text scan ────────────────────────────────────────────────────────
    async function scanPage() {
        if (isScanning) return;
        isScanning = true;

        // Show server-offline warning early
        if (serverOnline === false) {
            showError("Server offline. Start the backend with: python main.py");
            isScanning = false;
            return;
        }

        isCollapsed = false;
        render();
        setLoading("Solving…");

        const practiceType = detectPracticeType();
        console.log("Scanning… mode:", practiceType);

        let timeoutId;
        try {
            const context = await prepareVisionQuestionContext();
            const question = context.question;
            const visuals = window.BrowserAssistantQuestionVisuals;
            let res;
            if (question && visuals?.nodes(question).length) {
                setLoading('Reading complete question illustrations…');
                await visuals.requireBackend(apiRequest, visuals.nodes(question).length);
                const snapshot = await visuals.capture(question, safeSendMessage);
                context.visualSnapshot = snapshot.fingerprint;
                await assertVisionQuestionCurrent(context);
                res = await apiRequest('/solve-vision', 'POST', {
                    image:snapshot.images[0], images:snapshot.images.slice(1),
                    text:context.text,
                    url:location.href, practice_type:'mcq', verify_answer:true,
                });
            } else {
                res = await apiRequest('/solve', 'POST', {
                    text: question ? context.text : extractSmartText(), url: context.url,
                    practice_type: question ? 'mcq' : practiceType, verify_answer: Boolean(question) || practiceType !== 'code',
                });
            }

            if (!res.ok) {
                const err = res.data || {};
                if (res.status === 422 && err.detail?.code === 'no_readable_question') {
                    console.info('No usable page text; automatically falling back to Vision scan.');
                    setLoading("Text isn't readable — analyzing the visible screen…");
                    await visionScan(true, practiceType === 'code' ? err.detail?.language : null, practiceType);
                    return;
                }
                const msg = typeof err.detail === 'string' ? err.detail : (err.detail?.message || err.message || 'Backend error');
                throw new Error(msg);
            }

            const data = res.data;
            await assertVisionQuestionCurrent(context);
            serverOnline = true;
            let parsed;
            try {
                parsed = JSON.parse(data.results);
            } catch (e) {
                if (question || practiceType !== 'code') throw new Error('The server returned an invalid answer format.');
                const raw = data.results || "";
                const optMatch = raw.match(/Option\s+([A-D])\s*[:\s]+(.+?)(?:\.|$)/i);
                if (optMatch) {
                    parsed = [{ type: "mcq", question: "Question", reasoning: "", answer: `Option ${optMatch[1].toUpperCase()}: ${optMatch[2].trim()}` }];
                } else {
                    parsed = [{ type: "mcq", question: "Result", reasoning: "", answer: raw.substring(0, 200) }];
                }
            }
            assertVerifiedScanAnswers(parsed, data.answer_verified, question);
            displayResults(parsed, data.provider);
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            console.error("Scan error:", error);
            if (error.name === 'AbortError') {
                showError("Request timed out — server may be busy, please try again");
            } else if (error instanceof TypeError && error.message.includes('fetch')) {
                serverOnline = false;
                showError(`Error: ${error.message}`);
            } else {
                showError(`Error: ${error.message}`);
            }
        } finally {
            isScanning = false;
            updateScanControls();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function setLoading(msg) {
        const c = document.getElementById('assistant-results');
        if (c) {
            c.innerHTML = `<div class="assistant-loading"><div class="assistant-spinner"></div>${escapeHtml(msg)}</div>`;
        } else {
            lastResultSummary = "WAIT";
            render();
        }
    }

    // Result rendering happens before the async scan finishes. Do not re-render
    // the panel afterwards (that would erase the result); just unlock its
    // buttons so the next Text or Vision scan works immediately.
    function updateScanControls() {
        for (const id of ['assistant-scan-btn', 'assistant-vision-btn']) {
            const button = document.getElementById(id) as HTMLButtonElement;
            if (button) button.disabled = isScanning;
        }
    }

    function showError(msg) {
        const c = document.getElementById('assistant-results');
        if (c) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'assistant-error';
            errorDiv.textContent = msg;
            c.innerHTML = '';
            c.appendChild(errorDiv);
        } else {
            lastResultSummary = "ERR";
            render();
        }
    }

    function renderHistoryLoading() {
        const container = document.getElementById('assistant-results');
        if (container) {
            container.innerHTML = '<div class="assistant-loading"><div class="assistant-spinner"></div>Loading scan history…</div>';
        }
    }

    function renderHistoryError(message) {
        const container = document.getElementById('assistant-results');
        if (!container) return;
        container.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'assistant-error';
        error.textContent = `History Error: ${message}`;
        const retry = document.createElement('button');
        retry.className = 'assistant-history-btn';
        retry.textContent = 'Retry history';
        retry.onclick = openHistory;
        container.append(error, retry);
    }

    function renderHistory() {
        const container = document.getElementById('assistant-results');
        if (!container || !isHistoryOpen) return;
        container.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'assistant-history-header';
        const title = document.createElement('strong');
        title.textContent = 'Recent scans';
        const actions = document.createElement('div');
        const back = document.createElement('button');
        back.className = 'assistant-history-action';
        back.textContent = 'Back';
        back.onclick = () => { isHistoryOpen = false; render(); };
        actions.appendChild(back);
        if (historyItems.length) {
            const clear = document.createElement('button');
            clear.className = 'assistant-history-action danger';
            clear.id = 'assistant-clear-history-btn';
            clear.textContent = 'Clear';
            clear.onclick = clearHistory;
            actions.appendChild(clear);
        }
        header.append(title, actions);
        container.appendChild(header);

        if (!historyItems.length) {
            const empty = document.createElement('div');
            empty.className = 'assistant-placeholder';
            empty.textContent = 'No saved scans yet. Run Text Scan or Vision Scan to build your history.';
            container.appendChild(empty);
            return;
        }

        for (const item of historyItems) {
            const card = document.createElement('button');
            card.className = 'assistant-history-item';
            card.type = 'button';
            let answer = 'Saved result';
            try {
                const parsed = JSON.parse(item.results);
                answer = parsed?.[0]?.answer || parsed?.[0]?.title || answer;
            } catch { /* The server validates saved results; retain a safe fallback. */ }
            const when = new Date(item.created_at);
            const timestamp = Number.isNaN(when.getTime()) ? 'Saved scan' : when.toLocaleString();
            card.innerHTML = `<span class="assistant-history-type">${escapeHtml(item.scan_type || 'scan')}</span><span class="assistant-history-answer">${escapeHtml(answer)}</span><span class="assistant-history-time">${escapeHtml(timestamp)}</span>`;
            card.onclick = () => showHistoryItem(item);
            container.appendChild(card);
        }
    }

    function showHistoryItem(item) {
        try {
            const results = JSON.parse(item.results);
            if (!Array.isArray(results) || !results.length) throw new Error('Saved result is invalid');
            isHistoryOpen = false;
            isCollapsed = false;
            render();
            renderFullResults(document.getElementById('assistant-results'), results, `${item.provider} · history`);
        } catch (error) {
            renderHistoryError('This saved result could not be opened.');
        }
    }

    function detectPracticeType() {
        if (selectedMode !== 'auto') return selectedMode;
        const hasInputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0;
        // textContent avoids expensive layout reflow (B12)
        const upperText = (document.body.textContent || '').substring(0, 2000).toUpperCase();
        const title = document.title.toUpperCase();

        // Detect aptitude/math pages FIRST (before generic MCQ detection)
        const aptitudeKeywords = ["APTITUDE", "QUANTITATIVE", "PERCENTAGE", "PROFIT AND LOSS", "PROFIT & LOSS",
            "SIMPLE INTEREST", "COMPOUND INTEREST", "TIME AND WORK", "TIME & WORK", "TIME AND DISTANCE",
            "TIME & DISTANCE", "RATIO AND PROPORTION", "RATIO & PROPORTION", "AVERAGE", "MIXTURE",
            "ALLIGATION", "PROBABILITY", "PERMUTATION", "COMBINATION", "LOGARITHM", "ARITHMETIC",
            "NUMBER SYSTEM", "MENSURATION", "ALGEBRA", "TRIGONOMETRY", "GEOMETRY", "BOATS AND STREAMS",
            "TRAINS", "PIPES AND CISTERN", "AGES", "CLOCK", "CALENDAR"];
        const isAptitude = aptitudeKeywords.some(kw => upperText.includes(kw) || title.includes(kw));
        if (isAptitude) return "aptitude";

        // Generic MCQ detection
        if (hasInputs) return "mcq";
        if (upperText.includes("MCQ PRACTICE") || upperText.includes("QUIZ") || upperText.includes("MCQ")) return "mcq";
        if (upperText.includes("CODING PRACTICE") || upperText.includes("CODING")) return "code";
        if (title.includes("MCQ")) return "mcq";
        if (title.includes("CODING")) return "code";
        return "auto";
    }

    function selectTab(tab) {
        selectedTab = tab;
        isHistoryOpen = false;
        if (tab !== 'qa') selectedMode = tab;
        render();
    }

    function bindTabKeyboardNavigation() {
        const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
        tabs.forEach((tab, index) => {
            tab.addEventListener('keydown', (event) => {
                let nextIndex = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = tabs.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                tabs[nextIndex].click();
                requestAnimationFrame(() => root.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus());
            });
        });
    }

    function scanPanelMarkup() {
        return `
            <section class="assistant-scan-panel" id="assistant-scan-panel" role="tabpanel" aria-labelledby="mode-${selectedTab}">
                <div class="assistant-btn-row">
                    <button class="assistant-btn" id="assistant-scan-btn">⚡ Scan (Text)</button>
                    <button class="assistant-btn secondary" id="assistant-vision-btn">⌁ Scan (Vision)</button>
                </div>
                <div class="assistant-body" id="assistant-results">
                    <div class="assistant-placeholder">No results yet.<br><small>Press <kbd>\`</kbd> to open or <kbd>]</kbd> to close.</small></div>
                </div>
            </section>
        `;
    }

    function qaControlMarkup() {
        return `
            <section class="assistant-qa-panel" id="assistant-qa-panel" role="tabpanel" aria-labelledby="mode-qa">
                <div class="assistant-qa-heading">
                    <div>
                        <p class="assistant-eyebrow">AUTHORIZED AUTOMATION</p>
                        <h4>QA Control</h4>
                    </div>
                    <span class="assistant-qa-state" id="assistant-automation-state" aria-live="polite">${automation.state}</span>
                </div>
                <div class="assistant-automation-status" id="assistant-automation-status" aria-live="polite"></div>
                <dl class="assistant-qa-details">
                    <div class="assistant-qa-wide"><dt>Current page</dt><dd id="assistant-automation-page">—</dd></div>
                    <div><dt>Completed</dt><dd id="assistant-automation-completed">0</dd></div>
                    <div><dt>Progress</dt><dd id="assistant-automation-progress">0 / —</dd></div>
                    <div class="assistant-qa-wide"><dt>Current question</dt><dd id="assistant-automation-question">—</dd></div>
                </dl>
                <div class="assistant-qa-latest" id="assistant-journal-list-clock" hidden></div>
                <div class="assistant-qa-latest" id="assistant-automation-latest" aria-live="polite"></div>
                <div id="assistant-journal-slot"></div>
                <div class="assistant-automation-actions assistant-qa-actions">
                    <button class="assistant-auto-btn start" id="assistant-auto-start-btn" aria-keyshortcuts="Alt+A Alt+Shift+A" title="Start automation (Alt + A)">▶ Start automation</button>
                    <button class="assistant-auto-btn" id="assistant-auto-pause-btn" aria-keyshortcuts="Alt+A Alt+Shift+A" title="Pause or resume (Alt + A)" disabled>Pause</button>
                    <button class="assistant-auto-btn stop" id="assistant-auto-stop-btn" disabled>■ Stop</button>
                </div>
                <p class="assistant-automation-status">Alt + A: Start / Pause / Resume</p>
                <button class="assistant-auto-btn" id="assistant-export-question-btn">Export question details</button>
            </section>
        `;
    }

    function buildQuestionDiagnostic(doc) {
        const text = node => (node.textContent || '').replace(/\s+/g, ' ').trim();
        const prompts = [...doc.querySelectorAll('p,h1,h2,h3,h4,div,span')].filter(node =>
            !node.closest('#assistant-root') && /rearrange|drag and drop to order/i.test(text(node))
            && ![...node.children].some(child => /rearrange|drag and drop to order/i.test(text(child))));
        for (const prompt of prompts) {
            for (let region = prompt.parentElement; region && region !== doc.body; region = region.parentElement) {
                if (!/submit/i.test(text(region)) || region.querySelector('#assistant-root')) continue;
                const clone = region.cloneNode(true);
                clone.querySelectorAll('script,style,iframe,img,video,canvas,#assistant-root').forEach(node => node.remove());
                for (const node of [clone, ...clone.querySelectorAll('*')]) {
                    for (const attribute of [...node.attributes]) {
                        if (!/^(class|id|role|tabindex|draggable|type|disabled|aria-[\w-]+|data-(rbd|rfd|dnd|sortable)[\w-]*)$/.test(attribute.name)) node.removeAttribute(attribute.name);
                    }
                    if (node.matches('input,textarea')) { node.removeAttribute('value'); node.textContent = ''; }
                }
                return clone.outerHTML;
            }
        }
        return null;
    }

    function exportQuestionDiagnostic() {
        const html = buildQuestionDiagnostic(document);
        if (!html) { automation.error = 'Open the drag-and-drop question before exporting details.'; updateAutomationUI(); return; }
        const url = URL.createObjectURL(new Blob([html], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'question-controls.txt'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function render() {
        if (disposed) return;
        window.BrowserAssistantJournal?.detach();
        if (isCollapsed) {
            const content = lastResultSummary || "";
            // Escape for safe attribute injection (B7)
            const safeContent = content.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            root.innerHTML = `
                <button class="assistant-tab collapsed ${content ? 'has-answer' : ''}" id="assistant-trigger" type="button" aria-label="Open Browser Assistant" data-content="${safeContent}">
                    ${isMinimalMode ? '<div class="assistant-mode-indicator">MIN</div>' : ''}
                </button>
            `;
            document.getElementById('assistant-trigger').onclick = () => {
                lastResultSummary = "";
                openPanel();
            };
        } else {
            const statusDot = serverOnline === false
                ? '<span class="status-dot offline" title="Server offline"></span>'
                : serverOnline === true
                    ? '<span class="status-dot online" title="Server online"></span>'
                    : '<span class="status-dot unknown" title="Checking server…"></span>';

            root.innerHTML = `
                <div class="assistant-tab" id="assistant-panel">
                    <div class="assistant-header">
                        <div class="assistant-title-row">
                            ${statusDot}
                            <h3 class="assistant-title">Browser Assistant</h3>
                        </div>
                        <div class="assistant-header-actions">
                            <button class="assistant-icon-btn" id="assistant-history-btn" type="button" aria-label="Open Scan History" title="Scan History">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3.5 2"/></svg>
                            </button>
                            <button class="assistant-close" id="assistant-close-btn" type="button" aria-label="Close Browser Assistant" title="Close">&times;</button>
                        </div>
                    </div>
                    <div class="assistant-content">
                        <div class="assistant-mode-switcher" role="tablist" aria-label="Browser Assistant modes">
                            <button class="mode-btn ${selectedTab === 'auto' ? 'active' : ''}" id="mode-auto" type="button" role="tab" aria-selected="${selectedTab === 'auto'}" aria-controls="assistant-scan-panel" tabindex="${selectedTab === 'auto' ? '0' : '-1'}">AUTO</button>
                            <button class="mode-btn ${selectedTab === 'mcq' ? 'active' : ''}" id="mode-mcq" type="button" role="tab" aria-selected="${selectedTab === 'mcq'}" aria-controls="assistant-scan-panel" tabindex="${selectedTab === 'mcq' ? '0' : '-1'}">MCQ</button>
                            <button class="mode-btn ${selectedTab === 'aptitude' ? 'active' : ''}" id="mode-apt" type="button" role="tab" aria-selected="${selectedTab === 'aptitude'}" aria-controls="assistant-scan-panel" tabindex="${selectedTab === 'aptitude' ? '0' : '-1'}">MATH</button>
                            <button class="mode-btn ${selectedTab === 'code' ? 'active' : ''}" id="mode-code" type="button" role="tab" aria-selected="${selectedTab === 'code'}" aria-controls="assistant-scan-panel" tabindex="${selectedTab === 'code' ? '0' : '-1'}">CODE</button>
                            <button class="mode-btn qa-tab ${selectedTab === 'qa' ? 'active' : ''}" id="mode-qa" type="button" role="tab" aria-label="QA Control" aria-selected="${selectedTab === 'qa'}" aria-controls="assistant-qa-panel" tabindex="${selectedTab === 'qa' ? '0' : '-1'}">QA CONTROL</button>
                        </div>
                        ${isHistoryOpen
                            ? '<div class="assistant-body" id="assistant-results" aria-live="polite"></div>'
                            : selectedTab === 'qa' ? qaControlMarkup() : scanPanelMarkup()}
                    </div>
                </div>
            `;

            document.getElementById('assistant-close-btn').onclick = closePanel;
            document.getElementById('mode-auto').onclick = () => selectTab('auto');
            document.getElementById('mode-mcq').onclick  = () => selectTab('mcq');
            document.getElementById('mode-apt').onclick  = () => selectTab('aptitude');
            document.getElementById('mode-code').onclick = () => selectTab('code');
            document.getElementById('mode-qa').onclick = () => selectTab('qa');
            bindTabKeyboardNavigation();
            document.getElementById('assistant-history-btn').onclick = openHistory;
            document.getElementById('assistant-scan-btn')?.addEventListener('click', scanPage);
            document.getElementById('assistant-vision-btn')?.addEventListener('click', visionScan);
            document.getElementById('assistant-auto-start-btn')?.addEventListener('click', startPracticeAutomation);
            document.getElementById('assistant-export-question-btn')?.addEventListener('click', exportQuestionDiagnostic);
            document.getElementById('assistant-auto-pause-btn')?.addEventListener('click', pauseOrResumeAutomation);
            document.getElementById('assistant-auto-stop-btn')?.addEventListener('click', () => stopAutomation());
            updateAutomationUI();

            // Disable scan buttons while a scan is in progress (B3: prevent double-click)
            if (isScanning) {
                const textScan = document.getElementById('assistant-scan-btn') as HTMLButtonElement;
                const visionScanButton = document.getElementById('assistant-vision-btn') as HTMLButtonElement;
                if (textScan) textScan.disabled = true;
                if (visionScanButton) visionScanButton.disabled = true;
            }
        }
    }

    // ── Display results ───────────────────────────────────────────────────────
    function displayResults(results, provider) {
        isHistoryOpen = false;
        // A scan may be launched with a keyboard shortcut while QA Control is
        // visible. Show that result in the active scan surface without touching
        // the separate automation state.
        if (selectedTab === 'qa') selectedTab = selectedMode;
        if (results && results.length > 0) {
            const scanType = provider?.includes('vision') ? 'vision' : 'text';
            void saveScanHistory(results, provider, scanType);
        }
        // Minimal mode: show answer letter on the badge
        if (isMinimalMode) {
            if (results && results.length > 0) {
                const first = results[0];
                if (first.type === 'mcq') {
                    const match = (first.answer || "").match(/^Option\s*([A-E])/i)
                        || (first.answer || "").match(/\(([A-E])\)/i)
                        || (first.answer || "").match(/^([A-E])[:\s.-]/i)
                        || (first.answer || "").match(/\b([A-E])\b/i);
                    lastResultSummary = match ? match[1].toUpperCase() : "Ans";
                } else {
                    lastResultSummary = "OK";
                }
            } else {
                lastResultSummary = "None";
            }
            render();
            return;
        }

        if (results && results.length > 0) {
            isCollapsed = false;
            render();
            const container = document.getElementById('assistant-results');
            if (container) renderFullResults(container, results, provider);
        } else {
            const container = document.getElementById('assistant-results');
            if (container) container.innerHTML = '<div class="assistant-placeholder">No results found.</div>';
        }
    }

    function renderFullResults(container, results, provider) {
        // Show provider with verified badge if applicable
        provider = provider || "unknown";
        const isVerified = provider.includes('[verified]');
        const safeProvider = escapeHtml(provider.toUpperCase());
        const providerBadge = isVerified
            ? `<div class="assistant-provider-badge verified">✅ via ${safeProvider}</div>`
            : `<div class="assistant-provider-badge">via ${safeProvider}</div>`;
        container.innerHTML = providerBadge;

        results.forEach((res, index) => {
            if (res.type === 'code') {
                const codeContent = res.code || res.answer || "";
                if (!codeContent) return;
                const language = (res.language || 'text').toLowerCase().replace(/[^a-z0-9-]/g, '');
                const codeBox = document.createElement('div');
                codeBox.className = 'assistant-code-container';
                const approach = res.approach
                    ? `<div class="assistant-code-approach">${escapeHtml(res.approach)}</div>`
                    : '';
                const complexity = [res.time_complexity, res.space_complexity]
                    .filter(Boolean)
                    .map(escapeHtml)
                    .join(' · ');
                const complexityHtml = complexity
                    ? `<div class="assistant-code-complexity">${complexity}</div>`
                    : '';
                codeBox.innerHTML = `
                    <div class="assistant-code-header">
                        <span>${escapeHtml(res.title || 'Solution')} — Language: ${escapeHtml(formatLanguageName(res.language))}</span>
                        <button class="assistant-copy-btn" id="copy-btn-${index}">Copy</button>
                    </div>
                    ${approach}${complexityHtml}
                    <pre class="assistant-code-block"><code class="language-${language}">${escapeHtml(codeContent)}</code></pre>
                `;
                container.appendChild(codeBox);
                document.getElementById(`copy-btn-${index}`).onclick = () => copyToClipboard(codeContent, `copy-btn-${index}`);
            } else {
                const item = document.createElement('div');
                item.className = 'assistant-answer';

                // Show reasoning if available (collapsible)
                const reasoningHtml = res.reasoning
                    ? `<details class="assistant-reasoning">
                         <summary>Show reasoning</summary>
                         <div class="assistant-reasoning-text">${escapeHtml(res.reasoning)}</div>
                       </details>`
                    : '';

                item.innerHTML = `
                    <div class="assistant-question-text">${escapeHtml(res.question || 'Question')}</div>
                    <div class="assistant-answer-text">${escapeHtml(res.answer || 'No answer found')}</div>
                    ${reasoningHtml}
                `;
                container.appendChild(item);
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatLanguageName(language) {
        const names = {
            python: 'Python',
            cpp: 'C++',
            java: 'Java',
            javascript: 'JavaScript',
            c: 'C',
            csharp: 'C#',
            go: 'Go',
            rust: 'Rust',
            kotlin: 'Kotlin',
            php: 'PHP',
            sql: 'SQL'
        };
        const key = (language || '').toLowerCase();
        return names[key] || language || 'code';
    }

    async function copyToClipboard(text, btnId) {
        try {
            await navigator.clipboard.writeText(text);
            const btn = document.getElementById(btnId);
            if (!btn) return; // Button may have been destroyed by re-render
            btn.innerText = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                const b = document.getElementById(btnId);
                if (b) { b.innerText = 'Copy'; b.classList.remove('copied'); }
            }, 2000);
        } catch (err) {
            console.error('Clipboard error:', err);
        }
    }

    async function resumeAuthorizedQaAfterNavigation() {
        let resume;
        try {
            resume = JSON.parse(sessionStorage.getItem(AUTO_RESUME_KEY) || 'null');
            sessionStorage.removeItem(AUTO_RESUME_KEY);
        } catch { return; }
        const context = getAutomationContext();
        const isFresh = Number.isFinite(resume?.createdAt) && Date.now() - resume.createdAt < 120000;
        if (!isFresh || resume.targetId !== context.target?.id || context.mode !== 'FULL') return;
        isCollapsed = false;
        render();
        const adapter = getAutomationAdapter(context);
        if (!adapter) return;

        if (resume.stage === 'course') {
            const nextPractice = await waitForCourseAction(() => adapter.getNextCoursePractice?.(document, resume.currentTitle));
            if (!nextPractice) { automation.state = 'PAUSED'; automation.error = 'Next MCQ practice was not found.'; updateAutomationUI(); return; }
            automation.state = 'OPENING_NEXT_PRACTICE'; updateAutomationUI();
            saveCourseResume('start', context);
            nextPractice.scrollIntoView({ block: 'center', behavior: 'smooth' });
            setTimeout(() => nextPractice.click(), 250);
            setTimeout(() => { void resumeAuthorizedQaAfterNavigation(); }, 900);
            return;
        }

        if (resume.stage === 'start') {
            const startPractice = await waitForCourseAction(() => adapter.getStartPractice?.(document));
            if (!startPractice) { automation.state = 'PAUSED'; automation.error = 'Start Practice button was not found.'; updateAutomationUI(); return; }
            automation.state = 'STARTING_PRACTICE'; updateAutomationUI();
            saveCourseResume('solve', context);
            startPractice.click();
            setTimeout(() => { void resumeAuthorizedQaAfterNavigation(); }, 900);
            return;
        }

        if (resume.stage === 'solve') {
            const question = await waitForCourseAction(() => getAuthorizedQuestion(context));
            if (!question) { automation.state = 'PAUSED'; automation.error = 'New MCQ question did not load.'; updateAutomationUI(); return; }
        }
        void startPracticeAutomation();
    }

    let reopenedAfterUpdate = false;
    try {
        const reopen = sessionStorage.getItem('browserAssistantReopenAfterUpdate');
        reopenedAfterUpdate = reopen !== null;
        sessionStorage.removeItem('browserAssistantReopenAfterUpdate');
        if (reopen === 'true') {isCollapsed=false;selectedTab='qa';automation.state='UPDATED';}
    } catch {}
    render();
    if (!reopenedAfterUpdate) void resumeCodingBatch().then(resumed => { if (!resumed) void resumeAuthorizedQaAfterNavigation(); });
})();
