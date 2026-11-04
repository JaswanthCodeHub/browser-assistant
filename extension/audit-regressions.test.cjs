const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('short-answer identity ignores changing skip timer but detects actual prompt changes', () => {
    const { parseHTML } = require('linkedom');
    const { document, window } = parseHTML('<html><body><div id="generic-question-container"><div id="generic-question-wrapper-id"><p>Given [5, -3, 5], find the largest subarray sum.</p><p>Write a single integer.</p></div><textarea placeholder="Enter your answer"></textarea><button>Submit</button><div class="SkipButtonContainer-test">You can skip after <b>6</b> Seconds</div></div></body></html>');
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({ window, URL }));
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const original = adapter.getQuestion(document);
    document.querySelector('b').textContent = '1';
    assert.equal(adapter.getQuestion(document).text, original.text);
    document.querySelector('.SkipButtonContainer-test').textContent = 'If you skip, you can attempt this question again after finishing all questions';
    assert.equal(adapter.getQuestion(document).text, original.text);
    document.querySelector('#generic-question-wrapper-id p').textContent = 'Given [1, 2, 3], find the largest subarray sum.';
    assert.notEqual(adapter.getQuestion(document).text, original.text);
});

test('exported CCBP ordering page detects five options and verifies native drop changes', async () => {
    const { parseHTML } = require('linkedom');
    const fixture = fs.readFileSync(`${__dirname}/fixtures/ccbp-ordering.html`, 'utf8');
    const { document, window } = parseHTML(`<html><body>${fixture}</body></html>`);
    window.HTMLElement.prototype.getClientRects = () => [{}];
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 40 });
    class Transfer { setData() {} }
    class Drag extends window.Event { constructor(type, options) { super(type, options); this.dataTransfer = options.dataTransfer; } }
    const context = vm.createContext({ window, URL, DataTransfer: Transfer, DragEvent: Drag, setTimeout: fn => fn() });
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), context);
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const question = adapter.getQuestion(document);
    assert.equal(question.dragKind, 'native-ccbp');
    assert.equal(question.options.length, 5);
    assert.match(question.options[0].text, /^Update/);
    assert.equal(await adapter.applyOrder(document, question, [1, 3, 0, 2, 4], () => true), false);
    let source;
    document.addEventListener('dragstart', event => {
        const row = event.target.parentElement.parentElement;
        source = null;
        queueMicrotask(() => { source = row; });
    });
    document.addEventListener('drop', event => {
        if (!event.target.matches('.drag-icon-container')) return;
        const target = event.target.parentElement.parentElement;
        if (source) target.parentElement.insertBefore(source, target);
    });
    assert.equal(await adapter.applyOrder(document, question, [1, 3, 0, 2, 4], () => true), true);
    assert.match(adapter.getQuestion(document).options[0].text, /^Initialize/);
    assert.equal(await adapter.applyOrder(document, question, [1, 1, 0, 2, 4], () => true), false);
});

test('numeric answers are values, preserve zero and signs, and are not option numbers', () => {
    const src = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
    const context = vm.createContext({});
    vm.runInContext(src.slice(src.indexOf('    function answerIndexesFromResult'), src.indexOf('    async function recoverAnswerIndexes')), context);
    const question = { options: ['3', '2', '1', '4', '0', '-4'].map((text, index) => ({ text, index })) };
    for (const [answer, expected] of [['Answer: 4', 3], ['Answer 4', 3], [0, 4], ['-4', 5], ['**4**', 3], ['Option 4', 3]]) {
        assert.deepEqual(Array.from(context.answerIndexesFromResult([{ answer }], question)), [expected]);
    }
});

test('question diagnostic exports only the question region and strips active content', () => {
    const { parseHTML } = require('linkedom');
    const { document } = parseHTML('<html><body><header>Private profile</header><section><p>Rearrange these steps</p><div draggable="true" class="sortable" onclick="bad()" data-token="secret">First step</div><script>secret()</script><input value="secret"><button>Submit</button></section><div id="assistant-root">Assistant</div></body></html>');
    const source = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
    const start = source.indexOf('    function buildQuestionDiagnostic');
    const end = source.indexOf('    function exportQuestionDiagnostic', start);
    const context = vm.createContext({});
    vm.runInContext(source.slice(start, end), context);
    const output = context.buildQuestionDiagnostic(document);
    assert.match(output, /draggable="true"/);
    assert.doesNotMatch(output, /Private profile|secret|onclick|script|assistant-root/);
});

test('ordering adapter detects sortable items and refuses unchanged drag results', async () => {
    const { parseHTML } = require('linkedom');
    const { document, window } = parseHTML('<html><body><section><p>Rearrange the steps in the correct order:</p><div data-rbd-droppable-id="list"><div data-rbd-draggable-id="a" data-rbd-drag-handle-draggable-id="a">Return the result</div><div data-rbd-draggable-id="b" data-rbd-drag-handle-draggable-id="b">Initialize the sum</div></div><button>Submit</button></section></body></html>');
    window.HTMLElement.prototype.getClientRects = () => [{}];
    const context = vm.createContext({ window, URL, setTimeout: fn => fn(), KeyboardEvent: window.Event });
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), context);
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const question = adapter.getQuestion(document);
    assert.equal(question.type, 'ordering');
    assert.equal(question.options.length, 2);
    assert.equal(await adapter.applyOrder(document, question, [0, 1], () => true), true);
    assert.equal(await adapter.applyOrder(document, question, [1, 0], () => true), false);
    assert.equal(await adapter.applyOrder(document, question, [1, 0], () => false), false);
});

test('multiple choice mapping retains every explicitly selected option', () => {
    const src = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
    const begin = src.indexOf('    function answerIndexesFromResult');
    const end = src.indexOf('    async function recoverAnswerIndexes', begin);
    const context = vm.createContext({});
    vm.runInContext(src.slice(begin, end), context);
    const question = { selectionType: 'multiple', options: ['One', 'Two', 'Three'].map((text, index) => ({ text, index })) };
    assert.deepEqual(Array.from(context.answerIndexesFromResult([{answer: 'Option A: One; Option C: Three'}], question)), [0, 2]);
});

test('semantic adapter reads short answers and rejects ambiguous fields', () => {
    const { parseHTML } = require('linkedom');
    const { document, window } = parseHTML('<html><body><section><p>Given the array [5, -3, 5], what is the largest subarray sum?</p><p>Write the answer as a single integer.</p><textarea placeholder="Enter your answer"></textarea><button>SHOW ANSWER</button><button>SUBMIT</button></section></body></html>');
    window.HTMLElement.prototype.getClientRects = () => [{}];
    const context = vm.createContext({ window, URL });
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), context);
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const question = adapter.getQuestion(document);
    assert.equal(question.type, 'short-answer');
    assert.match(question.text, /\[5, -3, 5\]/);
    assert.doesNotMatch(question.text, /SHOW ANSWER/);
    assert.equal(adapter.getSubmit(document, question).textContent, 'SUBMIT');
    document.querySelector('section').appendChild(document.querySelector('textarea').cloneNode());
    assert.equal(adapter.getQuestion(document), null);
});

test('short-answer prompt outside the answer/actions wrapper is detected', () => {
    const { parseHTML } = require('linkedom');
    const { document, window } = parseHTML('<html><body><main><div><p>Given [5, -3, 5], find the maximum subarray sum.</p><p>Write a single integer.</p></div><div><textarea placeholder="Enter your answer"></textarea><div><div role="button">SHOW ANSWER</div><div role="button">SUBMIT</div></div></div></main></body></html>');
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({ window, URL }));
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const question = adapter.getQuestion(document);
    assert.equal(question.type, 'short-answer');
    assert.match(question.text, /maximum subarray sum/);
    assert.equal(adapter.getSubmit(document, question).textContent, 'SUBMIT');
});

test('MCQ with identical choices but a different prompt is rejected', () => {
    const src = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
    const begin = src.indexOf('    function hasSameQuestionOptions');
    const end = src.indexOf('    function getAuthorizedQuestion', begin);
    const context = vm.createContext({ normalizeAutomationText: value => value.replace(/\s+/g, ' ').trim() });
    vm.runInContext(src.slice(begin, end), context);
    const before = { text: 'Is 2 even?', options: [{ text: 'Yes' }, { text: 'No' }] };
    assert.equal(context.hasSameQuestionOptions(before, { ...before, text: 'Is 3 even?' }), false);
    assert.equal(context.hasSameQuestionOptions(before, { ...before, text: 'Is 2  even?' }), true);
});

test('background requests have bounded timeouts and identify timeout errors', async () => {
    let listener; let duration;
    const context = vm.createContext({ importScripts() {},
        chrome: { alarms: {create(){},onAlarm:{addListener(){}}}, runtime: {onInstalled:{addListener(){}}, onMessage: { addListener: fn => { listener = fn; } } } },
        AbortSignal: { timeout: ms => { duration = ms; return {}; } },
        fetch: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; },
    });
    vm.runInContext(fs.readFileSync(`${__dirname}/background.js`, 'utf8'), context);
    const response = await new Promise(resolve => listener({ action: 'apiRequest', path: '/health', method: 'GET' }, {}, resolve));
    assert.equal(duration, 8000);
    assert.match(response.error, /timed out/);
});

test('ordering drag is injected into the page main world only for CCBP', () => {
    const source = fs.readFileSync(`${__dirname}/background.js`, 'utf8');
    assert.match(source, /request\.action === 'orderingDrag'/);
    assert.match(source, /world: 'MAIN'/);
    assert.match(source, /browserAssistantOrderingDrag/);
    assert.match(source, /learning\.ccbp\.in/);
});
