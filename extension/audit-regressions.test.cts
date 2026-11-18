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

test('linked-list stack push drags the current row even when the portal replaces the controls', async () => {
    const { parseHTML } = require('linkedom');
    const { document, window } = parseHTML('<html><body><main id="generic-question-container">'
        + '<p id="generic-question-wrapper-id">Arrange the steps in the correct order for the <code>push()</code> operation in a stack implemented using a linked list.</p>'
        + '<div id="steps"></div><button>Submit</button></main></body></html>');
    const steps = document.getElementById('steps');
    steps.innerHTML = ['Update the <code>top</code> pointer to <code>temp</code> .',
        'Create a new node with <code>temp</code> pointing to it.',
        'Point <code>temp→next</code> to <code>top</code> .'].map((label, index) =>
        '<div data-step="' + (index + 1) + '"><span draggable="true" class="drag-icon-container">Move</span>'
        + '<span class="drag-and-drop-option-label">' + label + '</span></div>').join('');
    window.HTMLElement.prototype.getClientRects = () => [{}];
    window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 40 });
    const context = vm.createContext({ document, window, URL, DataTransfer: class { setData() {} }, DragEvent: window.Event, setTimeout: fn => fn() });
    for (const file of ['automation-policy.js', 'editor-bridge.js']) {
        vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
    }
    let movingId;
    let drops = 0;
    steps.addEventListener('dragstart', event => { movingId = event.target.parentElement.dataset.step; steps.innerHTML = steps.innerHTML; });
    steps.addEventListener('dragenter', () => { steps.innerHTML = steps.innerHTML; });
    steps.addEventListener('dragover', () => { steps.innerHTML = steps.innerHTML; });
    steps.addEventListener('drop', event => {
        drops++;
        const currentRow = [...steps.children].find(row => row.dataset.step === movingId);
        steps.insertBefore(currentRow, event.target.closest('[data-step]'));
    });
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const question = adapter.getQuestion(document);
    assert.equal(question.dragKind, 'native-ccbp');
    assert.equal(await adapter.applyOrder(document, question, [1, 2, 0], () => true, context.browserAssistantOrderingDrag), true);
    assert.deepEqual([...steps.children].map(row => Number(row.dataset.step)), [2, 3, 1]);
    assert.equal(drops, 2);
});

function orderingDropFixture() {
    const { parseHTML } = require('linkedom');
    const prompt = 'Arrange the stack push steps';
    const labels = ['Make temp the new top', 'Allocate temp', 'Link temp to the old top'];
    const { document, window } = parseHTML('<html><body><main id="generic-question-container">'
        + '<p id="generic-question-wrapper-id">' + prompt + '</p><section id="steps">'
        + labels.map((label, index) => '<div data-row="' + index + '" draggable="false">'
            + '<span class="drag-icon-container" draggable="true">Move</span>'
            + '<span class="drag-and-drop-option-label">' + label + '</span></div>').join('')
        + '</section></main></body></html>');
    const steps = document.getElementById('steps');
    const handleSelector = '.drag-icon-container';
    const labelSelector = '.drag-and-drop-option-label';
    for (const row of steps.children) {
        const top = () => 100 + [...steps.children].indexOf(row) * 50;
        for (const [element, left, width] of [
            [row, 20, 240], [row.querySelector(handleSelector), 20, 30], [row.querySelector(labelSelector), 50, 210],
        ]) {
            element.getBoundingClientRect = () => ({ top: top(), bottom: top() + 50, height: 50, left, right: left + width, width });
            element.getClientRects = () => [element.getBoundingClientRect()];
        }
    }
    document.elementFromPoint = (x, y) => {
        if (x < 20 || x >= 260) return null;
        const row = steps.children[Math.floor((y - 100) / 50)];
        return row?.querySelector(x < 50 ? handleSelector : labelSelector) || null;
    };
    class Transfer {
        values = new Map();
        setData(type, value) { this.values.set(type, value); }
        getData(type) { return this.values.get(type) || ''; }
        get types() { return [...this.values.keys()]; }
    }
    class Drag extends window.Event {
        constructor(type, options) {
            super(type, options);
            this.dataTransfer = options.dataTransfer;
            this.clientX = options.clientX;
            this.clientY = options.clientY;
        }
    }
    class Pointer extends window.Event {
        constructor(type, options) {
            super(type, options);
            this.clientX = options.clientX;
            this.clientY = options.clientY;
            this.button = options.button;
            this.buttons = options.buttons;
        }
    }
    const context = vm.createContext({
        document, window, URL, DataTransfer: Transfer, DragEvent: Drag,
        PointerEvent: Pointer, MouseEvent: Pointer, setTimeout: fn => fn(),
    });
    vm.runInContext(fs.readFileSync(__dirname + '/editor-bridge.js', 'utf8'), context);
    return {
        steps, handleSelector, labelSelector,
        move: (from, to) => context.browserAssistantOrderingDrag(prompt, labels, from, to),
        order: () => [...steps.children].map(row => Number(row.dataset.row)),
    };
}

test('native ordering uses the row body and approaches from the correct side with populated drag data', async () => {
    for (const { from, to, expected } of [
        { from: 1, to: 0, expected: [1, 0, 2] },
        { from: 0, to: 2, expected: [1, 2, 0] },
    ]) {
        const { steps, handleSelector, labelSelector, move, order } = orderingDropFixture();
        let moving;
        let acceptedHover = false;
        let drops = 0;
        steps.addEventListener('dragstart', event => {
            assert.ok(event.target.matches(handleSelector));
            assert.ok(event.dataTransfer.getData('text/plain'));
            moving = event.target.closest('[data-row]');
        });
        steps.addEventListener('dragover', event => {
            const row = event.target.closest('[data-row]');
            const { top, height } = row.getBoundingClientRect();
            const onChosenSide = from > to ? event.clientY < top + height / 2 : event.clientY > top + height / 2;
            acceptedHover = event.target.matches(labelSelector) && onChosenSide
                && event.clientY > top && event.clientY < top + height;
            if (acceptedHover) event.preventDefault();
        });
        steps.addEventListener('drop', event => {
            drops++;
            if (!acceptedHover || !event.target.matches(labelSelector) || !event.dataTransfer.getData('text/plain')) return;
            const row = event.target.closest('[data-row]');
            steps.insertBefore(moving, from > to ? row : row.nextElementSibling);
        });
        assert.equal((await move(from, to)).ok, true);
        assert.deepEqual(order(), expected);
        assert.equal(drops, 1);
    }
});

test('native ordering only retries the legacy handle path when the row drop left the list unchanged', async () => {
    for (const behavior of ['handle-only', 'no-movement', 'unexpected-movement']) {
        const { steps, handleSelector, move, order } = orderingDropFixture();
        let moving;
        const attempts = [];
        steps.addEventListener('dragstart', event => { moving = event.target.closest('[data-row]'); });
        steps.addEventListener('drop', event => {
            const handle = event.target.matches(handleSelector);
            attempts.push(handle ? 'handle' : 'body');
            if (handle && behavior === 'handle-only') steps.insertBefore(moving, event.target.closest('[data-row]'));
            if (!handle && behavior === 'unexpected-movement') steps.appendChild(moving);
        });
        assert.equal((await move(1, 0)).ok, behavior === 'handle-only');
        assert.deepEqual(attempts, behavior === 'unexpected-movement' ? ['body'] : ['body', 'handle']);
        assert.deepEqual(order(), behavior === 'handle-only' ? [1, 0, 2]
            : behavior === 'unexpected-movement' ? [0, 2, 1] : [0, 1, 2]);
    }
});

test('native ordering presses the grip to activate the row and releases the pointer after dragging', async () => {
    for (const acceptDrop of [true, false]) {
        const { steps, handleSelector, labelSelector, move, order } = orderingDropFixture();
        let activatedRow;
        let draggingRow;
        let rowDrops = 0;
        const pressEvents = [];
        const releaseEvents = [];
        steps.addEventListener('pointerdown', event => {
            if (event.target.closest(handleSelector)) pressEvents.push(event.type);
        });
        steps.addEventListener('mousedown', event => {
            const handle = event.target.closest(handleSelector);
            if (!handle) return;
            pressEvents.push(event.type);
            activatedRow = handle.closest('[data-row]');
            activatedRow.setAttribute('draggable', 'true');
        });
        steps.addEventListener('dragstart', event => {
            draggingRow = event.target === activatedRow && event.target.matches('[draggable="true"]')
                ? activatedRow : null;
        });
        steps.addEventListener('dragover', event => {
            if (draggingRow && event.target.closest(labelSelector)) event.preventDefault();
        });
        steps.addEventListener('drop', event => {
            if (!draggingRow || !event.target.closest(labelSelector)) return;
            rowDrops++;
            if (acceptDrop) steps.insertBefore(draggingRow, event.target.closest('[data-row]'));
        });
        for (const type of ['mouseup', 'pointerup']) {
            steps.ownerDocument.addEventListener(type, event => {
                releaseEvents.push(event.type);
                activatedRow?.setAttribute('draggable', 'false');
            });
        }
        assert.equal((await move(1, 0)).ok, acceptDrop);
        assert.deepEqual(order(), acceptDrop ? [1, 0, 2] : [0, 1, 2]);
        assert.deepEqual(pressEvents, ['pointerdown', 'mousedown']);
        assert.equal(rowDrops, 1);
        assert.deepEqual(releaseEvents, ['pointerup', 'mouseup']);
        assert.equal(activatedRow.getAttribute('draggable'), 'false');
    }
});

test('manual ordering guidance uses current positions and omits numbers if the question changed', () => {
    const source = fs.readFileSync(__dirname + '/content.js', 'utf8');
    const context = vm.createContext({});
    vm.runInContext(source.slice(source.indexOf('    function orderingReviewMessage('),
        source.indexOf('    async function prepareVisionQuestionContext(')), context);
    const original = { type: 'ordering', text: 'Stack push', options: [
        { text: 'Update the top' }, { text: 'Allocate a node' }, { text: 'Link to the old top' },
    ] };
    const current = { ...original, options: [original.options[1], original.options[0], original.options[2]] };
    assert.match(context.orderingReviewMessage(original, [1, 2, 0], current), /1 → 3 → 2/);
    assert.doesNotMatch(context.orderingReviewMessage(original, [1, 2, 0], {
        ...current, text: 'Another question',
    }), /\d/);
    assert.doesNotMatch(context.orderingReviewMessage(original, [1, 2, 0], {
        ...current, options: [current.options[0], current.options[1], { text: 'A different option' }],
    }), /\d/);
});

test('numeric answers are values, preserve zero and signs, and are not option numbers', () => {
    const src = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
    const context = vm.createContext({});
    vm.runInContext(src.slice(src.indexOf('    function answerIndexesFromResult'), src.indexOf('    function updateAutomationUI')), context);
    const question = { options: ['3', '2', '1', '4', '0', '-4'].map((text, index) => ({ text, index })) };
    for (const [answer, expected] of [['4', [3]], [0, [4]], ['-4', [5]], ['Option D: 4', [3]], ['Option 4', []], ['Option A: 4', []]]) {
        assert.deepEqual(Array.from(context.answerIndexesFromResult([{ answer }], question)), expected);
    }
});

test('verified matrix options tolerate display notation while preserving signs, order and option labels', () => {
    const source = fs.readFileSync(__dirname + '/content.js', 'utf8');
    const context = vm.createContext({});
    vm.runInContext(source.slice(source.indexOf('    function answerIndexesFromResult'), source.indexOf('    function updateAutomationUI')), context);
    const question = {
        options: [
            { index: 0, text: '$\\begin{bmatrix}3&1\\\\5&2\\end{bmatrix}$' },
            { index: 1, text: '$\\begin{bmatrix}3&-1\\\\-5&2\\end{bmatrix}$' },
        ],
    };
    for (const [answer, expected] of [
        ['B. [[3, −1], [-5, 2]]', [1]],
        ['Option B: \\(\\begin{pmatrix}3 & -1 \\\\ -5 & 2\\end{pmatrix}\\)', [1]],
        ['Option A: [[3,-1],[-5,2]]', []],
        ['Option B: [[3,-5],[-1,2]]', []],
    ]) assert.deepEqual(Array.from(context.answerIndexesFromResult([{ answer }], question)), expected);
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
    const end = src.indexOf('    function updateAutomationUI', begin);
    const context = vm.createContext({});
    vm.runInContext(src.slice(begin, end), context);
    const question = { selectionType: 'multiple', options: ['One', 'Two', 'Three'].map((text, index) => ({ text, index })) };
    assert.deepEqual(Array.from(context.answerIndexesFromResult([{answer: 'Option A: One; Option C: Three'}], question)), [0, 2]);
});

test('Big-O options match through backticks and spacing while preserving operators and labels', () => {
    const src = fs.readFileSync(__dirname + '/content.js', 'utf8');
    const context = vm.createContext({});
    vm.runInContext(src.slice(src.indexOf('    function answerIndexesFromResult'), src.indexOf('    function updateAutomationUI')), context);
    const question = { options: ['\x60O(N log M)\x60', '\x60O(N + M)\x60', '\x60O(N^2)\x60', '\x60O(M^2)\x60']
        .map((text, index) => ({ text, index })) };
    for (const [answer, expected] of [['Option B: O(N+M)', [1]], ['O(N + M)', [1]], ['Option A: O(N+M)', []], ['O(N*M)', []]]) {
        assert.deepEqual(Array.from(context.answerIndexesFromResult([{ answer }], question)), expected);
    }
});

test('answer mapping requires the option letter and text to agree for text and chart questions', () => {
    const src = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
    const context = vm.createContext({});
    vm.runInContext(src.slice(src.indexOf('    function answerIndexesFromResult'), src.indexOf('    function updateAutomationUI')), context);
    const question = { options: ['24.78 %', '16.67 %', '13.33 %', '22.56 %'].map((text, index) => ({ text, index })) };
    for (const [answer, expected] of [
        ['Option B: 16.67%', [1]], ['B. 16.67 %', [1]], ['Option A: 16.67%', []],
        ['Option B: 1667%', []], ['Option B', []], ['16.67% is the answer', []],
    ]) {
        assert.deepEqual(Array.from(context.answerIndexesFromResult([{ answer }], question)), expected);
    }
    assert.deepEqual(Array.from(context.answerIndexesFromResult([
        { answer: 'Option B: 16.67%' }, { answer: 'Option A: 24.78%' },
    ], question)), []);
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

test('visible checkbox question is bound to its own prompt and ignores stale coding wrappers', () => {
    const { parseHTML } = require('linkedom');
    const { document, window } = parseHTML(`<html><body><main>
        <div id="generic-question-wrapper-id" hidden><p>Return the sum of the two numbers represented by linked lists.</p><pre>stale code</pre></div>
        <div id="exam-question-wrapper-id"><p>Find the number of nodes in a different exercise.</p><pre>unrelated code</pre></div>
        <form><h3>What happens when both nodes being compared have equal values?</h3>
            <div><label><input type="checkbox">Skip both nodes</label>
            <label><input type="checkbox">Add the node from the first list to the merged list</label>
            <label><input type="checkbox">Add the node from the second list to the merged list</label></div>
            <button>Submit</button>
        </form>
    </main></body></html>`);
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({ window, URL }));
    const question = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq').getQuestion(document);
    assert.equal(question.text, 'What happens when both nodes being compared have equal values?');
    assert.equal(question.identityText, question.text);
    assert.equal(question.options.length, 3);
    assert.equal(question.selectionType, 'multiple');
});

test('semantic adapter preserves every linked blank before a shared Submit', () => {
    const { parseHTML } = require('linkedom');
    const { document, window } = parseHTML(`<html><body><main><p>The football match started late because the other team did not (1) ____ on time. Arjun tried hard to (2) ____ a goal. Everyone felt very (3) ____.</p><form>
        <section><p>Which word best fits blank (1)?</p><label><input type="radio" name="one">stay</label><label><input type="radio" name="one">come</label><label><input type="radio" name="one">go</label><label><input type="radio" name="one">leave</label></section>
        <section><p>Which word best fits blank (2)?</p><label><input type="radio" name="two">score</label><label><input type="radio" name="two">take</label><label><input type="radio" name="two">win</label><label><input type="radio" name="two">make</label></section>
        <section><p>Which word best fits blank (3)?</p><label><input type="radio" name="three">quiet</label><label><input type="radio" name="three">cloudy</label><label><input type="radio" name="three">hungry</label><label><input type="radio" name="three">happy</label></section><button>Submit</button></form></main></body></html>`);
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({ window, URL }));
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const question = adapter.getQuestion(document);
    assert.equal(question.type, 'compound-mcq');
    assert.equal(question.compoundQuestions.length, 3);
    assert.match(question.compoundContext, /football match/);
    assert.equal(question.compoundQuestions[1].options[0].text, 'score');
    assert.equal(adapter.getSubmit(document, question), document.querySelector('button'));
    document.querySelectorAll('section')[1].remove();
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
