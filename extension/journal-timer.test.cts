const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const journal=require('./journal-automation.js');
const source=fs.readFileSync(`${__dirname}/journal-automation.js`,'utf8');
const keys=['experience','feelings','learning','application','conclusion'];
const sections=()=>Object.fromEntries(keys.map(key=>[key,[key,...Array(79).fill('word')].join(' ')]));
async function settle(){for(let i=0;i<25;i++)await Promise.resolve();}
function fixture(time='56:15',prefilled=false) {
    const {document,window}=parseHTML('<html><body><h1>Reflective Journal 1</h1><div>Subject: Fundamentals of Artificial Intelligence (AI201) Description: Reflective Journal 1</div>'
        +(time===null?'':`<div id="time-card">Time <span id="clock">${time}</span></div>`)
        +keys.map(key=>`<section><h3>${key}</h3><textarea></textarea></section>`).join('')+'<button id="submit">Submit Journal</button></body></html>');
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    const polls=[];let clicks=0,requests=0;
    document.querySelector('#submit').addEventListener('click',()=>{
        clicks++;const done=document.createElement('p');done.textContent='Journal submitted successfully';document.body.appendChild(done);
    });
    if(prefilled){const data=sections();for(const [i,field] of [...document.querySelectorAll('section textarea')].entries())field.value=data[keys[i]];}
    const storage=new Map();
    const globals={document,location:{origin:'https://admissions.aurora.edu.in',pathname:'/modules/reflective-journal/timer-test'},
        Event:window.Event,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
        setInterval:fn=>{polls.push(fn);return polls.length;},clearInterval(){},setTimeout:fn=>{queueMicrotask(fn);return 1;},
        chrome:{runtime:{getManifest:()=>({version:'2.6.68'}),sendMessage:async()=>{requests++;return {ok:true,data:{sections:sections()}};}}}};
    globals.window=globals;
    vm.runInNewContext(source,globals);
    return {document,globals,controller:globals.BrowserAssistantJournal,
        start:async()=>{globals.BrowserAssistantJournal.start();await settle();},
        tick:async()=>{for(const poll of [...polls])poll();await settle();},time:value=>{document.querySelector('#clock').textContent=value;},
        get clicks(){return clicks;},get requests(){return requests;}};
}
test('400 words are filled at 56:15; submission waits for 30:00 and clicks only once',async()=>{
    const f=fixture();await f.start();
    assert.equal(f.clicks,0);assert.equal(f.controller.getState().state,'WAITING_FOR_TIMER');
    assert.equal(f.globals.BrowserAssistantJournalBusy,true);assert.equal(f.document.querySelector('#clock').textContent,'56:15');
    assert.equal(journal.validate(Object.fromEntries(keys.map((key,i)=>[key,[...f.document.querySelectorAll('section textarea')][i].value]))),400);
    f.time('30:01');await f.tick();assert.equal(f.clicks,0);
    f.time('30:00');await f.tick();assert.equal(f.clicks,1);
    await f.tick();assert.equal(f.clicks,1);assert.equal(f.controller.getState().state,'COMPLETED');
});
test('a missed exact second still submits at 29:59, never before the target',async()=>{
    const f=fixture();await f.start();f.time('29:59');await f.tick();assert.equal(f.clicks,1);
});
test('existing complete content is retained and can be armed without another AI request',async()=>{
    const f=fixture('56:15',true);
    const before=[...f.document.querySelectorAll('section textarea')].map(field=>field.value);
    await f.start();assert.equal(f.requests,0);assert.equal(f.clicks,0);
    assert.deepEqual([...f.document.querySelectorAll('section textarea')].map(field=>field.value),before);
    f.time('30:00');await f.tick();assert.equal(f.clicks,1);
});
test('Pause holds submission at the target and Resume continues once',async()=>{
    const f=fixture();await f.start();f.controller.pause();
    f.time('30:00');await f.tick();assert.equal(f.clicks,0);assert.equal(f.controller.getState().state,'PAUSED');
    f.controller.pause();await f.tick();assert.equal(f.clicks,1);
});
test('Stop cancels the timer wait and keeps all entered text',async()=>{
    const f=fixture();await f.start();f.controller.stop();f.time('30:00');await f.tick();
    assert.equal(f.clicks,0);assert.equal(f.controller.getState().state,'STOPPED');
    assert.ok(Object.values(journal.fields(f.document)).every(field=>field.value.trim()));
});
test('changing pages while waiting cannot submit another journal',async()=>{
    const f=fixture();await f.start();f.globals.location.pathname='/modules/reflective-journal/another';f.time('30:00');await f.tick();
    assert.equal(f.clicks,0);assert.equal(f.globals.BrowserAssistantJournalBusy,false);
});
test('changed journal text is never overwritten or submitted by the pending timer run',async()=>{
    const f=fixture();await f.start();f.document.querySelector('section textarea').value='User changed this section.';
    f.time('30:00');await f.tick();assert.equal(f.clicks,0);assert.equal(f.controller.getState().state,'ERROR');
    assert.equal(f.document.querySelector('section textarea').value,'User changed this section.');
});
test('missing or conflicting portal timers keep submission waiting',async()=>{
    const f=fixture(null);await f.start();await f.tick();assert.equal(f.clicks,0);assert.equal(f.controller.getState().state,'WAITING_FOR_TIMER');
    const other=fixture('56:15');const second=other.document.createElement('div');second.textContent='Time 29:59';other.document.body.appendChild(second);
    await other.start();assert.equal(other.clicks,0);assert.equal(other.controller.getState().state,'WAITING_FOR_TIMER');
});
test('timer parsing supports hours and excludes clock-like text in journal writing fields and assistant UI',()=>{
    const f=fixture('00:30:00');assert.equal(journal.remainingSeconds(f.document),1800);
    const hidden=f.document.createElement('div');hidden.id='assistant-root';hidden.textContent='Time 00:10';f.document.body.appendChild(hidden);
    const editable=f.document.createElement('div');editable.setAttribute('contenteditable','true');editable.textContent='Time 01:00';f.document.body.appendChild(editable);
    assert.equal(journal.remainingSeconds(f.document),1800);
    f.time('30:99');assert.equal(journal.remainingSeconds(f.document),null);
});
test('an expired timer cannot trigger a late duplicate submission',async()=>{
    const f=fixture('00:00');await f.start();assert.equal(f.clicks,0);assert.equal(f.controller.getState().state,'ERROR');
});
