const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture(language = 'Python 3.10') {
    const { document, window } = parseHTML(`<html><body>
        <div><div><button>Description</button><button>Submissions</button><button>Tutorial</button></div>
        <div><h2>Product of 37, 61 and 391</h2><span>Solved</span><span>Easy</span>
        <p>Write a program that prints the product of three numbers, 37, 61 and 391.</p>
        <p>Sample Input</p><p>Sample Output</p><pre>882487</pre></div></div>
        <div id="editor-pane"><div><span>${language}</span></div><div class="ace_editor">starter code</div></div>
        <div id="assistant-root"><span>Java</span><p>Previous question</p></div>
    </body></html>`);
    window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
    const context = vm.createContext({ document, window: {} });
    vm.runInContext(fs.readFileSync(`${__dirname}/coding-automation.js`, 'utf8'), context);
    return { document, detect: () => context.window.BrowserAssistantCoding.getQuestion(document), diagnostic: () => context.window.BrowserAssistantCoding.getDetectionError(), result: () => context.window.BrowserAssistantCoding.getResult(document) };
}

test('external IDE question keeps all Node.js requirements and uses only the portal Open IDE control', () => {
    const {document,window} = parseHTML(`<html><body><div id="codingQuestionInfoContainer"><div id="mark-down">
        <h1>Cricket Team</h1><p>Write app.js using Express and cricketTeam.db.</p>
        <h3>API 1</h3><p>GET /players/</p><h3>API 5</h3><p>DELETE /players/:playerId/</p>
    </div></div><aside><span>ccbp submit EXAMPLE5A1</span><button>Open IDE</button></aside></body></html>`);
    window.HTMLElement.prototype.getClientRects = () => [{}];
    const ctx = vm.createContext({window,document});
    vm.runInContext(fs.readFileSync(`${__dirname}/coding-automation.js`, 'utf8'),ctx);
    const detect = location => window.BrowserAssistantCoding.getOnlineIdeQuestion(document,location);
    const portal = {origin:'https://learning.ccbp.in',pathname:'/question/11111111-2222-4333-8444-555555555555'};
    const found = detect(portal);
    assert.equal(found.title,'Cricket Team');
    assert.match(found.text,/API 5/);
    assert.doesNotMatch(found.text,/ccbp submit/);
    assert.equal(found.workspace,'EXAMPLE5A1');
    assert.equal(found.button,document.querySelector('button'));
    assert.equal(detect({...portal,origin:'https://other.test'}),null);
    document.querySelector('button').disabled = true;
    assert.equal(detect(portal),null);
});

test('detects screenshot-style description and plain Python 3.10 toolbar label', () => {
    const { detect } = fixture();
    const question = detect();
    assert.ok(question);
    assert.equal(question.language, 'python');
    assert.match(question.text, /Product of 37, 61 and 391/);
    assert.match(question.text, /882487/);
    assert.doesNotMatch(question.text, /starter code|Previous question/);
});

test('unknown or conflicting toolbar languages never default to Python', () => {
    assert.equal(fixture('Select language').detect(), null);
    const { document, detect } = fixture();
    const label = document.createElement('span'); label.textContent = 'Java';
    document.querySelector('#editor-pane').appendChild(label);
    assert.equal(detect(), null);
});

test('plain div problem title beside status is preferred over Input/Output section headings', () => {
    const { document, detect } = fixture();
    document.body.firstElementChild.innerHTML = '<div><div>Parsing Datetime</div><span>In Progress</span></div><p>Write a program to convert a string into a datetime object.</p><h3>Input</h3><p>A date string.</p><h3>Output</h3><p>Datetime object.</p>';
    assert.equal(detect().title, 'Parsing Datetime');
});

test('JavaScript runtime dropdown labels are recognized without guessing from source code', () => {
    for (const label of ['JavaScript', 'JS', 'Node.js', 'NodeJS', 'Node.js 18.15.0', 'Node.js (v18.15.0)', 'JavaScript (Node.js)', 'JavaScript (Node.js 12.18.3)', 'Language: JavaScript', 'Python3.10']) {
        assert.equal(fixture(label).detect()?.language, label === 'Python3.10' ? 'python' : 'javascript', label);
    }
    assert.equal(fixture('JavaScript or Python').detect(), null);
    assert.equal(fixture('Select language').detect(), null);
});

test('multiple visible editors are rejected; hidden editor does not block detection', () => {
    const { document, detect } = fixture();
    const editor = document.createElement('div'); editor.className = 'ace_editor';
    document.body.appendChild(editor);
    assert.equal(detect(), null);
    editor.hidden = true;
    assert.ok(detect());
});

test('reports the exact detection stage and clears stale errors after recovery', () => {
    const { document, detect, diagnostic } = fixture('Select language');
    assert.equal(detect(), null);
    assert.match(diagnostic(), /CODE-LANGUAGE/);
    document.querySelector('#editor-pane span').textContent = 'Python 3.10';
    assert.ok(detect());
    assert.equal(diagnostic(), '');
    document.querySelector('.ace_editor').remove();
    assert.equal(detect(), null);
    assert.match(diagnostic(), /CODE-EDITOR:/);
});

test('reports missing description separately from missing editor', () => {
    const { document, detect, diagnostic } = fixture();
    document.body.firstElementChild.remove();
    assert.equal(detect(), null);
    assert.match(diagnostic(), /CODE-DESCRIPTION:/);
});

test('five Ace boxes: selects solution beside Submit and preserves every example', () => {
    const { document, detect } = fixture('C++');
    const description = document.body.firstElementChild;
    description.innerHTML = `<button>Description</button><h2>Maximum Number of Collinear Points</h2>
        <p>Given an array of points, find the maximum number of points on a straight line.</p>
        <p>Example 1:</p><p>Input:</p><div class="ace_editor">arrPoints = [[1,1], [2,3], [3,5]]</div>
        <p>Output:</p><div class="ace_editor">3</div>
        <p>Example 2:</p><p>Input:</p><div class="ace_editor">arrPoints = [[1,1], [2,2]]</div>
        <p>Output:</p><div class="ace_editor">2</div>`;
    const pane = document.querySelector('#editor-pane');
    const submit = document.createElement('button'); submit.textContent = 'Submit'; pane.appendChild(submit);
    const question = detect();
    assert.ok(question);
    assert.equal(question.language, 'cpp');
    assert.match(question.text, /Example 2/);
    assert.match(question.text, /\[2,2\]/);
    const solution = pane.querySelector('.ace_editor');
    assert.equal(document.querySelector(question.editorSelector), solution);
    assert.equal(detect().editorSelector, question.editorSelector);

    let code = 'class solution {}';
    solution.env = { editor: { getReadOnly: () => false, getValue: () => code, setValue: value => { code = value; } } };
    const bridgeContext = vm.createContext({ document });
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`, 'utf8'), bridgeContext);
    const bridge = bridgeContext.browserAssistantEditor;
    assert.equal(bridge('read', question.editorSelector).value, code);
    assert.equal(bridge('write', question.editorSelector, code, 'class solution { /* generated */ };').ok, true);
    assert.equal(code, 'class solution { /* generated */ };');
    assert.equal(description.querySelectorAll('.ace_editor')[1].textContent, '3');
    solution.remove();
    assert.equal(bridge('write', question.editorSelector, code, 'replacement').ok, false);
});

test('read-only sample editors do not compete with solution editor', () => {
    const { document, detect } = fixture();
    const sample = document.createElement('div');
    sample.className = 'ace_editor'; sample.innerHTML = '<textarea readonly>example</textarea>';
    document.body.firstElementChild.appendChild(sample);
    assert.ok(detect());
});

test('two separate editors with Submit controls remain ambiguous', () => {
    const { document, detect, diagnostic } = fixture();
    const pane = document.querySelector('#editor-pane');
    const button = document.createElement('button'); button.textContent = 'Submit'; pane.appendChild(button);
    document.body.appendChild(pane.cloneNode(true));
    assert.equal(detect(), null);
    assert.match(diagnostic(), /CODE-EDITORS/);
});

test('status changing to Solved does not change the coding question text', () => {
    const { document, detect } = fixture();
    const status = [...document.querySelectorAll('span')].find(node => node.textContent === 'Solved');
    status.textContent = 'In Progress';
    const before = detect();
    status.textContent = 'Solved';
    assert.equal(detect().text, before.text);
});

test('Numbers in Square: plain Output heading and new Solved status are detected', () => {
    const { document, detect, result } = fixture();
    document.body.firstElementChild.innerHTML = `<button>Description</button><h2>Numbers in Square</h2>
        <span id="status">In Progress</span><p>Given a number N, write a program to print a Square of N rows.</p>
        <pre>1 2 3</pre><h3>Input</h3><p>The input is a single integer.</p>
        <h3>Output</h3><p>The output should be N rows and N columns.</p><h3>Explanation</h3><p>Print numbers.</p>`;
    const before = detect();
    assert.ok(before); assert.match(before.text, /Numbers in Square/);
    assert.equal(result(), null);
    document.querySelector('#status').textContent = 'Solved';
    assert.equal(result(), 'passed');
    assert.equal(detect().text, before.text);
    const alert = document.createElement('div'); alert.setAttribute('role', 'alert'); alert.textContent = 'Wrong answer'; document.body.appendChild(alert);
    assert.equal(result(), 'failed');
});

test('Accepted submission card is readable without the Description tab', () => {
    const { document, detect, result } = fixture();
    document.body.firstElementChild.innerHTML = '<button>Submissions</button><section><span>Accepted</span><span>5/5 Testcases Passed</span><p>14 Oct 2026, 21:12</p></section>';
    assert.equal(detect(), null);
    assert.equal(result(), 'passed');
});
