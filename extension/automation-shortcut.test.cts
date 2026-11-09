const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
function harness(activeElement={}){
    let listener,starts=0,updates=0;
    const automation={running:false,paused:false};
    const ctx=vm.createContext({automation,selectedTab:'auto',isHidden:true,isCollapsed:true,root:{style:{display:'none'}},
        window:{},lifecycle:{signal:{}},document:{activeElement,addEventListener:(_event,fn)=>{listener=fn;}},
        HTMLInputElement:class{},HTMLTextAreaElement:class{},HTMLSelectElement:class{},
        render(){},updateAutomationUI(){updates++;},
        startPracticeAutomation:async()=>{starts++;automation.running=true;},
        stopAutomation:state=>{automation.running=false;automation.state=state;}});
    const pauseStart=source.indexOf('    function pauseOrResumeAutomation(');
    vm.runInContext(source.slice(pauseStart,source.indexOf('    function stopAutomation(',pauseStart)),ctx);
    const start=source.indexOf('    function handleAutomationShortcut(');
    vm.runInContext(source.slice(start,source.indexOf('    // ── Vision scan',start)),ctx);
    const key=(overrides={})=>{
        const e={key:'A',code:'KeyA',altKey:true,shiftKey:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...overrides};
        listener(e);return e;
    };
    return {ctx,automation,key,starts:()=>starts,updates:()=>updates};
}
test('Alt A starts once, opens QA Control, then pauses and resumes the same run',()=>{
    const h=harness();const e=h.key();
    assert.equal(h.starts(),1);assert.equal(h.ctx.selectedTab,'qa');assert.equal(h.ctx.root.style.display,'block');
    assert.equal(h.ctx.isHidden,false);assert.equal(h.ctx.isCollapsed,false);assert.equal(e.prevented,true);
    h.key();assert.equal(h.automation.paused,true);assert.equal(h.automation.state,'PAUSED');
    h.key();assert.equal(h.automation.paused,false);assert.equal(h.automation.state,'DETECTING');
    assert.equal(h.starts(),1);
});
test('automation shortcut works with a code editor focused',()=>{
    const h=harness({isContentEditable:true});h.key();assert.equal(h.starts(),1);
});
test('held keys, composition and extra or missing modifiers do not toggle automation',()=>{
    const h=harness();
    for(const event of [{repeat:true},{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:false},
        {key:'B',code:'KeyB'},{defaultPrevented:true}]){
        assert.equal(h.key(event).prevented,undefined);
    }
    assert.equal(h.starts(),0);
});
test('the shortcut pauses and resumes an active journal without starting a second request',()=>{
    const h=harness();let paused=false,toggles=0;
    h.ctx.window.BrowserAssistantJournal={matches:()=>true,getState:()=>({running:true}),pause:()=>{paused=!paused;toggles++;}};
    h.key();assert.equal(paused,true);h.key();assert.equal(paused,false);
    assert.equal(toggles,2);assert.equal(h.starts(),0);
});
test('shortcut start failures produce an error state rather than an unhandled rejection',async()=>{
    const h=harness();h.ctx.startPracticeAutomation=async()=>{throw Error('Cannot start on this page');};
    h.key();await Promise.resolve();await Promise.resolve();
    assert.equal(h.automation.state,'ERROR');assert.equal(h.automation.error,'Cannot start on this page');
});

test('legacy Alt Shift A remains available',()=>{
    const h=harness();h.key({shiftKey:true});assert.equal(h.starts(),1);
    h.key({shiftKey:true});assert.equal(h.automation.paused,true);
});
