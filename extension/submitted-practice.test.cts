const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
function load(ctx,start,end){vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),ctx);}
function fixture(html){
    const {document,window}=parseHTML(`<html><body>${html}</body></html>`);
    window.HTMLElement.prototype.getClientRects=function(){return this.hidden||this.closest('[hidden]')?[]:[{}];};
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`,'utf8'),vm.createContext({window,URL}));
    return {document,adapter:window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq')};
}
test('submitted CCBP multi-answer layout exposes Next even when all answer controls are disabled',()=>{
    const {document,adapter}=fixture(`<main><p>What are the advantages of a hash map?</p>
        <label><input type="checkbox" disabled checked>Lower time complexity</label>
        <label><input type="checkbox" disabled checked>Faster lookups</label>
        <div>+1</div><div id="next-button-container"><button id="next">NEXT</button></div></main>`);
    assert.equal(adapter.getQuestion(document),null);
    assert.equal(adapter.getSubmittedAdvance(document).id,'next');
    document.querySelector('main').insertAdjacentHTML('beforeend','<span>Saving...</span>');
    assert.equal(adapter.getSubmittedAdvance(document),null);
});
test('live primitive-coding layout uses default-question-next-button outside the generic next container',()=>{
    const {document,adapter}=fixture(`<div class="DefaultQuestionComponent___StyledDetailsContainer-k664ir-8">
        <div id="exam-question-wrapper-id">What is the space complexity of the hash map approach?</div>
        <div class="mcqItemsContainer" data-testid="radioGroupOptions">
            <label><input type="radio">O(1)</label><label><input type="radio" checked>O(N)</label>
        </div><div class="DefaultQuestionComponent___StyledScoreCard-k664ir-2">+1</div>
        <div class="DefaultQuestionComponent___StyledSubmitAndShowAnswerButtonsContainer-k664ir-6"></div>
        <div class="DefaultQuestionComponent___StyledNextAndShowExplanationButtonsContainer-k664ir-5">
            <button id="default-question-next-button" data-testid="next"><span>Next</span></button>
        </div></div>`);
    assert.equal(document.querySelector('#next-button-container'),null);
    assert.equal(adapter.getSubmittedAdvance(document).id,'default-question-next-button');
    document.querySelector('#default-question-next-button').setAttribute('aria-disabled','true');
    assert.equal(adapter.getSubmittedAdvance(document),null);
});
test('portal expiry is a blocking condition, not a successful completion',()=>{
    const {document,adapter}=fixture(`<div>Time's up! You cannot attempt this assessment now.</div><button>Retry</button>`);
    assert.match(adapter.getBlockingReason(document),/assessment has expired/);
    assert.equal(adapter.isComplete(document),false);
    document.body.innerHTML=`<div id="assistant-root"><p>Time's up! You cannot attempt this assessment now.</p></div>`;
    assert.equal(adapter.getBlockingReason(document),null);
});
for(const method of ['waitForPracticeTransition','waitForAdvanceOrTransition'])test(`${method} reports expiry without waiting for another question`,async()=>{
    const automation={running:true,runId:1};
    const adapter={id:'semantic-mcq',getBlockingReason:()=> 'The portal says this assessment has expired.'};
    const ctx=vm.createContext({document:{},automation,Date,waitWhilePaused:async()=>true,
        getAutomationContext:()=>({mode:'FULL'}),getAutomationAdapter:()=>adapter});
    load(ctx,'    async function waitForPracticeTransition(','    async function waitForNextPracticeQuestion(');
    const result=await ctx[method]('old',1,adapter);assert.match(result.blocked,/expired/);
});
test('unrelated Next, hidden controls, disabled Next and duplicate submitted controls are not advances',()=>{
    for(const html of ['<button>NEXT</button>',
        '<div id="next-button-container"><button disabled>NEXT</button></div>',
        '<div hidden id="next-button-container"><button>NEXT</button></div>',
        '<div id="next-button-container"><button>NEXT</button><button>NEXT</button></div>',
        '<div id="assistant-root"><div id="next-button-container"><button>NEXT</button></div></div>']){
        const {document,adapter}=fixture(html);assert.equal(adapter.getSubmittedAdvance(document),null);
    }
});
test('Submit detection ignores hidden duplicates, ARIA disabled buttons and assistant controls',()=>{
    const {document,adapter}=fixture(`<main><div id="options"></div><button id="submit">SUBMIT</button></main>
        <button hidden>SUBMIT</button><button aria-disabled="true">SUBMIT</button>
        <div id="assistant-root"><button>SUBMIT</button></div>`);
    const q={container:document.querySelector('#options')};
    assert.equal(adapter.getSubmit(document,q).id,'submit');
    document.querySelector('main').insertAdjacentHTML('beforeend','<button>SUBMIT</button>');
    assert.equal(adapter.getSubmit(document,q),null);
});
test('native Submit detection requires a unique visible enabled control',()=>{
    const {document,adapter}=fixture('<form><button hidden type="submit">SUBMIT</button><input id="submit" type="submit" value="SUBMIT"></form>');
    const q={form:document.querySelector('form')};
    assert.equal(adapter.getSubmit(document,q).id,'submit');
    document.querySelector('#submit').setAttribute('aria-disabled','true');
    assert.equal(adapter.getSubmit(document,q),null);
});

function submitWait(scenario){
    let now=0,allowed=true,signature='same';
    const automation={running:true,runId:1,targetId:'ccbp'};
    const button={isConnected:true,getClientRects:()=>[{}],getAttribute:()=>null};
    const adapter={id:'semantic-mcq',isSaving:()=>scenario==='saving'&&now<900,
        getSubmit:()=>now>=500?button:null,getSubmittedAdvance:()=>scenario==='already submitted'?{}:null};
    const ctx=vm.createContext({automation,document:{},Date:{now:()=>now},
        getAutomationContext:()=>({mode:'FULL',target:{id:'ccbp'}}),getAutomationAdapter:()=>adapter,
        automationPolicy:{canExecute:()=>allowed},getAuthorizedQuestion:()=>({signature}),
        waitWhilePaused:async()=>automation.running,updateAutomationUI(){},
        setTimeout:(fn,ms)=>{now+=ms;if(scenario==='stopped')automation.running=false;
            if(scenario==='changed')signature='different';if(scenario==='policy changed')allowed=false;fn();}});
    load(ctx,'    async function waitForQuestionSubmit(','    async function waitForPracticeTransition(');
    return {ctx,automation,adapter,button,now:()=>now};
}
for(const scenario of ['delayed button','saving'])test(`waits for ${scenario} without generating another answer`,async()=>{
    const h=submitWait(scenario);const ready=await h.ctx.waitForQuestionSubmit({signature:'same'},1,h.adapter);
    assert.equal(ready.button,h.button);assert.ok(h.now()>=(scenario==='saving'?900:500));
});
test('already submitted answer returns a transition instead of requiring Submit',async()=>{
    const h=submitWait('already submitted');assert.equal((await h.ctx.waitForQuestionSubmit({signature:'same'},1,h.adapter)).submitted,true);
});
for(const scenario of ['changed','policy changed'])test(`submission wait cancels when ${scenario}`,async()=>{
    const h=submitWait(scenario);await assert.rejects(h.ctx.waitForQuestionSubmit({signature:'same'},1,h.adapter),
        scenario==='changed'?/Question changed/:/policy/);
});
test('Stop cancels a pending Submit wait',async()=>{
    const h=submitWait('stopped');assert.equal(await h.ctx.waitForQuestionSubmit({signature:'same'},1,h.adapter),null);
});
test('a changed answer is not submitted when the delayed button becomes enabled',async()=>{
    const h=submitWait('delayed button');
    h.ctx.getAuthorizedQuestion=()=>({signature:'same',options:[{index:0,isSelected:()=>h.now()<200},{index:1,isSelected:()=>h.now()>=200}]});
    await assert.rejects(h.ctx.waitForQuestionSubmit({signature:'same'},1,h.adapter,[0]),/selected answer changed/);
    assert.equal(h.now(),200);
});
test('a permanently unavailable Submit times out without clicking or losing the selected answer',async()=>{
    const h=submitWait('timeout');h.adapter.getSubmit=()=>null;
    await assert.rejects(h.ctx.waitForQuestionSubmit({signature:'same'},1,h.adapter),/selected answer was kept/);
    assert.equal(h.now(),15000);
});

for(const previouslySubmitted of [true,false])test(`runner advances ${previouslySubmitted?'an already answered question':'a question auto-submitted during checkbox selection'} once`,async()=>{
    let now=0,submitted=previouslySubmitted,nextClicks=0,requests=0,submitReads=0;
    const location={origin:'https://learning.ccbp.in',pathname:'/default-question/practice/example',href:'https://learning.ccbp.in/default-question/practice/example'};
    const automation={running:false,runId:0,processed:new Set()};
    const options=[0,1].map(index=>({index,text:['Lower time complexity','Faster lookups'][index],selected:false,
        isSelected(){return this.selected;},input:{click(){options[index].selected=true;if(options.every(o=>o.selected))submitted=true;}}}));
    const question={signature:'hash-map',text:'What are the advantages of the hash map approach?',selectionType:'multiple',options};
    const next={click(){nextClicks++;}};
    const adapter={id:'semantic-mcq',isComplete:()=>nextClicks===1,getSubmittedAdvance:()=>submitted&&!nextClicks?next:null,
        getSubmit:()=>{submitReads++;throw Error('Must not submit an answered question again');}};
    const ctx=vm.createContext({document:{},window:{location},location,automation,Date:{now:()=>now},
        setTimeout:(fn,ms)=>{now+=ms;fn();},updateAutomationUI(){},
        getAutomationContext:()=>({mode:'FULL',target:{id:'ccbp'}}),getAutomationAdapter:()=>adapter,
        automationPolicy:{canExecute:()=>true},getAuthorizedQuestion:()=>submitted?null:question,
        normalizeAutomationText:value=>value.replace(/\s+/g,' ').trim(),waitWhilePaused:async()=>automation.running,
        answerIndexesFromResult:()=>[0,1],
        requestPracticeAnswer:async()=>{requests++;return {data:{results:JSON.stringify([{answer:'Option A; Option B'}])}};},
        stopAutomation:state=>{automation.running=false;automation.state=state;}});
    load(ctx,'    function hasSameQuestionOptions(','    function getAuthorizedQuestion(');
    load(ctx,'    async function waitForOptionSelection(','    async function waitForNextPracticeQuestion(');
    load(ctx,'    async function startPracticeAutomation(','    async function readMcqSnippetSnapshot(');
    await ctx.startPracticeAutomation();
    assert.equal(automation.state,'COMPLETED');assert.equal(automation.error,'');
    assert.equal(nextClicks,1);assert.equal(submitReads,0);assert.equal(requests,previouslySubmitted?0:1);
    assert.equal(automation.completed,1);
});
