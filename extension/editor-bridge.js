// Serialized by chrome.scripting into the page's MAIN world to access editor APIs.
function browserAssistantEditor(operation, selector, expected, value) {
    try {
        if (operation === 'readProject' || operation === 'writeProject') {
            const files = { html: '#htmlEditor', css: '#cssEditor', javascript: '#javascriptEditor' };
            const editors = {};
            for (const [name, id] of Object.entries(files)) {
                const matches = [...document.querySelectorAll(id)];
                if (matches.length !== 1 || !matches[0].matches('.ace_editor') || matches[0].closest('#assistant-root'))
                    throw new Error('Web project editor missing: ' + name);
                const editor = matches[0].env?.editor;
                if (!editor || editor.getReadOnly())
                    throw new Error('Web project editor is unavailable or read-only: ' + name);
                editors[name] = editor;
            }
            const readFiles = () => Object.fromEntries(Object.entries(editors).map(([name, editor]) => [name, editor.getValue()]));
            const before = readFiles();
            if (operation === 'writeProject') {
                const previous = JSON.parse(expected);
                const replacement = JSON.parse(value);
                for (const name of Object.keys(files)) {
                    if (typeof replacement[name] !== 'string' || previous[name] !== before[name])
                        throw new Error('A project file changed while generating code: ' + name);
                }
                try {
                    for (const name of Object.keys(files))
                        editors[name].setValue(replacement[name], -1);
                    for (const name of Object.keys(files))
                        if (editors[name].getValue() !== replacement[name])
                            throw new Error('Project write verification failed: ' + name);
                }
                catch (error) {
                    for (const name of Object.keys(files))
                        editors[name].setValue(before[name], -1);
                    throw error;
                }
            }
            return { ok: true, value: JSON.stringify(readFiles()) };
        }
        const nodes = [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length > 0 && !node.closest('#assistant-root'));
        if (nodes.length !== 1)
            throw new Error('Expected one visible code editor.');
        const node = nodes[0];
        let read, write;
        if (node.matches('.monaco-editor')) {
            const editors = window.monaco?.editor?.getEditors?.() || [];
            const editor = editors.find(item => item.getDomNode() === node);
            if (!editor || editor.getOption(window.monaco.editor.EditorOption.readOnly))
                throw new Error('Monaco editor API is unavailable or read-only.');
            const model = editor.getModel();
            read = () => model.getValue();
            write = code => { editor.pushUndoStop(); editor.executeEdits('browser-assistant', [{ range: model.getFullModelRange(), text: code }]); editor.pushUndoStop(); };
        }
        else if (node.matches('.ace_editor')) {
            const editor = node.env?.editor;
            if (!editor || editor.getReadOnly())
                throw new Error('Ace editor is unavailable or read-only.');
            read = () => editor.getValue();
            write = code => editor.setValue(code, -1);
        }
        else if (node.matches('.CodeMirror')) {
            const editor = node.CodeMirror;
            if (!editor || editor.getOption('readOnly'))
                throw new Error('CodeMirror is unavailable or read-only.');
            read = () => editor.getValue();
            write = code => editor.setValue(code);
        }
        else {
            if (node.disabled || node.readOnly)
                throw new Error('Code editor is read-only.');
            read = () => node.value;
            write = code => {
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, code);
                node.dispatchEvent(new Event('input', { bubbles: true }));
                node.dispatchEvent(new Event('change', { bubbles: true }));
            };
        }
        if (operation === 'write') {
            if (typeof value !== 'string' || read() !== expected)
                throw new Error('Editor changed while generating code.');
            write(value);
            if (read() !== value)
                throw new Error('Editor did not retain the generated code.');
        }
        return { ok: true, value: read() };
    }
    catch (error) {
        return { ok: false, error: error.message };
    }
}
// Runs in the portal IDE frame only. The terminal command is built here from
// fixed operations and encoded source, never from model-generated shell text.
async function browserAssistantOnlineIdeTerminal(action, workspace, questionId, token, source) {
    if (location.origin !== 'https://ide.ccbp.in' || location.pathname.replace(/\/$/, '') !== `/playground/${workspace}`)
        return null;
    const visible = node => node.getClientRects().length > 0;
    const inputs = [...document.querySelectorAll('.xterm-helper-textarea[aria-label="Terminal input"]')].filter(visible);
    if (inputs.length !== 1)
        return { ok: false, retry: inputs.length === 0, error: 'A unique IDE terminal is required.' };
    const input = inputs[0];
    const rowContainer = input.closest('.xterm')?.querySelector('.xterm-rows');
    const rows = () => [...(rowContainer?.children || [])].map(row => row.textContent.trim()).filter(Boolean);
    const finishMarker = `BA_RESULT_${token}`;
    const reportPrefix = `https://learning.ccbp.in/ide-coding-submission/${questionId}/`;
    const reports = lines => {
        const text = lines.join('');
        return text.split(reportPrefix).slice(1).map(fragment => fragment.match(/^[a-f0-9-]{36}/i)?.[0]).filter(Boolean);
    };
    const key = '__browserAssistantOnlineIdeRun';
    const previous = window[key];
    if (action === 'onlineIdeStatus') {
        if (previous?.token !== token)
            return { ok: false, error: 'The IDE reloaded or its run could not be identified.' };
        const lines = rows();
        const result = lines.find(line => line.startsWith(`${finishMarker}:`));
        if (!result)
            return { ok: true, done: false };
        const index = lines.findLastIndex(line => line.includes('Open Submission URL'));
        const report = index >= 0 && reports(lines.slice(index)).find(id => !previous.reports.includes(id));
        const passed = result === `${finishMarker}:0` && Boolean(report) && index > 0
            && lines.slice(Math.max(0, index - 3), index).includes('All test cases passed');
        return { ok: true, done: true, passed, submitted: Boolean(report), url: report ? reportPrefix + report : null };
    }
    if (previous?.token === token)
        return { ok: false, error: 'This IDE run was already started. Check the terminal.' };
    if (document.visibilityState !== 'visible')
        return { ok: false, error: 'Keep the matching IDE tab active to submit.' };
    const before = rows();
    const prompt = before.at(-1)?.match(/^nxtwave@([a-z0-9]+):~\/nodejs\/coding-practices\/([a-z0-9_-]+)\$$/i);
    if (!prompt || prompt[1] !== workspace)
        return { ok: false, retry: true, error: 'Waiting for the correct workspace shell prompt.' };
    if (reports(before).length && before.includes('All test cases passed'))
        return { ok: true, alreadyPassed: true };
    const findFile = () => [...document.querySelectorAll('div[title="app.js"]')].filter(visible);
    let files = findFile();
    if (!files.length) {
        const folders = [...document.querySelectorAll('div[title=""] span')]
            .filter(node => visible(node) && node.textContent.trim() === prompt[2]);
        if (folders.length === 1) {
            folders[0].click();
            await new Promise(resolve => setTimeout(resolve, 150));
            files = findFile();
        }
    }
    if (files.length !== 1)
        return { ok: false, retry: true, error: 'Waiting for the workspace app.js file in Explorer.' };
    files[0].click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const editors = [...document.querySelectorAll('.monaco-editor[data-uri]')].filter(visible);
    const editor = editors.length === 1 && editors[0];
    if (!editor || !editor.getAttribute('data-uri').endsWith(`/${prompt[2]}/app.js`)) {
        return { ok: false, retry: true, error: 'Waiting for the app.js editor.' };
    }
    const renderedCode = editor.querySelector('.view-lines');
    if (!renderedCode || renderedCode.textContent.trim())
        return { ok: false, error: 'app.js already contains code. Review the prepared result before replacing it.' };
    const bytes = new TextEncoder().encode(source);
    const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const writer = [
        'const fs = require("node:fs")',
        'const [encoded, digest, folder] = process.argv.slice(1)',
        'const code = Buffer.from(encoded, "base64")',
        'if (require("node:crypto").createHash("sha256").update(code).digest("hex") !== digest) throw Error("Incomplete source received")',
        'if (!process.cwd().endsWith("/nodejs/coding-practices/" + folder)) throw Error("Unexpected project directory")',
        'const stat = fs.lstatSync("app.js")',
        'if (!stat.isFile() || fs.readFileSync("app.js", "utf8").trim()) throw Error("app.js is not an empty regular file")',
        'const check = require("node:child_process").spawnSync(process.execPath, ["--check"], {input: code})',
        'if (check.status !== 0) throw Error(String(check.stderr || "JavaScript syntax check failed"))',
        'fs.writeFileSync("app.js", code)',
        'if (!fs.readFileSync("app.js").equals(code)) throw Error("Could not verify the saved file")',
    ].join('; ');
    // All arguments are restricted to letters, digits, or base64 by construction.
    const echoMarker = `BA_COMMAND_${token}`;
    const command = `node -e '${writer}' '${encoded}' '${digest}' '${prompt[2]}' && ccbp submit ${workspace}; printf '\\n${finishMarker}:%s\\n' "$?" #${echoMarker}`;
    if (rows().at(-1) !== before.at(-1))
        return { ok: false, error: 'The IDE terminal changed before submission.' };
    input.focus();
    if (document.activeElement !== input)
        return { ok: false, error: 'The IDE terminal could not be focused.' };
    const data = new DataTransfer();
    data.setData('text/plain', command);
    window[key] = { token, reports: reports(before) };
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline && document.activeElement === input && document.visibilityState === 'visible') {
        if (rows().join('').endsWith(`#${echoMarker}`)) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            return { ok: true, started: true };
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { ok: false, error: 'The IDE did not confirm terminal input. Check the terminal before running any command.' };
}
// Keep complete models on their DOM nodes in the content script's world. Ace
// recycles viewport rows when scrolling, so rendered text is not an option ID.
var browserAssistantMcqSnippetCache = new WeakMap();
function browserAssistantCacheMcqSnippets(snapshot) {
    const nodes = [...document.querySelectorAll('.ace_editor,.monaco-editor,.CodeMirror')]
        .filter(node => node.getClientRects().length && !node.closest('#assistant-root'));
    if (!Array.isArray(snapshot.editorSources) || nodes.length !== snapshot.editorSources.length
        || snapshot.editorSources.some(value => typeof value !== 'string'))
        return;
    nodes.forEach((node, index) => browserAssistantMcqSnippetCache.set(node, snapshot.editorSources[index]));
}
function browserAssistantCachedMcqSnippet(node) {
    return browserAssistantMcqSnippetCache.get(node);
}
// Read-only snapshot of complete editor models, including offscreen lines.
// DOM .ace_line/.view-line nodes contain only the current viewport.
function browserAssistantReadMcqSnippets() {
    try {
        const completeAceDom = node => {
            const lines = [...node.querySelectorAll('.ace_line')];
            const numbers = [...node.querySelectorAll('.ace_gutter-cell')].map(item => Number((item.textContent || '').trim()));
            const bar = node.querySelector('.ace_scrollbar-v .ace_scrollbar-inner');
            if (!lines.length || numbers.length !== lines.length || !numbers.every((number, index) => number === index + 1))
                return null;
            const rowHeight = lines[0].getBoundingClientRect().height;
            const totalHeight = bar ? Math.max(bar.scrollHeight || 0, parseFloat(bar.style.height) || 0) : 0;
            // No scrollbar measurement means the visible rows cannot prove
            // completeness. Never guess from the first screen of long code.
            if (!(rowHeight > 0 && totalHeight > 0) || totalHeight > rowHeight * lines.length + 1)
                return null;
            return lines.map(line => line.textContent || '').join('\n');
        };
        const nodes = [...document.querySelectorAll('.ace_editor,.monaco-editor,.CodeMirror')]
            // MCQ pages sometimes reuse the coding editor's ID for a read-only
            // pseudocode panel. This function only reads; the background origin
            // check limits it to the learning portal, including SPA routes.
            .filter(node => node.getClientRects().length && !node.closest('#assistant-root'));
        const sources = [], editorSources = [];
        for (const node of nodes) {
            let value;
            if (node.matches('.ace_editor'))
                value = node.env?.editor?.getValue()
                    ?? node.env?.editor?.session?.getValue() ?? completeAceDom(node);
            else if (node.matches('.CodeMirror'))
                value = node.CodeMirror?.getValue();
            else {
                const editor = window.monaco?.editor?.getEditors?.().find(item => item.getDomNode() === node);
                value = editor?.getModel()?.getValue();
                if (typeof value !== 'string' && nodes.length === 1) {
                    const models = window.monaco?.editor?.getModels?.() || [];
                    if (models.length === 1)
                        value = models[0].getValue();
                }
            }
            if (typeof value !== 'string')
                throw new Error('Full snippet editor model is unavailable; refusing to solve from partial lines.');
            editorSources.push(value);
            if (value.trim() && !sources.includes(value))
                sources.push(value);
        }
        if (editorSources.join('\n').length > 50000)
            throw new Error('Code snippets exceed the 50000-character limit; no code was truncated.');
        return { ok: true, sources, editorSources };
    }
    catch (error) {
        return { ok: false, error: error.message };
    }
}
// Runs in the page's main world. CCBP's React drag listeners receive the
// native DataTransfer object only when these events originate in this world.
async function browserAssistantOrderingDrag(prompt, optionTexts, from, to) {
    try {
        const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
        const question = document.querySelector('#generic-question-container');
        const actualPrompt = normalize(question?.querySelector('#generic-question-wrapper-id')?.textContent);
        if (!question || actualPrompt !== normalize(prompt) || !Array.isArray(optionTexts)
            || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0)
            return { ok: false };
        const rows = () => [...question.querySelectorAll('.drag-and-drop-option-label')]
            .map(label => ({ label, text: normalize(label.textContent), handle: label.parentElement?.querySelector('.drag-icon-container[draggable="true"]') }))
            .filter(row => row.handle);
        const before = rows();
        if (before.length !== optionTexts.length || before.some((row, index) => row.text !== normalize(optionTexts[index]))
            || from >= before.length || to >= before.length)
            return { ok: false };
        if (from === to)
            return { ok: true };
        const source = before[from].handle;
        const target = before[to].handle;
        const dataTransfer = new DataTransfer();
        dataTransfer.effectAllowed = 'move';
        const send = (node, type) => {
            const rect = node.getBoundingClientRect();
            node.dispatchEvent(new DragEvent(type, {
                bubbles: true, cancelable: true, dataTransfer,
                clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
            }));
        };
        send(source, 'dragstart');
        await new Promise(resolve => setTimeout(resolve, 220));
        send(target, 'dragenter');
        send(target, 'dragover');
        await new Promise(resolve => setTimeout(resolve, 220));
        send(target, 'drop');
        send(source, 'dragend');
        for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 160));
            const after = rows();
            if (after.length !== before.length)
                return { ok: false };
            if (after[to]?.text === before[from].text)
                return { ok: true };
        }
        return { ok: false };
    }
    catch (error) {
        return { ok: false, error: error.message };
    }
}
