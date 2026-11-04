const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseHTML} = require('linkedom');
const journal = require('./journal-automation.js');
const vm = require('node:vm');
const fs = require('node:fs');
const keys = ['experience','feelings','learning','application','conclusion'];
function sections(count) { return Object.fromEntries(keys.map(key=>[key,Array(count).fill('word').join(' ')])); }
test('strict total word limits prevent underlength, overlength and incomplete submission',()=>{
    assert.equal(journal.validate(sections(80)),400);
    assert.throws(()=>journal.validate(sections(75)),/80/);
    assert.throws(()=>journal.validate(sections(81)),/400/);
    const uneven=sections(80);uneven.experience='word '.repeat(79).trim();uneven.conclusion='word '.repeat(81).trim();
    assert.throws(()=>journal.validate(uneven),/80/);
    assert.throws(()=>journal.validate({experience:'text'}),/Five/);
});
test('subject is read independently of journal number',()=>{
    assert.deepEqual(journal.metadata('Reflective Journal 2 Subject: Computer organization and Architecture (CS203) Description: Reflective Journal 2'), {number:2,subject:'Computer organization and Architecture (CS203)'});
    assert.equal(journal.metadata('Reflective Journal 1'),null);
});
test('separate DOM cells and headings retain word boundaries when reading module information',()=>{
    const {document}=parseHTML('<html><body><h1>Reflective Journal <span>1</span></h1><div>Module Information</div><section><b>Subject:</b><span>Linear Algebra Essentials (MA113)</span><b>Description:</b><span>Reflective Journal 1</span></section><section id="assistant-root">Subject: Wrong Description: Reflective Journal 7</section></body></html>');
    assert.deepEqual(journal.metadata(journal.pageText(document)),{number:1,subject:'Linear Algebra Essentials (MA113)'});
});
test('field mapping follows labels even if the page order differs',()=>{
    const {document}=parseHTML('<html><body>'+[...keys].reverse().map(k=>`<section><h3>${k}</h3><div><textarea></textarea></div></section>`).join('')+'</body></html>');
    for (const field of document.querySelectorAll('textarea')) field.getClientRects=()=>[{}];
    const found=journal.fields(document);
    assert.equal(found.experience.closest('section').querySelector('h3').textContent,'experience');
    document.querySelector('textarea').disabled=true;
    assert.equal(journal.fields(document),null);
});
test('Aurora numbered span labels map all five fields including Conclusion followed by word count',()=>{
    const {document}=parseHTML('<html><body>'+keys.map((k,i)=>`<div><div><span>${i+1}</span><span>${k}</span><span>0 words</span></div><textarea></textarea></div>`).join('')+'</body></html>');
    for (const field of document.querySelectorAll('textarea')) field.getClientRects=()=>[{}];
    const found=journal.fields(document);
    assert.ok(found);
    assert.equal(Object.keys(found).length,5);
    journal.writeField(found.conclusion,'A final summary.');
    assert.equal(journal.readField(found.conclusion),'A final summary.');
    assert.ok(journal.fields(document));
});

async function runJournal(changePage=false, shortcut=false, integrated=false, stopPending=false, guidelines=false) {
    const {window}=parseHTML('<html><body><h1>Reflective Journal 1</h1><div>Subject: Advanced Data Structures Description: Reflective Journal 1</div><div>Time <span>29:59</span></div>'+keys.map(k=>`<section><h3>${k}</h3><textarea></textarea></section>`).join('')+'<button id="submit">Submit Journal</button></body></html>');
    const {document}=window;
    window.Element.prototype.getClientRects=()=>[{}];
    const location={origin:'https://admissions.aurora.edu.in',pathname:'/modules/reflective-journal/example'};
    let clicks=0;
    document.querySelector('#submit').addEventListener('click',()=>{
        clicks++;
        const done=document.createElement('p'); done.textContent='Journal submitted successfully';document.body.appendChild(done);
    });
    let ticks=0, startClicks=0;
    if (guidelines) {
        const writing=[...document.querySelectorAll('section')].map(node=>node.outerHTML).join('');
        for (const node of document.querySelectorAll('section')) node.remove();
        const terms=document.createElement('div');
        terms.innerHTML=`<input type="checkbox" id="unrelated"><label for="unrelated">Another option</label><input type="checkbox" id="declaration"><label for="declaration">${guidelines==='missing'?'Different consent':'I confirm this is my own original work, and I have read the guidelines and rubric above.'}</label><button id="begin" disabled>Accept Terms to Start</button>`;
        document.body.appendChild(terms);
        const declaration=document.querySelector('#declaration'),begin=document.querySelector('#begin');
        declaration.addEventListener('click',()=>{ticks++;declaration.checked=true;begin.disabled=false;begin.textContent='Start Assessment';});
        begin.addEventListener('click',()=>{startClicks++;terms.remove();const holder=document.createElement('div');holder.innerHTML=writing;document.body.appendChild(holder);});
    }
    const storage=new Map();
    const globals={document,location,HTMLTextAreaElement:window.HTMLTextAreaElement,Event:window.Event,
        sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
        setInterval:()=>1,clearInterval:()=>{},setTimeout:fn=>setTimeout(fn,0),
        chrome:{runtime:{sendMessage:async()=>{
            if(changePage) location.pathname='/modules/reflective-journal/different';
            return {ok:true,data:{sections:sections(80)}};
        }}}};
    globals.window=globals;
    if (integrated) {
        const root=document.createElement('div');root.id='assistant-root';root.innerHTML='<div id="assistant-journal-slot"></div>';document.body.appendChild(root);
    }
    vm.runInNewContext(fs.readFileSync(`${__dirname}/journal-automation.js`,'utf8'),globals);
    if (integrated) {
        const controller=globals.BrowserAssistantJournal;
        const notes=document.querySelector('#assistant-journal textarea');notes.value='My class notes';
        controller.detach();
        document.querySelector('#assistant-root').innerHTML='<div id="assistant-journal-slot"></div>';
        controller.mount(document.querySelector('#assistant-journal-slot'));
        assert.equal(document.querySelector('#assistant-root #assistant-journal textarea').value,'My class notes');
    }
    if (shortcut) {
        for (let i=0;i<2;i++) {
            const event = new window.Event('keydown',{bubbles:true,cancelable:true});
            Object.assign(event,{altKey:true,shiftKey:true,code:'KeyJ',key:'J',repeat:false});
            document.querySelector('section textarea').dispatchEvent(event);
        }
    } else if (integrated) globals.BrowserAssistantJournal.start();
    else document.querySelector('#assistant-journal button').click();
    if (stopPending) globals.BrowserAssistantJournal.stop();
    for (let wait=0;wait<100 && globals.BrowserAssistantJournalBusy;wait++) await new Promise(resolve=>setTimeout(resolve,5));
    return {clicks,document,globals,ticks,startClicks};
}
test('one deliberate run fills five fields and submits once, then verifies page confirmation',async()=>{
    const {clicks,document,globals}=await runJournal();
    assert.equal(clicks,1,document.querySelector('#assistant-journal [role=status]').textContent);
    assert.match(document.querySelector('#assistant-journal [role=status]').textContent,/Submission confirmed/);
    assert.equal(globals.BrowserAssistantJournalBusy,false);
});
test('navigation during generation cannot fill or submit the next journal',async()=>{
    const {clicks,document}=await runJournal(true);
    assert.equal(clicks,0);
    assert.equal(document.querySelector('section textarea').value,'');
    assert.match(document.querySelector('#assistant-journal [role=status]').textContent,/page changed/);
});
test('journal shortcut works from a text field and repeated presses cannot duplicate submission',async()=>{
    const {clicks,document}=await runJournal(false,true);
    assert.equal(clicks,1,document.querySelector('#assistant-journal [role=status]').textContent);
    assert.match(document.querySelector('#assistant-journal [role=status]').textContent,/Submission confirmed/);
});
test('integrated QA controller retains notes across panel renders and runs the same submit flow',async()=>{
    const {clicks,document,globals}=await runJournal(false,false,true);
    assert.equal(clicks,1);
    assert.equal(globals.BrowserAssistantJournal.getState().state,'COMPLETED');
    assert.equal(document.querySelectorAll('#assistant-journal').length,1);
    assert.ok(document.querySelector('#assistant-root #assistant-journal'));
});
test('Stop from QA Control invalidates an in-flight journal response',async()=>{
    const {clicks,document,globals}=await runJournal(false,false,true,true);
    assert.equal(clicks,0);
    assert.equal(document.querySelector('section textarea').value,'');
    assert.equal(globals.BrowserAssistantJournal.getState().state,'STOPPED');
});
test('main automation Start routes journals to the journal controller before coding detection',async()=>{
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    let starts=0,updates=0;
    const ctx=vm.createContext({window:{BrowserAssistantJournal:{matches:()=>true,start:async()=>starts++}},updateAutomationUI:()=>updates++});
    vm.runInContext(source.slice(source.indexOf('    async function startPracticeAutomation('),source.indexOf('    function safeSendMessage(')),ctx);
    await ctx.startPracticeAutomation();
    assert.equal(starts,1);assert.equal(updates,1);
});
test('guidelines flow ticks only the journal declaration, starts once, then fills and submits',async()=>{
    const {clicks,ticks,startClicks,globals}=await runJournal(false,false,true,false,true);
    assert.equal(ticks,1);assert.equal(startClicks,1);assert.equal(clicks,1);
    assert.equal(globals.BrowserAssistantJournal.getState().state,'COMPLETED');
});
test('unrecognized declaration stops without clicking unrelated checkboxes or starting',async()=>{
    const {clicks,ticks,startClicks,globals}=await runJournal(false,false,true,false,'missing');
    assert.equal(ticks,0);assert.equal(startClicks,0);assert.equal(clicks,0);
    assert.equal(globals.BrowserAssistantJournal.getState().state,'ERROR');
});
test('assessment-list shortcut opens the ongoing pencil once and ignores missed/upcoming journals',()=>{
    const {window}=parseHTML('<html><body><table>'+['Ongoing','Missed','Upcoming'].map((status,i)=>`<tr><td>Reflective Journal ${i+1}</td><td>${status}</td><td><a href="/modules/reflective-journal/journal${i+1}">Start journal</a></td></tr>`).join('')+'</table></body></html>');
    const {document}=window;
    window.Element.prototype.getClientRects=()=>[{}];
    const clicks=[];
    for(const link of document.querySelectorAll('a')) link.addEventListener('click',()=>clicks.push(link.getAttribute('href')));
    const stored=new Map();
    const globals={document,location:{origin:'https://admissions.aurora.edu.in',pathname:'/modules/assessments/assessments'},Event:window.Event,URL,
        sessionStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k)||null,removeItem:k=>stored.delete(k)},setInterval:()=>1};
    globals.window=globals;
    vm.runInNewContext(fs.readFileSync(`${__dirname}/journal-automation.js`,'utf8'),globals);
    for(let i=0;i<2;i++) {
        const event=new window.Event('keydown',{bubbles:true,cancelable:true});
        Object.assign(event,{altKey:true,shiftKey:true,code:'KeyJ',key:'J'});
        document.dispatchEvent(event);
    }
    assert.deepEqual(clicks,['/modules/reflective-journal/journal1']);
    assert.equal(JSON.parse(stored.get('assistantPendingJournal')).path,'/modules/reflective-journal/journal1');
    globals.BrowserAssistantJournal.stop();
    assert.equal(stored.has('assistantPendingJournal'),false);
});
