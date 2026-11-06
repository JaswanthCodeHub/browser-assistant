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

test('journal clock keeps counting after navigation and reload without starting a submission', async () => {
    const key = 'assistantJournalTimer';
    const saved = {};
    const storage = {
        get: async () => ({...saved}),
        set: async data => Object.assign(saved, data),
        onChanged: {addListener() {}},
    };
    const journalScript = fs.readFileSync(`${__dirname}/journal-automation.js`, 'utf8');
    let now = 10000;
    function openJournal(path, body) {
        const {window} = parseHTML(`<html><body>${body}</body></html>`);
        window.Element.prototype.getClientRects = () => [{}];
        const globals = {
            document: window.document, Event: window.Event, Date: {now: () => now},
            location: {origin: 'https://admissions.aurora.edu.in', pathname: `/modules/reflective-journal/${path}`},
            chrome: {storage: {local: storage}, runtime: {sendMessage: () => assert.fail('Unexpected journal request')}},
            sessionStorage: {getItem: () => null}, setInterval: () => 1,
        };
        globals.window = globals;
        vm.runInNewContext(journalScript, globals);
        return globals.document.querySelector('[data-countdown]');
    }

    assert.equal(openJournal('example', '<div>Time <span>42:51</span></div>').textContent, 'Portal time left 42:51');
    assert.equal(saved[key].deadline, now + 2571000);
    now += 12000;
    const reloaded = openJournal('example', 'Loading…');
    const otherJournal = openJournal('other', 'Loading…');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reloaded.textContent, 'Estimated time left 42:39');
    assert.equal(otherJournal.textContent, 'Waiting for the portal timer to appear.');

    const list = parseHTML('<html><body><div id="assistant-journal-list-clock" hidden></div></body></html>').document;
    const listGlobals = {
        document: list, Date: {now: () => now}, setInterval: () => 1,
        location: {origin: 'https://admissions.aurora.edu.in', pathname: '/modules/assessments/assessments'},
        chrome: {storage: {local: storage}},
    };
    listGlobals.window = listGlobals;
    vm.runInNewContext(journalScript, listGlobals);
    await new Promise(resolve => setImmediate(resolve));
    const listClock = list.getElementById('assistant-journal-list-clock');
    assert.equal(listClock.hidden, false);
    assert.match(listClock.textContent, /42:39$/);

    const {document} = parseHTML('<html><body><span id="server-status"></span><p id="journal-countdown" hidden></p></body></html>');
    let tick;
    vm.runInNewContext(fs.readFileSync(`${__dirname}/popup.js`, 'utf8'), {
        document, Date: {now: () => now},
        chrome: {storage: {local: storage}, runtime: {sendMessage: (_request, reply) =>
            reply ? reply({ok: true, data: {}}) : Promise.resolve([saved[key]])}},
        setInterval: callback => { tick = callback; },
    });
    await new Promise(resolve => setImmediate(resolve));
    const popup = document.getElementById('journal-countdown');
    assert.match(popup.textContent, /42:39$/);
    now += 1000;
    tick();
    assert.match(popup.textContent, /42:38$/);
    now = saved[key].deadline + 1000;
    tick();
    assert.equal(popup.hidden, true);

    now = 45000;
    assert.equal(openJournal('other', '<div>Time <span>52:00</span></div>').textContent, 'Portal time left 52:00');
    assert.match(saved[key].path, /\/other$/);
    const guidelines = '<h1>Reflective Journal Guidelines</h1><p><strong>Unsaved draft detected.</strong> Your previous responses will be restored when you start.</p>';
    const previousJournal = openJournal('example/', guidelines);
    const untrackedDraft = openJournal('untracked', guidelines);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(previousJournal.textContent, /^Estimated time left 42:16\./);
    assert.match(untrackedDraft.textContent, /^Waiting for the portal timer to appear\./);
    assert.match(untrackedDraft.textContent, /Accept Terms to Start/);
});

test('a newly rendered clock survives an immediate same-tab reload while extension storage is pending', () => {
    const session = new Map();
    let now = 10000;
    function open(body) {
        const {window} = parseHTML(`<html><body>${body}</body></html>`);
        window.Element.prototype.getClientRects = () => [{}];
        let observe;
        const globals = {
            document: window.document, Event: window.Event, Date: {now: () => now},
            location: {origin: 'https://admissions.aurora.edu.in', pathname: '/modules/reflective-journal/reload'},
            sessionStorage: {getItem: key => session.get(key), setItem: (key, value) => session.set(key, value)},
            setInterval: () => 1,
            MutationObserver: class { constructor(callback) { observe = callback; } observe() {} },
            chrome: {storage: {local: {get: () => new Promise(() => {}), set: () => new Promise(() => {})}}},
        };
        globals.window = globals;
        vm.runInNewContext(fs.readFileSync(`${__dirname}/journal-automation.js`, 'utf8'), globals);
        return {doc: window.document, observe, countdown: window.document.querySelector('[data-countdown]')};
    }
    const editor = open('<div id="portal-clock"></div>');
    const portalClock = editor.doc.getElementById('portal-clock');
    portalClock.innerHTML = '<span>Time</span><span>42:51</span>';
    editor.observe([{target: portalClock}]);
    assert.equal(editor.countdown.textContent, 'Portal time left 42:51');

    now += 1000;
    const draft = open('<p>Unsaved draft detected.</p><div role="timer">00:00</div>');
    assert.match(draft.countdown.textContent, /^Estimated time left 42:50\./);
});

test('WhatsApp reminder waits for the grace period, skips confirmation, and sends once without portal data', async () => {
    const path = '/modules/reflective-journal/example';
    const deadline = 3600000;
    const config = {url: 'https://n8n.example/webhook/journal', token: 'example-test-token-123'};
    const data = {assistantJournalTimer: {path, deadline}, assistantJournalReminderConfig: config};
    const requests = [];
    let now = deadline - 1800000;
    const chrome = {
        alarms: {create() {}, onAlarm: {addListener() {}}},
        runtime: {onInstalled: {addListener() {}}, onMessage: {addListener() {}}},
        storage: {local: {
            get: async keys => keys === undefined ? {...data} : Object.fromEntries([keys].flat().map(key => [key, data[key]])),
            set: async next => Object.assign(data, next),
        }},
    };
    const ctx = vm.createContext({chrome, Date: {now: () => now}, AbortSignal, importScripts() {},
        fetch: async (...args) => { requests.push(args); return {ok: true}; }});
    vm.runInContext(fs.readFileSync(`${__dirname}/background.js`, 'utf8'), ctx);
    await ctx.checkJournalReminder();
    assert.equal(requests.length, 0);
    now += 45000;
    const confirmation = `assistantJournalConfirmed:${path}`;
    data[confirmation] = true;
    await ctx.checkJournalReminder();
    assert.equal(requests.length, 0);
    delete data[confirmation];
    await Promise.all([ctx.checkJournalReminder(), ctx.checkJournalReminder()]);
    await ctx.checkJournalReminder();
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], config.url);
    assert.equal(requests[0][1].headers['X-Journal-Reminder-Token'], config.token);
    assert.deepEqual(JSON.parse(requests[0][1].body), {event: 'journal_submission_unconfirmed'});

    const second = '/modules/reflective-journal/second';
    data[`assistantJournalTimer:${path}`] = deadline;
    data[`assistantJournalTimer:${second}`] = deadline + 1000;
    data.assistantJournalTimer = {path: second, deadline: deadline + 1000};
    now += 1000;
    await ctx.checkJournalReminder();
    await ctx.checkJournalReminder();
    assert.equal(requests.length, 2);
});

test('the toolbar shows a global countdown from storage and clears after confirmation or expiry', async () => {
    const path = '/modules/reflective-journal/example';
    const deadline = 4000000;
    const data = {assistantJournalTimer: {path, deadline}};
    const badges = [];
    let now = deadline - 2571000;
    let storageChanged;
    const chrome = {
        alarms: {create() {}, onAlarm: {addListener() {}}},
        runtime: {onInstalled: {addListener() {}}, onMessage: {addListener() {}}},
        storage: {local: {
            get: async key => key === undefined ? {...data} : {[key]: data[key]},
            onChanged: {addListener: listener => { storageChanged = listener; }},
        }},
        action: {setBadgeText: badge => badges.push(badge), setBadgeBackgroundColor() {}, setTitle() {}},
    };
    const ctx = vm.createContext({chrome, Date: {now: () => now}, importScripts() {}});
    vm.runInNewContext(fs.readFileSync(`${__dirname}/background.js`, 'utf8'), ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(badges.at(-1).text, '43m');
    assert.equal(badges.at(-1).tabId, undefined);

    const second = '/modules/reflective-journal/second';
    data[`assistantJournalTimer:${path}`] = deadline;
    data[`assistantJournalTimer:${second}`] = deadline + 60000;
    data.assistantJournalTimer = {path: second, deadline: deadline + 60000};
    assert.equal(ctx.activeJournalTimers(data).length, 2);
    assert.equal(ctx.activeJournalTimers(data)[0].path, path);

    now = deadline - 20000;
    await ctx.updateJournalBadge();
    assert.equal(badges.at(-1).text, '<1m');
    const confirmation = `assistantJournalConfirmed:${path}`;
    data[confirmation] = true;
    storageChanged({[confirmation]: {newValue: true}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(badges.at(-1).text, '2m');
    delete data[confirmation];
    now = deadline + 60001;
    await ctx.updateJournalBadge();
    assert.equal(badges.at(-1).text, '');
});

test('the website overlay shows the saved countdown with the panel closed and removes it on confirmation', async () => {
    const {document} = parseHTML('<html><body><div id="assistant-root" hidden></div></body></html>');
    const path = '/modules/reflective-journal/another-site';
    const secondPath = '/modules/reflective-journal/second';
    let timers = [{path, deadline: 2581000}, {path: secondPath, deadline: 3010000}];
    let now = 10000;
    let tick;
    let onChange;
    const local = {
        onChanged: {addListener: listener => { onChange = listener; }, removeListener() {}},
    };
    const location = {origin: 'https://example.com', pathname: '/'};
    const context = vm.createContext({document, location, chrome: {storage: {local}, runtime: {sendMessage: async () => timers}}, Date: {now: () => now},
        window: {setTimeout: callback => { tick = callback; return 1; }, clearTimeout() {}}});
    const source = fs.readFileSync(`${__dirname}/content.js`, 'utf8');
    vm.runInContext(source.slice(0, source.indexOf('(function () {')), context);
    const create = document.createElement.bind(document);
    let shadow;
    document.createElement = (...args) => {
        const element = create(...args);
        if (args[0] === 'div') {
            const attach = element.attachShadow.bind(element);
            element.attachShadow = options => { shadow = attach(options); return shadow; };
        }
        return element;
    };
    const controller = new AbortController();
    const badge = context.mountJournalCountdown(controller.signal);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(badge.isConnected, true);
    assert.equal(badge.textContent, '');
    assert.match(shadow.querySelector('[role="timer"]').textContent, /42:51 · 50:00$/);
    location.origin = 'https://admissions.aurora.edu.in';
    location.pathname = secondPath;
    now += 1000;
    tick();
    assert.match(shadow.querySelector('[role="timer"]').textContent, /42:50$/);
    const confirmation = `assistantJournalConfirmed:${path}`;
    timers = timers.filter(timer => timer.path !== path);
    onChange({[confirmation]: {newValue: true}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(badge.isConnected, false);
    controller.abort();
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
