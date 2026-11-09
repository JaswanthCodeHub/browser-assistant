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
        Event:window.Event,AbortController,browserAssistantLocalInference: (_path, body, send) => send({body}),
        sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
        setInterval:fn=>{polls.push(fn);return polls.length;},clearInterval(){},setTimeout:fn=>{queueMicrotask(fn);return 1;},
        chrome:{runtime:{getManifest:()=>({version:'2.6.68'}),sendMessage:async()=>{requests++;return {ok:true,data:{sections:sections()}};}}}};
    globals.window=globals;
    vm.runInNewContext(source,globals);
    document.querySelector('#assistant-journal textarea').value='My actual class experience and feelings.';
    return {document,globals,controller:globals.BrowserAssistantJournal,
        start:async()=>{globals.BrowserAssistantJournal.start();await settle();},
        tick:async()=>{for(const poll of [...polls])poll();await settle();},time:value=>{document.querySelector('#clock').textContent=value;},
        get clicks(){return clicks;},get requests(){return requests;}};
}
test('draft preparation leaves portal text and the submit control unchanged as the timer advances',async()=>{
    const f=fixture('56:15',true);
    const original=Object.values(journal.fields(f.document)).map(field=>field.value);
    await f.start();
    assert.equal(f.controller.getState().state,'REVIEW_DRAFT');
    f.time('30:00');await f.tick();
    f.time('29:59');await f.tick();
    assert.equal(f.clicks,0);
    assert.deepEqual(Object.values(journal.fields(f.document)).map(field=>field.value),original);
    assert.equal(f.document.querySelector('#assistant-journal [data-countdown]').textContent,'Portal time left 29:59');
});

test('the journal shows completion only after portal confirmation appears',async()=>{
    const f=fixture();
    await f.start();
    assert.equal(f.controller.getState().completed,0);
    f.document.querySelector('#submit').click();
    await f.tick();
    assert.equal(f.controller.getState().state,'COMPLETED');
    assert.equal(f.controller.getState().completed,1);
});

test('timer parsing supports hours and excludes clock-like text in journal writing fields and assistant UI',()=>{
    const f=fixture('00:30:00');assert.equal(journal.remainingSeconds(f.document),1800);
    const hidden=f.document.createElement('div');hidden.id='assistant-root';hidden.textContent='Time 00:10';f.document.body.appendChild(hidden);
    const editable=f.document.createElement('div');editable.setAttribute('contenteditable','true');editable.textContent='Time 01:00';f.document.body.appendChild(editable);
    assert.equal(journal.remainingSeconds(f.document),1800);
    f.time('30:99');assert.equal(journal.remainingSeconds(f.document),null);
});
test('an expired timer never sends a submission',async()=>{
    const f=fixture('00:00');
    await f.start();await f.tick();
    assert.equal(f.clicks,0);
});
