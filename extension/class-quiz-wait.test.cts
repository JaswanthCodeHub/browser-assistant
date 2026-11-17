const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

test('class waiting modal is detected separately from quiz completion', () => {
    const { document, window } = parseHTML('<html><body><div role="dialog"><h2>Answer Submitted</h2><p>Waiting for all students to submit</p><p>Do not close or refresh this window</p></div></body></html>');
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({window,URL}));
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    assert.equal(adapter.isWaitingForParticipants(document), true);
    assert.equal(adapter.isComplete(document), false);
    document.querySelector('[role="dialog"]').innerHTML = '<h2>Quiz Completed</h2>';
    assert.equal(adapter.isWaitingForParticipants(document), false);
    assert.equal(adapter.isComplete(document), true);
    document.querySelector('[role="dialog"]').innerHTML =
        '<h2 hidden>Waiting for Instructor to start the Quiz...</h2><p>If the instructor has already started the quiz, please reload the page.</p>';
    assert.equal(adapter.isWaitingForInstructor(document), false);
    document.querySelector('h2').removeAttribute('hidden');
    assert.equal(adapter.isWaitingForInstructor(document), true);
    assert.equal(adapter.isComplete(document), false);
});

for (const cancel of [false, true]) {
    test(`the instructor lobby ${cancel ? 'can be stopped' : 'waits past 15 seconds and allows the question to load'}`, async () => {
        let now = 0;
        const automation = {running: true, runId: 1, targetId: 'ccbp-learning-practice'};
        const question = {signature: 'first-question'};
        const adapter = {isWaitingForInstructor: () => now < 45_000};
        const source = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
        const context = vm.createContext({
            automation, document: {}, Date: {now: () => now},
            getAutomationContext: () => ({mode: 'FULL', target: {id: automation.targetId}}),
            getAutomationAdapter: () => adapter,
            waitWhilePaused: async () => automation.running,
            getAuthorizedQuestion: () => now >= 49_000 ? question : null,
            updateAutomationUI() {},
            setTimeout: (fn, ms) => {
                now += ms;
                if (cancel && now >= 20_000) automation.running = false;
                fn();
            },
        });
        vm.runInContext(source.slice(source.indexOf('    async function waitForReadableQuestion('),
            source.indexOf('    function isClassQuizRoute(')), context);
        const result = await context.waitForReadableQuestion(1);
        assert.equal(result, cancel ? null : question);
        assert.equal(now, cancel ? 20_000 : 49_000);
    });
}

for (const method of ['waitForPracticeTransition', 'waitForAdvanceOrTransition']) {
    test(`${method} waits through a 12-second class hold and resumes without clicking`, async () => {
        let now = 0, waitingStateSeen = false;
        const automation = {running:true,runId:1};
        const adapter = {id:'semantic-mcq',isComplete:()=>false,isWaitingForParticipants:()=>now<12000};
        const code = fs.readFileSync(`${__dirname}/content.js`,'utf8');
        const context = vm.createContext({automation, document:{}, Date:{now:()=>now},
            setTimeout: (fn,ms) => {now += ms; fn();}, waitWhilePaused:async()=>true,
            getAutomationContext:()=>({mode:'FULL'}),getAutomationAdapter:()=>adapter,
            getAuthorizedQuestion:()=>({signature:now<12000?'old':'next'}),
            updateAutomationUI:()=>{if(automation.state==='WAITING_FOR_CLASS')waitingStateSeen=true;}});
        vm.runInContext(code.slice(code.indexOf('    async function waitForPracticeTransition('),code.indexOf('    async function waitForNextPracticeQuestion(')),context);
        assert.equal(await context[method]('old',1,adapter),'next');
        assert.equal(waitingStateSeen,true);
        assert.ok(now>=12000);
    });
}
