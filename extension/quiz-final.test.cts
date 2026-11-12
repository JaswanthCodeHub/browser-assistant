const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
test('final Submit requires last question, all answered, and no pending questions',()=>{
    const {document,window}=parseHTML('<html><body><main><p id="position">20 of 20 Questions</p><button id="local">Submit</button></main><aside><h3>QUESTION PALETTE</h3><div>20 Answered</div><div id="pending">0 Pending</div><button>Submit Quiz</button></aside></body></html>');
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`,'utf8'),vm.createContext({window,URL}));
    const adapter=window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    assert.equal(adapter.getFinalQuizSubmit(document).id,'local');
    document.querySelector('#pending').textContent='1 Pending';
    assert.equal(adapter.getFinalQuizSubmit(document),null);
    document.querySelector('#pending').textContent='0 Pending';document.querySelector('#position').textContent='19 of 20 Questions';
    assert.equal(adapter.getFinalQuizSubmit(document),null);
});
test('final runner clicks once, confirms targeted dialog, and waits for completion',async()=>{
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    let clicks=0,confirms=0,now=0;
    const adapter={id:'semantic-mcq',isComplete:()=>confirms===1,getQuizConfirmation:()=>clicks===1?{click:()=>{confirms++;}}:null};
    const context=vm.createContext({document:{},automation:{running:true,runId:1},Date:{now:()=>now},
        updateAutomationUI(){},waitWhilePaused:async()=>true,getAutomationContext:()=>({mode:'FULL'}),getAutomationAdapter:()=>adapter,
        automationPolicy:{canExecute:()=>true},setTimeout:(fn,ms)=>{now+=ms;fn();}});
    vm.runInContext(source.slice(source.indexOf('    async function submitCompletedQuiz('),source.indexOf('    async function waitForAdvanceOrTransition(')),context);
    assert.equal(await context.submitCompletedQuiz({click:()=>{clicks++;}},adapter,1),true);
    assert.equal(clicks,1);assert.equal(confirms,1);
});

test('Confirm Submit in the portal modal is blocked until Saving completes',()=>{
    const {document,window}=parseHTML('<html><body><small id="save">Saving...</small><div><h3>Submit quiz?</h3><p>You will not be able to change your answers after this.</p><button>Cancel</button><button id="confirm">Confirm Submit</button></div></body></html>');
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`,'utf8'),vm.createContext({window,URL}));
    const adapter=window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    assert.equal(adapter.getQuizConfirmation(document),null);
    document.querySelector('#save').textContent='Saved';
    assert.equal(adapter.getQuizConfirmation(document).id,'confirm');
});
