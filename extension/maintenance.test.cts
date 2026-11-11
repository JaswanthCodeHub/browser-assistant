const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const content=fs.readFileSync(`${__dirname}/content.js`,'utf8');

function background(activeId=7){
    let listener,captures=0,fetches=0;
    const chrome={alarms:{create(){},onAlarm:{addListener(){}}},runtime:{id:'ours',onInstalled:{addListener(){}},
        onMessage:{addListener(fn){listener=fn;}},getManifest:()=>({version:'test'})},
        tabs:{query:async()=>[{id:activeId}],captureVisibleTab(windowId,options,done){captures++;assert.equal(windowId,3);done('data:image/png;base64,fixture');}}};
    const ctx=vm.createContext({chrome,URL,importScripts(){},AbortSignal:{timeout:()=>({})},console,
        fetch:async()=>{fetches++;return {ok:true,status:200,text:async()=>'{"status":"ok"}'};}});
    vm.runInContext(fs.readFileSync(`${__dirname}/background.js`,'utf8'),ctx);
    const sender={id:'ours',url:'https://example.test',tab:{id:7,windowId:3,url:'https://example.test'}};
    const send=(request,from=sender)=>new Promise(resolve=>listener(request,from,resolve));
    return {send,sender,captures:()=>captures,fetches:()=>fetches};
}
test('screenshots are bound to the requesting active tab and window',async()=>{
    const h=background();assert.match((await h.send({action:'captureVisibleTab'})).dataUrl,/image\/png/);
    assert.equal(h.captures(),1);
    const other=background(99);assert.match((await other.send({action:'captureVisibleTab'})).error,/no longer active/);
    assert.equal(other.captures(),0);
});
test('untrusted messages and unexpected API methods cannot reach local APIs or screenshots',async()=>{
    const h=background();
    for(const request of [{action:'apiRequest',path:'/health',method:'DELETE'},
        {action:'apiRequest',path:'/missing',method:'POST'},null]){
        assert.ok((await h.send(request)).error);
    }
    assert.ok((await h.send({action:'captureVisibleTab'},{...h.sender,id:'other'})).error);
    assert.ok((await h.send({action:'apiRequest',path:'/health',method:'GET'},{...h.sender,id:'other'})).error);
    assert.equal(h.fetches(),0);assert.equal(h.captures(),0);
    assert.equal((await h.send({action:'apiRequest',path:'/health',method:'GET'},{id:'ours'})).ok,true);
});
test('a stationary collapsed-badge pointer press opens the panel despite root pointer capture',()=>{
    const {document,window}=parseHTML('<html><body><div id="root"><button class="assistant-tab collapsed"></button></div></body></html>');
    const root=document.querySelector('#root');const badge=root.querySelector('button');
    root.getBoundingClientRect=()=>({left:20,top:20});root.setPointerCapture=()=>{};
    let opens=0;
    const ctx=vm.createContext({root,window,dragState:{dragging:false},suppressNextClick:false,
        lifecycle:{signal:undefined},localStorage:{setItem(){}},setTimeout(){},setPanelPosition(){},openPanel(){opens++;}});
    const start=content.indexOf('    function initDrag()');
    vm.runInContext(content.slice(start,content.indexOf('    initDrag();',start)),ctx);ctx.initDrag();
    const event=(type,target,x)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});e.clientX=x;e.clientY=20;e.pointerId=1;target.dispatchEvent(e);};
    event('pointerdown',badge,20);event('pointerup',root,20);
    assert.equal(opens,1);
    event('pointerdown',badge,20);event('pointermove',root,35);event('pointerup',root,35);
    assert.equal(opens,1);assert.equal(ctx.suppressNextClick,true);
    event('pointerdown',badge,20);event('pointercancel',root,20);
    assert.equal(opens,1);
});
test('answer rendering escapes untrusted markup and code copy preserves the exact source',async()=>{
    const {document}=parseHTML('<html><body><div id="results"></div></body></html>');
    let copied='';
    const ctx=vm.createContext({document,navigator:{clipboard:{writeText:async value=>{copied=value;}}},setTimeout(){},console});
    let start=content.indexOf('    function renderFullResults(');
    vm.runInContext(content.slice(start,content.indexOf('    async function resumeAuthorizedQaAfterNavigation(',start)),ctx);
    const source='<script>alert("code")</script>';
    ctx.renderFullResults(document.querySelector('#results'),[
        {type:'mcq',question:'<img src=x onerror=alert(1)>',answer:'Option A: <b>safe</b>',reasoning:'<script>bad()</script>'},
        {type:'code',language:'javascript',code:source,title:'<b>Title</b>'}],'<img src=x>');
    assert.equal(document.querySelectorAll('img,script').length,0);
    assert.ok(document.querySelector('#results').textContent.includes(source));
    await document.querySelector('#copy-btn-1').onclick();assert.equal(copied,source);
});
test('Text Scan keeps long coding statements and excludes hidden executable data from its fallback',()=>{
    const {document,window}=parseHTML(`<html><head><title>Coding</title></head><body><main>CODING PRACTICE ${'x'.repeat(13000)} FINAL_INPUT_SENTINEL</main><script>PRIVATE_SCRIPT_SENTINEL</script><style>PRIVATE_STYLE_SENTINEL</style><div id="assistant-root">PRIVATE_ASSISTANT_SENTINEL</div></body></html>`);
    const ctx=vm.createContext({document,window,selectedMode:'code',console});
    let start=content.indexOf('    function extractSmartText(');
    vm.runInContext(content.slice(start,content.indexOf('    function openPanel(',start)),ctx);
    start=content.indexOf('    function detectPracticeType(');
    vm.runInContext(content.slice(start,content.indexOf('    function selectTab(',start)),ctx);
    assert.match(ctx.extractSmartText(),/FINAL_INPUT_SENTINEL/);
    assert.doesNotMatch(ctx.cleanBodyText(60000),/PRIVATE_/);
});
test('Stop cancels automation even when site session storage is unavailable',()=>{
    const automation={runId:1,running:true,paused:true,batch:{},pendingNavigation:true};
    const ctx=vm.createContext({window:{},automation,sessionStorage:{removeItem(){throw Error('Storage blocked');}},updateAutomationUI(){}});
    const start=content.indexOf('    function stopAutomation(');
    vm.runInContext(content.slice(start,content.indexOf('    async function waitWhilePaused(',start)),ctx);
    ctx.stopAutomation();assert.equal(automation.running,false);assert.equal(automation.runId,2);
    assert.equal(automation.state,'STOPPED');assert.equal(automation.batch,null);
});
for(const fails of [false,true])test(`bounded API keepalive is cleaned up after ${fails?'failure':'success'}`,async()=>{
    let listener,pulse,finish,pings=0,cleared=0;
    const ctx=vm.createContext({URL,console,importScripts(){},AbortSignal:{timeout:()=>({})},
        setInterval(fn,ms){assert.equal(ms,25000);pulse=fn;return 42;},clearInterval(id){assert.equal(id,42);cleared++;},
        fetch:()=>new Promise((resolve,reject)=>{finish=()=>fails?reject(Error('offline')):resolve({ok:true,status:200,text:async()=>'{"results":"[]"}'});}),
        chrome:{alarms:{create(){},onAlarm:{addListener(){}}},runtime:{id:'ours',getPlatformInfo(done){pings++;done();},
            onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}}}});
    vm.runInContext(fs.readFileSync(`${__dirname}/background.js`,'utf8'),ctx);
    const response=new Promise(resolve=>listener({action:'apiRequest',path:'/solve',method:'POST',body:{}},{id:'ours'},resolve));
    pulse();assert.equal(pings,1);finish();await response;
    for(let i=0;i<5;i++)await Promise.resolve();
    assert.equal(cleared,1);
});
