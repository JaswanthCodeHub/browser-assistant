const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

test('letter cards read choices, verify actual selection and use Save & Next', () => {
    const { document, window } = parseHTML(`<html><body><main>
      <h2>Choose the matching definition for this practice question.</h2>
      <div id="options"><div aria-pressed="false"><span>A</span><span>First definition</span></div>
      <div aria-pressed="false"><span>B</span><span>Second definition</span></div></div>
      <button>Mark for Review</button><button id="next">Save &amp; Next</button>
      <button>Submit Quiz</button></main><aside><button>1</button><button>2</button></aside></body></html>`);
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({ window, URL }));
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const question = adapter.getQuestion(document);
    assert.equal(question.options.length, 2);
    assert.equal(question.options[1].text, 'Second definition');
    assert.equal(question.options[1].isSelected(), false);
    question.options[1].control.setAttribute('aria-pressed', 'true');
    assert.equal(question.options[1].isSelected(), true);
    assert.equal(adapter.getSubmit(document, question).id, 'next');
    document.querySelector('#options div span').textContent = 'D';
    assert.equal(adapter.getQuestion(document), null);
});

test('saved marker confirms the card without changing its answer text', () => {
    const { document, window } = parseHTML('<html><body><main><h2>Choose one option for this practice question.</h2><div><div id="first"><span>A</span><span>First answer</span></div><div id="second"><span>B</span><span>Second answer</span></div></div><button>Save &amp; Next</button></main></body></html>');
    window.HTMLElement.prototype.getClientRects = () => [{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`, 'utf8'), vm.createContext({window,URL}));
    const adapter = window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const before = adapter.getQuestion(document);
    document.querySelector('#second').outerHTML = '<div id="second"><span>B</span><span>Second answer</span><small>saved</small></div>';
    const after = adapter.getQuestion(document);
    assert.equal(after.options[1].text,before.options[1].text);
    assert.equal(after.options[1].isSelected(),true);
    assert.equal(after.options[0].isSelected(),false);
    assert.equal(before.options[1].isSelected(),false);
});

for (const scenario of ['rerender', 'unselected', 'different question']) {
    test(`selection verification handles ${scenario} without trusting a click alone`, async () => {
        const source = fs.readFileSync(`${__dirname}/content.js`,'utf8');
        let now=0;
        const original={text:'Original question',options:[{text:'First answer',isSelected:()=>false}]};
        let fresh=original;
        const context=vm.createContext({automation:{running:true,runId:1},Date:{now:()=>now},
            setTimeout:(fn,ms)=>{now+=ms;fresh={text:scenario==='different question'?'Changed question':original.text,options:[{text:'First answer',isSelected:()=>scenario!=='unselected'}]};fn();},
            waitWhilePaused:async()=>true,getAutomationContext:()=>({mode:'FULL'}),automationPolicy:{canExecute:()=>true},
            getAuthorizedQuestion:()=>fresh,getAutomationAdapter:()=>({}),hasSameQuestionOptions:(a,b)=>a.text===b.text&&a.options[0].text===b.options[0].text});
        vm.runInContext(source.slice(source.indexOf('    async function waitForOptionSelection('),source.indexOf('    async function waitForPracticeTransition(')),context);
        const result=await context.waitForOptionSelection(original,0,1);
        if(scenario==='rerender') {assert.ok(result);assert.notEqual(result,original);}
        else assert.equal(result,null);
    });
}

test('nested saved/saving labels preserve option identity across autosave renders', () => {
    const {document,window}=parseHTML('<html><body><main><h2>Choose an answer for this sample question.</h2><div><div><span>A</span><div><span>First answer</span></div></div><div id="card"><span>B</span><div><span>Second answer</span><div><small>saving...</small></div></div></div></div></main></body></html>');
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`,'utf8'),vm.createContext({window,URL}));
    const adapter=window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    let question=adapter.getQuestion(document);
    assert.equal(question.options[1].text,'Second answer');
    assert.equal(question.options[1].isSelected(),false);
    document.querySelector('small').textContent='saved';
    question=adapter.getQuestion(document);
    assert.equal(question.options[1].text,'Second answer');
    assert.equal(question.options[1].isSelected(),true);
});

test('selection waits for a slow autosave even when the selected flag is already true',async()=>{
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    let now=0,sawWaiting=false;
    const question={text:'Same question',options:[{text:'Chosen answer',isSelected:()=>true,getSaveState:()=>now<5000?'saving':'saved'}]};
    const automation={running:true,runId:1};
    const context=vm.createContext({automation,document:{},Date:{now:()=>now},setTimeout:(fn,ms)=>{now+=ms;fn();},
        waitWhilePaused:async()=>true,getAutomationContext:()=>({mode:'FULL'}),automationPolicy:{canExecute:()=>true},
        getAuthorizedQuestion:()=>question,getAutomationAdapter:()=>({isSaving:()=>now<5000}),
        updateAutomationUI:()=>{if(automation.state==='WAITING_FOR_SAVE')sawWaiting=true;},hasSameQuestionOptions:()=>true});
    vm.runInContext(source.slice(source.indexOf('    async function waitForOptionSelection('),source.indexOf('    async function waitForPracticeTransition(')),context);
    assert.ok(await context.waitForOptionSelection(question,0,1));
    assert.equal(sawWaiting,true);assert.ok(now>=5150);
});
