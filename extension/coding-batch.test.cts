const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');
const vm = require('node:vm');
const fs = require('node:fs');
const source = name => fs.readFileSync(`${__dirname}/${name}`, 'utf8');

test('question matching tolerates title spacing but rejects different questions', () => {
    const { batch } = fixture();
    const selected = { title: 'Sum of Squares from M to N - 2', listUrl: 'https://learning.ccbp.in/problems-set', questionUrl: '/question/second' };
    const question = { type: 'code', title: 'Sum of Squares from M to N–2' };
    assert.equal(batch.matchesQuestion(question, selected, 'https://learning.ccbp.in/question/second'), true);
    assert.equal(batch.matchesQuestion(question, selected, 'https://learning.ccbp.in/question/first'), false);
    assert.equal(batch.matchesQuestion({ ...question, title: 'Sum of Squares from M to N - 3' }, selected, 'https://learning.ccbp.in/question/second'), false);
});

test('row arrow SVG labels are excluded from question titles', () => {
    const { document, batch } = fixture();
    const row = document.body.children[1];
    row.querySelector('button').innerHTML = '<svg><title>Open question</title></svg>';
    assert.equal(batch.rows(document)[0].title, 'Easy Sum');
});

test('batch matching ignores list difficulty suffixes while retaining question numbers', () => {
    const { batch } = fixture();
    const selected = { title: 'Parsing Datetime Easy', listUrl: 'https://learning.ccbp.in/problems-set' };
    assert.equal(batch.matchesQuestion({ type: 'code', title: 'Parsing Datetime' }, selected, 'https://learning.ccbp.in/question/date'), true);
    assert.equal(batch.matchesQuestion({ type: 'code', title: 'Parsing Datetime - 2' }, selected, 'https://learning.ccbp.in/question/date'), false);
});

test('actual CCBP missing difficulty dash is metadata, never part of selected title', () => {
    const { document, batch } = fixture();
    document.body.innerHTML = '<div data-testid="question-list-question"><span title="Parsing Datetime"><mark>Parsing Datetime</mark></span><span data-testid="question-difficulty">-</span><div><span data-testid="question-status-text">In Progress</span></div><div><svg></svg></div></div>';
    const selected = batch.rows(document)[0];
    assert.equal(selected.title, 'Parsing Datetime');
    assert.equal(batch.matchesQuestion({type:'code', title:'Parsing Datetime'}, {...selected,listUrl:'https://learning.ccbp.in/problems-set'}, 'https://learning.ccbp.in/question/date'), true);
    document.querySelector('span[title]').setAttribute('title', 'Datetime - 2');
    assert.equal(batch.rows(document)[0].title, 'Datetime - 2');
});

test('confirms only the save-code-before-leaving dialog', () => {
    const { document, batch } = fixture();
    const modal = document.createElement('div');
    modal.innerHTML = '<p>Do you want to save code before leaving?</p><button>NO</button><button>YES</button>';
    document.body.appendChild(modal);
    assert.equal(batch.getSaveBeforeLeaving(document), modal.lastElementChild);
    modal.querySelector('p').textContent = 'Delete this question?';
    assert.equal(batch.getSaveBeforeLeaving(document), null);
});

for (const accepted of [false, true]) {
    test(`direct Start solves the open question without returning to the list (old accepted result=${accepted})`, async () => {
        const content = source('content.js');
        const start = content.indexOf('    async function startPracticeAutomation()');
        const end = content.indexOf('    async function requestPracticeAnswer(', start);
        let solves=0, batches=0, resultReads=0;
        const location = { origin: 'https://learning.ccbp.in', href: 'https://learning.ccbp.in/question/example', pathname: '/question/example' };
        const question={type:'code',title:'Most Frequent Element',signature:'current-question',language:'cpp'};
        const automation={runId:0,running:false,processed:new Set(),error:'Previous Back button error'};
        const adapter={id:'semantic-mcq',isComplete:()=>false};
        const context = vm.createContext({ document: {}, location, automation,
            window: { location, BrowserAssistantCoding: { getResult: () => {resultReads++;return accepted ? 'passed' : null;} } },
            getAutomationContext:()=>({mode:'FULL',target:{id:'ccbp-learning-practice'}}),getAutomationAdapter:()=>adapter,
            automationPolicy:{canExecute:()=>true},getAuthorizedQuestion:()=>question,
            updateAutomationUI(){},waitWhilePaused:async()=>automation.running,
            startCodingBatch:async()=>{batches++;},
            runCodingAutomation:async(found,runId)=>{
                assert.equal(found,question);assert.equal(runId,automation.runId);
                assert.equal(automation.running,true);assert.equal(automation.error,'');
                solves++;automation.running=false;automation.state='COMPLETED';
            } });
        vm.runInContext(content.slice(start, end), context);
        await context.startPracticeAutomation();
        assert.equal(solves,1);assert.equal(batches,0);assert.equal(resultReads,0);
        assert.equal(automation.state,'COMPLETED');
    });
}

test('Start on the problem list still begins the filtered batch',async()=>{
    const content=source('content.js');
    let batches=0;
    const location={origin:'https://learning.ccbp.in',pathname:'/problems-set/'};
    const context=vm.createContext({window:{location},startCodingBatch:async()=>{batches++;}});
    vm.runInContext(content.slice(content.indexOf('    async function startPracticeAutomation()'),content.indexOf('    async function requestPracticeAnswer(')),context);
    await context.startPracticeAutomation();assert.equal(batches,1);
});

function fixture() {
    const { document, window } = parseHTML(`<html><body>
        <div><span>Hello World</span><span>Easy</span><span>Solved</span><button>→</button></div>
        <div><span>Easy Sum</span><span>Easy</span><span>Not Attempted</span><button>→</button></div>
        <div><span>Hard task</span><span>Hard</span><span>In Progress</span><button>→</button></div>
        <label><input type="checkbox">Not Attempted</label>
        <footer><span>1 TO 50 OF 1561</span><button>1</button><button>2</button><button disabled aria-label="Next">›</button></footer>
    </body></html>`);
    window.Element.prototype.getClientRects = () => [{}];
    const context = vm.createContext({ window: {}, document, URL });
    vm.runInContext(source('coding-batch.js'), context);
    return { document, batch: context.window.BrowserAssistantCodingBatch };
}

test('list chooses Not Attempted and In Progress, skips Solved, and preserves titles', () => {
    const { document, batch } = fixture();
    const rows = batch.rows(document);
    assert.equal(rows.length, 2); assert.equal(rows[0].title, 'Easy Sum');
    assert.equal(rows[1].title, 'Hard task');
    assert.equal(batch.nextPage(document).textContent, '2');
    assert.equal(batch.pageRange(document).total, 1561);
});

test('last page has no enabled next action', () => {
    const { document, batch } = fixture();
    document.querySelector('footer span').textContent = '1551 TO 1561 OF 1561';
    assert.equal(batch.nextPage(document), null);
});

test('course filter enables other courses before excluding DSA, without changing status', () => {
    const { document, batch } = fixture();
    const filters = document.createElement('section');
    filters.innerHTML = '<label><input type="checkbox" id="foundation">Programming Foundations</label><label><input type="checkbox" id="dsa">Data Structures &amp; Algorithms</label><label><input type="checkbox" id="static">Build Your Own Static Website</label>';
    document.body.appendChild(filters);
    const dsa = document.querySelector('#dsa'); dsa.checked = true;
    assert.equal(batch.courseFilterStep(document).control.id, 'foundation');
    document.querySelector('#foundation').checked = true;
    assert.equal(batch.courseFilterStep(document).control.id, 'static');
    document.querySelector('#static').checked = true;
    assert.equal(batch.courseFilterStep(document).control.id, 'dsa');
    dsa.checked = false;
    assert.equal(batch.courseFilterStep(document).ready, true);
    filters.remove();
    assert.ok(batch.courseFilterStep(document).error);
});

test('plain div/span pagination advances via delegated click', () => {
    const { document, batch } = fixture();
    const footer = document.querySelector('footer');
    footer.innerHTML = '<span>1 TO 50 OF 1561</span><div id="pager"><div><span>1</span></div><div><span>2</span></div><div><span>3</span></div><span>...</span><span>32</span></div>';
    let clicked = null;
    document.querySelector('#pager').addEventListener('click', event => { clicked = event.target.textContent; });
    const next = batch.nextPage(document);
    assert.ok(next); next.click(); assert.equal(clicked, '2');
});

test('numeric problem content is not mistaken for pagination', () => {
    const { document, batch } = fixture();
    document.querySelector('footer').innerHTML = '<span>1 TO 50 OF 1561</span>';
    const row = document.createElement('div');
    row.innerHTML = '<span>Question number</span><span>1</span><span>2</span>';
    document.body.appendChild(row);
    assert.equal(batch.nextPage(document), null);
});

test('disabled plain pager targets are not clicked', () => {
    const { document, batch } = fixture();
    document.querySelector('footer').innerHTML = '<span>1 TO 50 OF 1561</span><div><span>1</span><div aria-disabled="true"><span>2</span></div></div>';
    assert.equal(batch.nextPage(document), null);
});

for (const pass of [true, false]) {
    test(`batch opens an unattempted question and ${pass ? 'persists list return after passing' : 'does not advance after failure'}`, async () => {
        const sourceCode = source('content.js');
        const code = sourceCode.slice(sourceCode.indexOf('    const CODING_BATCH_KEY'), sourceCode.indexOf('    async function startPracticeAutomation'));
        const store = new Map(); let navigated = null, backClicks = 0;
        const automation = { runId: 0 };
        const location = { origin: 'https://learning.ccbp.in', href: 'https://learning.ccbp.in/problems-set', pathname: '/problems-set', assign: url => { navigated = url; } };
        const context = vm.createContext({
            URL, Date, location, automation, document: {}, isCollapsed: true, selectedTab: 'qa',
            sessionStorage: { setItem: (key, value) => store.set(key, value), getItem: key => store.get(key), removeItem: key => store.delete(key) },
            getAutomationContext: () => ({ mode: 'FULL', target: { id: 'ccbp-learning-practice' } }),
            automationPolicy: { canExecute: () => true }, render() {}, updateAutomationUI() {},
            stopAutomation: state => { automation.running = false; automation.state = state; },
            normalizeAutomationText: text => text,
            waitWhilePaused: async () => automation.running,
            getAuthorizedQuestion: () => ({ type: 'code', text: 'Easy Sum: print the sum' }),
            runCodingAutomation: async () => { if (pass) automation.completed++; else automation.running = false; return pass; },
            window: { BrowserAssistantCoding: { getDetectionError: () => '' }, BrowserAssistantCodingBatch: {
                pageRange: () => ({ start: 1, end: 50, total: 50 }),
                getBackControl: () => ({ click: () => { backClicks++; location.pathname = '/problems-set'; } }),
                pageKey: () => 'list', nextPage: () => null,
                rows: () => [{ title: 'Easy Sum', action: { click: () => { location.pathname = '/question/one'; } } }],
            } },
        });
        vm.runInContext(code, context);
        await context.startCodingBatch();
        const saved = JSON.parse(store.get('browserAssistantCodingBatch'));
        assert.equal(navigated, null);
        assert.equal(backClicks, pass ? 1 : 0);
        assert.equal(saved.phase, pass ? 'list' : 'busy');
        assert.equal(saved.completed, pass ? 1 : 0);
    });
}

test('uses Question Bank header Back, ignoring unrelated buttons', () => {
    const { document, batch } = fixture();
    const header = document.createElement('div');
    header.innerHTML = '<button aria-label="Back"><svg></svg></button><h2>QUESTION BANK</h2>';
    document.body.prepend(header);
    const back = batch.getBackControl(document, 'https://learning.ccbp.in/problems-set');
    assert.equal(back, header.querySelector('button'));
});

test('unlabelled Question Bank arrow uses its clickable wrapper', () => {
    const { document, batch } = fixture();
    const header = document.createElement('div');
    header.innerHTML = '<div id="back"><svg></svg></div><span>QUESTION BANK</span>';
    document.body.prepend(header);
    assert.equal(batch.getBackControl(document, 'https://learning.ccbp.in/problems-set'), header.querySelector('#back'));
});

test('no header Back does not fall back to an unrelated row arrow', () => {
    const { document, batch } = fixture();
    assert.equal(batch.getBackControl(document, 'https://learning.ccbp.in/problems-set'), null);
});
