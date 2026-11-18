const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');

function harness(){
    let handler=null,opens=0;
    const lifecycle={signal:{}};
    const document={addEventListener:(event,fn)=>{if(event==='assistant-journal-ready')handler=fn;}};
    const ctx=vm.createContext({document,lifecycle,selectedTab:'auto',window:{},openPanel(){opens++;}});
    const start=source.indexOf("    document.addEventListener('assistant-journal-ready'");
    assert.notEqual(start,-1,'content.js must wire assistant-journal-ready');
    vm.runInContext(source.slice(start,source.indexOf('    function getAutomationContext(',start)),ctx);
    assert.equal(typeof handler,'function',"assistant-journal-ready listener must be registered");
    return {ctx,fire:()=>handler({type:'assistant-journal-ready'}),opens:()=>opens};
}

test('assistant-journal-ready opens QA Control only when the journal controller matches',()=>{
    const h=harness();
    h.ctx.window.BrowserAssistantJournal={matches:()=>false};
    h.fire();
    assert.equal(h.opens(),0);
    assert.equal(h.ctx.selectedTab,'auto');
    h.ctx.window.BrowserAssistantJournal={matches:()=>true};
    h.fire();
    assert.equal(h.opens(),1);
    assert.equal(h.ctx.selectedTab,'qa');
    assert.equal(h.opens(),1,'a later event reuses the already-open panel');
});
