const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

test('project bridge writes each file to its own Ace session and rejects concurrent edits before any writes', () => {
    const values = { html: '<p>Starter</p>', css: 'p {color:red}', javascript: '' };
    const nodes = Object.fromEntries(Object.keys(values).map(name => ['#'+name+'Editor', {
        matches: () => true, closest: () => null,
        env: { editor: { getReadOnly: () => false, getValue: () => values[name], setValue: v => { values[name] = v; } } },
    }]));
    const context = vm.createContext({ document: {querySelectorAll: selector => nodes[selector] ? [nodes[selector]] : []} });
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`, 'utf8'), context);
    const bridge = context.browserAssistantEditor;
    const before = bridge('readProject').value;
    const output = JSON.stringify({html:'<button id="send">Send</button>',css:'button {color:blue}',javascript:'document.querySelector("#send").onclick = () => {};'});
    assert.equal(bridge('writeProject', null, before, output).ok, true);
    assert.deepEqual(values, JSON.parse(output));
    const previous = {...values};
    values.css = 'user changed css';
    assert.equal(bridge('writeProject', null, output, before).ok, false);
    assert.equal(values.html, previous.html);
    assert.equal(values.css, 'user changed css');
});

test('three-file tabs identify a web project and testcase counts detect failure/pass', () => {
    const { document, window } = parseHTML(`<html><body><div id="codingQuestionInfoContainer"><h2>HTTP Post Practice</h2><p>Build a page with a button, textarea and fetch handler.</p></div>
      <main><div data-testid="HTML">HTML</div><div data-testid="CSS">CSS</div><div data-testid="JAVASCRIPT">JAVASCRIPT</div>
      <div id="htmlEditor" class="ace_editor"></div><div id="cssEditor" class="ace_editor" hidden></div><div id="javascriptEditor" class="ace_editor" hidden></div><button>Submit</button></main>
      <div id="submitResultContainer"><div class="TestCaseSummaryCard-x"><span class="TestCaseSummaryLabel-x">Total</span><span class="TestCaseSummaryCount-x">5</span></div>
      <div class="TestCaseSummaryCard-x"><span class="TestCaseSummaryLabel-x">Passed</span><span class="TestCaseSummaryCount-x" id="passed">0</span></div>
      <div class="TestCaseSummaryCard-x"><span class="TestCaseSummaryLabel-x">Failed</span><span class="TestCaseSummaryCount-x" id="failed">5</span></div></div></body></html>`);
    window.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
    const context = vm.createContext({window:{},document});
    vm.runInContext(fs.readFileSync(`${__dirname}/coding-automation.js`,'utf8'),context);
    const coding = context.window.BrowserAssistantCoding;
    assert.equal(coding.getQuestion(document).language, 'web');
    assert.equal(coding.getResult(document), 'failed');
    document.querySelector('#passed').textContent = '5'; document.querySelector('#failed').textContent = '0';
    assert.equal(coding.getResult(document), 'passed');
    document.querySelector('#passed').textContent = '0';
    assert.equal(coding.getResult(document), null);
});
