const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
function markup(prompt,choices) {
    return `<main><div>${prompt}</div><div id="options">${choices.map((answer,index)=>
        `<div><span>${String.fromCharCode(65+index)}</span><span>${answer}</span></div>`).join('')}</div><button>Save &amp; Next</button></main>`;
}
function fixture(prompt,choices) {
    const {document,window}=parseHTML(`<html><body>${markup(prompt,choices)}</body></html>`);
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`,'utf8'),vm.createContext({window,URL}));
    return {document,adapter:window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq')};
}
for(const [prompt,choices] of [
    ['In the number 345, what is the digit 3 worth?',['345','300','3','30']],
    ['What does this Python line print? print(not 0)',['False','True','0','Error']],
    ['Choose one of the following single-character choices.',['0','1','2','3']],
])test(`letter cards retain all short options: ${choices.join(', ')}`,()=>{
    const {document,adapter}=fixture(prompt,choices);
    const question=adapter.getQuestion(document);
    assert.ok(question);assert.deepEqual(Array.from(question.options,option=>option.text),choices);
    assert.equal(adapter.getSubmit(document,question).textContent,'Save & Next');
});
test('bare letter badges without answer text are still rejected',()=>{
    const {document,adapter}=fixture('This is an incomplete question layout.',['','','','']);
    assert.equal(adapter.getQuestion(document),null);
});

for(const method of ['waitForPracticeTransition','waitForAdvanceOrTransition']) {
    for(const delay of [500,8500])test(`${method} recognizes the next numeric MCQ after ${delay}ms without clicks`,async()=>{
        const {document,adapter}=fixture('In the number 345, what is the digit 3 worth?',['345','300','3','30']);
        let now=0,changed=false;
        const read=()=>{const q=adapter.getQuestion(document);return q?{...q,signature:q.text+'|'+q.options.map(o=>o.text).join('|')}:null;};
        const previous=read().signature;
        const context=vm.createContext({document,automation:{running:true,runId:1},Date:{now:()=>now},
            setTimeout:(fn,ms)=>{now+=ms;if(!changed&&now>=delay){changed=true;document.body.innerHTML=markup('What does this Python line print? print(not 0)',['False','True','0','Error']);}fn();},
            waitWhilePaused:async()=>true,getAutomationContext:()=>({mode:'FULL'}),getAutomationAdapter:()=>adapter,
            getAuthorizedQuestion:read,updateAutomationUI(){}});
        vm.runInContext(source.slice(source.indexOf('    async function waitForPracticeTransition('),source.indexOf('    async function waitForNextPracticeQuestion(')),context);
        assert.equal(await context[method](previous,1,adapter),'next');
        assert.ok(now>=delay&&now<delay+200);
    });
}
test('MCQ detection failure does not reuse a missing coding-editor diagnostic',()=>{
    const ctx=vm.createContext({window:{location:{origin:'https://admissions.aurora.edu.in',pathname:'/quiz'},
        BrowserAssistantCoding:{getDetectionError:()=>{throw Error('Must not read coding diagnostics on this quiz');}}}});
    vm.runInContext(source.slice(source.indexOf('    function questionDetectionError('),source.indexOf('    async function waitForReadableQuestion(')),ctx);
    assert.match(ctx.questionDetectionError(),/question\/options/);
    assert.doesNotMatch(ctx.questionDetectionError(),/CODE-EDITOR/);
});
test('temporary missing controls are awaited; Stop cancels loading without a stale error',async()=>{
    let now=0;
    const automation={running:true,runId:1,targetId:'quiz'};
    const ctx=vm.createContext({automation,Date:{now:()=>now},waitWhilePaused:async()=>automation.running,
        getAutomationContext:()=>({mode:'FULL',target:{id:'quiz'}}),getAuthorizedQuestion:()=>null,
        updateAutomationUI(){},setTimeout:(fn,ms)=>{now+=ms;automation.running=false;fn();}});
    vm.runInContext(source.slice(source.indexOf('    async function waitForReadableQuestion('),source.indexOf('    let lastObservedAutomationUrl')),ctx);
    assert.equal(await ctx.waitForReadableQuestion(1),null);
    assert.equal(now,100);assert.equal(automation.state,'WAITING_FOR_QUESTION');
});
