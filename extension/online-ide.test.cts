const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash,webcrypto} = require('node:crypto');
const id = '11111111-2222-4333-8444-555555555555';
const origin = 'https://learning.ccbp.in';
const url = `${origin}/question/${id}`;

test('IDE lookup focuses only the matching workspace for the requesting question', async () => {
    const updates = [];
    let listener;
    const chrome = {runtime:{id:'assistant',onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
        alarms:{create(){},onAlarm:{addListener(){}}},
        tabs:{query:async query=>{
            assert.equal(query.windowId,5);
            return [{id:1,url:`${origin}/ide/OLD?q_id=other`},
                {id:2,url:`https://example.test/ide/WRONG?q_id=${id}`},
                {id:3,url:`${origin}/ide/WORKSPACE?q_id=${id}`}];
        },update:async (tabId,options)=>updates.push([tabId,options.active])}};
    const ctx = vm.createContext({chrome,URL,importScripts(){}});
    vm.runInContext(fs.readFileSync(`${__dirname}/background.js`,'utf8'),ctx);
    const ask = sender => new Promise(resolve=>listener({action:'focusOnlineIde'},sender,resolve));
    const sender = {id:'assistant',url,tab:{id:9,windowId:5,url}};
    assert.equal((await ask(sender)).found,true);
    assert.equal((await ask({...sender,frameId:2})).ok,false);
    assert.deepEqual(updates,[[3,true]]);
});

for (const existing of [true,false]) test(`IDE Start ${existing ? 'reuses the existing tab' : 'opens the portal IDE once'} and prepares app.js`, async () => {
    let clicks=0;
    let reviewed = false;
    const requests=[],displayed=[];
    const automation={runId:0};
    const question={title:'Cricket Team',text:'Implement API 1 and API 5.',button:{click(){clicks++;}}};
    const ctx=vm.createContext({location:{href:url},document:{},automation,getAutomationContext:()=>({}),window:{BrowserAssistantCoding:{getOnlineIdeQuestion:()=>question}},
        setTimeout:fn=>fn(),updateAutomationUI(){},waitWhilePaused:async()=>true,
        reviewCodingAction:async()=>{reviewed = true;return true;},
        safeSendMessage:async()=>{
            assert.equal(reviewed,true,'Approve the source before opening the IDE');
            return {ok:true,found:existing || clicks>0};
        },
        apiRequest:async(path,method,body)=>{
            requests.push({path,method,body});
            return {ok:true,data:{results:JSON.stringify([{type:'code',language:'javascript',code:'module.exports = app'}])}};
        },stopAutomation(state){automation.state=state;automation.runId++;},displayResults:result=>displayed.push(result)});
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    vm.runInContext(source.slice(source.indexOf('    async function runOnlineIdeAutomation('),source.indexOf('    async function startPracticeAutomation(')),ctx);
    await ctx.runOnlineIdeAutomation(question);
    assert.equal(clicks,existing ? 0 : 1);
    assert.equal(requests.length,1);
    assert.equal(requests[0].body.language,'javascript');
    assert.match(requests[0].body.text,/API 5/);
    assert.equal(automation.state,'CODE_READY');
    assert.equal(displayed[0][0].title,'app.js');
});

function ideFixture({existingCode='',idle=true,allowPaste=true,saved=true,editorFolder='coding-practice-5a',firstVisibleLine='1'}={}) {
    const workspace = 'EXAMPLE5A1';
    const token = '83e3d6bd-27c2-4a73-b74c-29c4b53f1ae4';
    const marker = `BA_RESULT_${token}`;
    const report = `${origin}/ide-coding-submission/${id}/bcc0709e-fea6-421e-a46b-fcb119910fe2`;
    const prompt = `nxtwave@${workspace}:~/nodejs/coding-practices/coding-practice-5a$`;
    const output = {children:[{textContent:idle ? prompt : 'Running Tests ...'}]};
    let command, enter=0, editorCode=existingCode, now=0;
    const events=[];
    const input = {getClientRects:()=>[{}],closest:()=>({querySelector:()=>output}),focus(){document.activeElement=input;},
        dispatchEvent(event){
            if(event.type==='paste') {
                events.push('terminal paste');
                command=event.clipboardData.value;
                output.children=[{textContent:prompt+command}];
            } else if(event.key==='Enter') {
                enter++;
                events.push('terminal enter');
                output.children=(saved
                    ? ['All test cases passed',`Open Submission URL : ${report}`,`${marker}:0`,prompt]
                    : [`BA_APP_JS_NOT_SAVED_${token}`,`${marker}:1`,prompt]).map(textContent=>({textContent}));
            }
        }};
    let opened=false;
    const file = {getClientRects:()=>[{}],click(){opened=true;events.push('open app.js');}};
    const editorInput = {
        focus(){document.activeElement=editorInput;},
        dispatchEvent(event){
            assert.equal(event.type,'paste');
            assert.equal(event.composed,true,'editor paste reaches the IDE clipboard guard across shadow DOM');
            events.push('editor paste');
            if (allowPaste) editorCode=event.clipboardData.value;
        },
    };
    const rendered = {get textContent(){return editorCode;},querySelector:()=>({}),querySelectorAll:()=>[{}]};
    const editor = {getClientRects:()=>[{}],getAttribute:()=> `file:///home/work/code/${editorFolder}/app.js`,
        querySelector:selector=>selector==='textarea.inputarea' ? editorInput : rendered,
        querySelectorAll:()=>[{textContent:firstVisibleLine}]};
    const document = {visibilityState:'visible',querySelectorAll(selector){
        if(selector.startsWith('.xterm')) return [input];
        if(selector.startsWith('div[title="app.js"')) return [file];
        if(selector.startsWith('.monaco-editor')) return opened ? [editor] : [];
        return [];
    }};
    const ctx=vm.createContext({window:{},document,location:{origin:'https://ide.ccbp.in',pathname:`/playground/${workspace}`},
        TextEncoder,crypto:webcrypto,Date:{now:()=>now},setTimeout:(fn,ms)=>{now+=ms;fn();},
        DataTransfer:class{setData(type,value){this.value=value;}},
        ClipboardEvent:class{constructor(type,options){Object.assign(this,{type},options);}},
        KeyboardEvent:class{constructor(type,options){Object.assign(this,{type},options);}}});
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`,'utf8'),ctx);
    return {run:(action,code)=>ctx.browserAssistantOnlineIde(action,workspace,id,token,code),report,output,events,
        command:()=>command,entered:()=>enter,editorCode:()=>editorCode};
}

test('IDE automation pastes source into app.js and checks the saved file and syntax', async () => {
    const ide = ideFixture();
    const source = 'const value = "$(echo test)";\nmodule.exports = value;';
    const result = await ide.run('runOnlineIde',source.replace('\n','\r\n'));
    assert.equal(result.started,true);
    assert.deepEqual(ide.events,['open app.js','editor paste','terminal paste','terminal enter']);
    assert.equal(ide.editorCode(),source);
    assert.equal(ide.entered(),1);
    assert.doesNotMatch(ide.command(),/echo test|module\.exports|node -e|writeFile/);
    assert.ok(!ide.command().includes(Buffer.from(source).toString('base64')));
    assert.ok(ide.command().includes(createHash('sha256').update(source).digest('hex')));
    assert.match(ide.command(),/if .*sha256sum --check --status; then node --check app\.js;/);
    assert.doesNotMatch(ide.command(),/ccbp submit/);
    assert.equal((await ide.run('onlineIdeStatus')).saved,true);
    assert.equal((await ide.run('runOnlineIde',source)).ok,false);
    assert.equal(ide.entered(),1);
});

test('IDE automation leaves existing or unconfirmed editor content and a busy terminal alone', async () => {
    for(const settings of [{existingCode:'const userCode = true'},{idle:false},{editorFolder:'other'},{firstVisibleLine:'12'}]) {
        const ide=ideFixture(settings);
        assert.equal((await ide.run('runOnlineIde','module.exports = 1')).ok,false);
        assert.equal(ide.editorCode(),settings.existingCode ?? '');
        assert.ok(!ide.events.includes('editor paste'));
        assert.equal(ide.command(),undefined);
        assert.equal(ide.entered(),0);
    }
});

test('a blocked editor paste never falls back to the terminal', async () => {
    const ide=ideFixture({allowPaste:false});
    const result=await ide.run('runOnlineIde','module.exports = 1');
    assert.match(result.error,/did not confirm the paste into app\.js/);
    assert.deepEqual(ide.events,['open app.js','editor paste']);
    assert.equal(ide.editorCode(),'');
});

test('an unconfirmed autosave produces a save error instead of a grading result', async () => {
    const ide=ideFixture({saved:false});
    await ide.run('runOnlineIde','module.exports = 1');
    const result=await ide.run('onlineIdeStatus');
    assert.equal(result.saveUnconfirmed,true);
    assert.equal(result.saved,false);
});

test('a reviewed IDE solution is saved once and leaves grading to the user', async () => {
    const automation={runId:0};
    const actions=[];
    const ctx=vm.createContext({location:{href:url},automation,crypto:webcrypto,
        getAutomationContext:()=>({}),automationPolicy:{canExecute:()=>true},
        setTimeout:fn=>fn(),updateAutomationUI(){},waitWhilePaused:async()=>true,
        reviewCodingAction:async()=>true,displayResults(){},
        safeSendMessage:async message=>{
            actions.push(message.action);
            if(message.action==='focusOnlineIde') return {ok:true,found:true};
            if(message.action==='runOnlineIde') return {ok:true,started:true};
            return {ok:true,done:true,saved:true};
        },
        apiRequest:async()=>({ok:true,data:{code_reviewed:true,results:JSON.stringify([{type:'code',code:'module.exports = app'}])}}),
        stopAutomation(state){automation.state=state;automation.runId++;}});
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    vm.runInContext(source.slice(source.indexOf('    async function runOnlineIdeAutomation('),source.indexOf('    async function startPracticeAutomation(')),ctx);
    await ctx.runOnlineIdeAutomation({title:'Movies',text:'Write all seven API routes.',workspace:'EXAMPLE5A1'});
    assert.deepEqual(actions,['focusOnlineIde','runOnlineIde','onlineIdeStatus']);
    assert.equal(automation.state,'IDE_READY_FOR_GRADING');
    assert.equal(automation.completed,1);
});
