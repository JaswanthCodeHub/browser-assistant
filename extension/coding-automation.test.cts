const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = file => fs.readFileSync(`${__dirname}/${file}`, 'utf8');

test('editor bridge reads, writes, and refuses to overwrite concurrent edits', () => {
    let value = 'starter';
    const editor = { getReadOnly: () => false, getValue: () => value, setValue: code => { value = code; } };
    const node = { getClientRects: () => [1], closest: () => null, matches: selector => selector === '.ace_editor', env: { editor } };
    const context = vm.createContext({ document: { querySelectorAll: () => [node] } });
    vm.runInContext(source('editor-bridge.js'), context);
    const bridge = context.browserAssistantEditor;
    assert.equal(bridge('read', '.ace_editor').value, 'starter');
    assert.equal(bridge('write', '.ace_editor', 'starter', 'solution').ok, true);
    assert.equal(value, 'solution');
    assert.equal(bridge('write', '.ace_editor', 'starter', 'stale solution').ok, false);
    assert.equal(value, 'solution');
    editor.getReadOnly = () => true;
    assert.equal(bridge('write', '.ace_editor', 'solution', 'replacement').ok, false);
});

test('MCQ fixture adapter and authorization remain available', () => {
    const context = vm.createContext({ window: {}, URL });
    vm.runInContext(source('automation-policy.js'), context);
    const policy = context.window.BrowserAssistantAutomationPolicy;
    const options = ['First', 'Second'].map(textContent => ({ textContent, querySelector: () => ({ checked: false }) }));
    const doc = { querySelectorAll: () => options, querySelector: selector => selector === '[data-practice-question-text]' ? { textContent: 'Choose an option', closest: () => null } : {} };
    const question = policy.getAdapter('practice-fixture').getQuestion(doc);
    assert.equal(question.options.length, 2);
    assert.equal(question.text, 'Choose an option');
    const general = policy.resolveTarget(new URL('https://unrelated.example/'), doc);
    assert.equal(general.adapter, 'semantic-mcq');
    assert.equal(general.capabilities.fill, true);
    assert.equal(general.capabilities.select, true);
    assert.notEqual(general.id, policy.resolveTarget(new URL('https://another.example/'), doc).id);
    assert.equal(policy.resolveTarget(new URL('chrome://extensions/'), doc), null);
    assert.equal(policy.resolveTarget(new URL('file:///example.html'), doc), null);
    assert.ok(policy.getAdapter('semantic-mcq'));
});

test('coding identity ignores description rerenders but detects language or title changes', () => {
    const content = source('content.js');
    const start = content.indexOf('    function getAuthorizedQuestion(');
    const end = content.indexOf('    function questionDetectionError(', start);
    const coding = { type: 'code', title: 'Right Angled Triangle - 6', text: 'Initial description', language: 'python' };
    const context = vm.createContext({
        document: {},
        window: { location: { pathname: '/question/triangle-6' }, BrowserAssistantCoding: { getQuestion: () => coding } },
        getAutomationContext: () => ({ mode: 'FULL' }),
        getAutomationAdapter: () => ({}),
        automationPolicy: { canExecute: () => true },
        normalizeAutomationText: value => String(value || '').replace(/\s+/g, ' ').trim(),
    });
    vm.runInContext(content.slice(start, end), context);
    const before = context.getAuthorizedQuestion();
    coding.text = 'Initial description with a late-loaded example and updated status UI';
    const rerendered = context.getAuthorizedQuestion();
    assert.equal(rerendered.signature, before.signature);
    coding.language = 'cpp';
    assert.notEqual(context.getAuthorizedQuestion().signature, before.signature);
    coding.language = 'python'; coding.title = 'Right Angled Triangle - 7';
    assert.notEqual(context.getAuthorizedQuestion().signature, before.signature);
});

test('CCBP UUID identity survives a missing title and late example text, but rejects another route or language', () => {
    const content = source('content.js');
    const coding = { type: 'code', title: 'Inverted Right Angled Triangle', text: 'Initial statement', language: 'javascript' };
    const location = { origin: 'https://learning.ccbp.in', pathname: '/question/1fa446b5-5e96-46c7-8938-fcd741dc1b55' };
    const context = vm.createContext({ document: {}, window: { location, BrowserAssistantCoding: { getQuestion: () => coding } },
        getAutomationContext: () => ({}), getAutomationAdapter: () => ({}), automationPolicy: { canExecute: () => true },
        normalizeAutomationText: value => String(value || '').replace(/\s+/g, ' ').trim() });
    vm.runInContext(content.slice(content.indexOf('    function getAuthorizedQuestion('), content.indexOf('    function questionDetectionError(')), context);
    const before = context.getAuthorizedQuestion().signature;
    coding.title = ''; coding.text = 'Description Submissions Get Help Inverted Right Angled Triangle with newly loaded examples';
    assert.equal(context.getAuthorizedQuestion().signature, before);
    coding.language = 'python';
    assert.notEqual(context.getAuthorizedQuestion().signature, before);
    coding.language = 'javascript'; location.pathname = '/question/2fa446b5-5e96-46c7-8938-fcd741dc1b55';
    assert.notEqual(context.getAuthorizedQuestion().signature, before);
});

for (const scenario of ['success', 'repair failure', 'editor rerender', 'submissions tab', 'batch submissions tab', 'changed question', 'stop during solve', 'changed editor', 'unreviewed code']) {
    test(`coding runner: ${scenario}`, async () => {
        const content = source('content.js');
        const runner = content.slice(content.indexOf('    async function runCodingAutomation('), content.indexOf('    async function startPracticeAutomation('));
        let value = 'starter', submits = 0, writes = 0, changed = false, result = null;
        const automation = { running: true, runId: 1, completed: 0 };
        if (scenario === 'batch submissions tab') { automation.batch = { title: 'Print hello' }; automation.completed = 3; }
        const question = { text: 'Print hello', language: 'python', signature: 'one', editorSelector: '.ace_editor' };
        const context = vm.createContext({
            automation, window: { location: { href: 'https://learning.ccbp.in/practice' }, BrowserAssistantCoding: {
                getSubmit: () => ({ click: () => { submits++; result = scenario === 'repair failure' && submits === 1 ? 'failed' : 'passed'; } }), getResult: () => result,
                getFailureFeedback: () => 'Input: -2 -8. Output: 203. Expected Output: 0.',
                getDescriptionTab: () => ({ click: () => { result = null; } }),
            } }, document: {},
            safeSendMessage: async request => {
                if (request.operation === 'write') {
                    if (scenario === 'editor rerender') assert.equal(request.selector, '#replacement-editor');
                    if (request.expected !== value) return { ok: false, error: 'Editor changed' };
                    writes++; value = request.value;
                }
                return { ok: true, value };
            },
            apiRequest: async (_path, _method, body) => {
                assert.equal(body.practice_type, 'code'); assert.equal(body.language, 'python');
                assert.equal(body.review_before_submit, true);
                assert.equal(body.starter_code, 'starter');
                assert.equal(body.repair_attempt, submits === 0 ? 0 : 1);
                if (submits === 0) assert.match(body.text, /starter/);
                if (scenario === 'repair failure' && submits === 1) assert.match(body.text, /Expected Output: 0/);
                if (scenario === 'changed question') changed = true;
                if (scenario === 'stop during solve') automation.running = false;
                if (scenario === 'changed editor') value = 'user edit';
                return { ok: true, data: { code_reviewed: scenario !== 'unreviewed code', results: JSON.stringify([{ type: 'code', code: 'print("hello")' }]) } };
            },
            waitWhilePaused: async () => automation.running,
            reviewCodingAction: async () => true,
            getAutomationContext: () => ({}), automationPolicy: { canExecute: () => true },
            getAuthorizedQuestion: () => submits && scenario.includes('submissions tab') ? null : changed ? { signature: 'two' } : scenario === 'editor rerender' ? { ...question, editorSelector: '#replacement-editor' } : question,
            updateAutomationUI: () => {}, stopAutomation: state => { automation.state = state; automation.running = false; },
        });
        vm.runInContext(runner, context);
        await context.runCodingAutomation(question, 1);
        const successful = scenario === 'success' || scenario === 'repair failure' || scenario === 'editor rerender' || scenario.includes('submissions tab');
        assert.equal(submits, scenario === 'repair failure' ? 2 : successful ? 1 : 0);
        assert.equal(writes, scenario === 'repair failure' ? 2 : successful ? 1 : 0);
        if (scenario === 'repair failure') assert.equal(automation.completed, 1);
        if (scenario === 'success') { assert.equal(automation.state, 'COMPLETED'); assert.equal(automation.completed, 1); }
        if (scenario === 'submissions tab') { assert.equal(automation.state, 'COMPLETED'); assert.equal(automation.completed, 1); }
        if (scenario === 'batch submissions tab') { assert.equal(automation.running, true); assert.equal(automation.completed, 4); assert.ok(automation.batch); }
    });
}
