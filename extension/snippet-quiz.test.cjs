const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

test('multi-file MCQ preserves HTML literals, filenames and Ace lines without gutters', () => {
    const { document, window } = parseHTML(`<html><body><section>
      <div id="generic-question-wrapper-id"><p>Considering both files, what is the HTTP response body?</p>
      <h4>File Name: tajMahal.html</h4><div class="ace_editor"><div class="ace_gutter">9999</div><div class="ace_line">&lt;html&gt;</div><div class="ace_line">&lt;h1&gt;Taj Mahal&lt;/h1&gt;</div><div class="ace_line">&lt;/html&gt;</div></div>
      <h4>File Name: index.js</h4><pre><code>response.sendFile('./tajMahal.html', { root: __dirname });</code></pre></div>
      <form><fieldset><div role="radiogroup"><div role="radio">Error</div><div role="radio">tajMahal.html file content</div></div></fieldset><button>Submit</button></form>
      </section></body></html>`);
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({ window, URL }));
    const question = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq').getQuestion(document);
    assert.match(question.text, /Considering both files/);
    assert.match(question.text, /File Name: tajMahal.html/);
    assert.match(question.text, /File Name: index.js/);
    assert.ok(question.text.includes('<html>\n<h1>Taj Mahal</h1>\n</html>'));
    assert.match(question.text, /response.sendFile/);
    assert.ok(!question.text.includes('9999'));
    assert.equal(question.options.length, 2);
});
