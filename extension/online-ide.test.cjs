const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
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
    let finishInitialLookup;
    const initialLookup = new Promise(resolve => { finishInitialLookup = resolve; });
    let firstLookup = true;
    const requests=[],displayed=[];
    const automation={runId:0};
    const question={title:'Cricket Team',text:'Implement API 1 and API 5.',button:{click(){clicks++;}}};
    const ctx=vm.createContext({location:{href:url},document:{},automation,getAutomationContext:()=>({}),window:{BrowserAssistantCoding:{getOnlineIdeQuestion:()=>question}},
        setTimeout:fn=>fn(),updateAutomationUI(){},waitWhilePaused:async()=>true,
        safeSendMessage:async()=>{
            if (firstLookup) { firstLookup = false; await initialLookup; }
            return {ok:true,found:existing || clicks>0};
        },
        apiRequest:async(path,method,body)=>{
            requests.push({path,method,body});
            finishInitialLookup();
            return {ok:true,data:{results:JSON.stringify([{type:'code',language:'javascript',code:'module.exports = app'}])}};
        },stopAutomation(state){automation.state=state;automation.runId++;},displayResults:result=>displayed.push(result)});
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    vm.runInContext(source.slice(source.indexOf('    async function runOnlineIdeAutomation('),source.indexOf('    async function startPracticeAutomation(')),ctx);
    const run = ctx.runOnlineIdeAutomation(question);
    assert.equal(requests.length,1,'Answer request starts while IDE lookup is pending');
    await run;
    assert.equal(clicks,existing ? 0 : 1);
    assert.equal(requests.length,1);
    assert.equal(requests[0].body.language,'javascript');
    assert.match(requests[0].body.text,/API 5/);
    assert.equal(automation.state,'CODE_READY');
    assert.equal(displayed[0][0].title,'app.js');
});

function terminalFixture({existingCode='',idle=true}={}) {
    const workspace = 'EXAMPLE5A1';
    const token = '83e3d6bd-27c2-4a73-b74c-29c4b53f1ae4';
    const marker = `BA_RESULT_${token}`;
    const report = `${origin}/ide-coding-submission/${id}/bcc0709e-fea6-421e-a46b-fcb119910fe2`;
    const prompt = `nxtwave@${workspace}:~/nodejs/coding-practices/coding-practice-5a$`;
    const output = {children:[{textContent:idle ? prompt : 'Running Tests ...'}]};
    let command, enter=0;
    const input = {getClientRects:()=>[{}],closest:()=>({querySelector:()=>output}),focus(){document.activeElement=input;},
        dispatchEvent(event){
            if(event.type==='paste') {
                command=event.clipboardData.value;
                output.children=[{textContent:prompt+command}];
            } else if(event.key==='Enter') {
                enter++;
                output.children=['All test cases passed',`Open Submission URL : ${report}`,`${marker}:0`,prompt].map(textContent=>({textContent}));
            }
        }};
    const file = {getClientRects:()=>[{}],click(){}};
    const editor = {getClientRects:()=>[{}],getAttribute:()=> 'file:///home/work/code/coding-practice-5a/app.js',
        querySelector:()=>({textContent:existingCode})};
    const document = {visibilityState:'visible',querySelectorAll(selector){
        if(selector.startsWith('.xterm')) return [input];
        if(selector.startsWith('div[title="app.js"')) return [file];
        if(selector.startsWith('.monaco-editor')) return [editor];
        return [];
    }};
    const ctx=vm.createContext({window:{},document,location:{origin:'https://ide.ccbp.in',pathname:`/playground/${workspace}`},
        TextEncoder,btoa,crypto:webcrypto,setTimeout:fn=>fn(),
        DataTransfer:class{setData(type,value){this.value=value;}},
        ClipboardEvent:class{constructor(type,options){Object.assign(this,{type},options);}},
        KeyboardEvent:class{constructor(type,options){Object.assign(this,{type},options);}}});
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`,'utf8'),ctx);
    return {run:(action,code)=>ctx.browserAssistantOnlineIdeTerminal(action,workspace,id,token,code),report,output,
        command:()=>command,entered:()=>enter};
}

test('IDE automation encodes source, requires terminal echo, and ties success to a fresh grading report', async () => {
    const terminal = terminalFixture();
    const source = 'const value = "$(echo test)";\nmodule.exports = value;';
    const result = await terminal.run('runOnlineIde',source);
    assert.equal(result.started,true);
    assert.equal(terminal.entered(),1);
    assert.doesNotMatch(terminal.command(),/\$\(echo test\)/);
    assert.ok(terminal.command().includes(Buffer.from(source).toString('base64')));
    assert.match(terminal.command(),/&& ccbp submit EXAMPLE5A1;/);
    assert.equal((await terminal.run('onlineIdeStatus')).url,terminal.report);
    assert.equal((await terminal.run('onlineIdeStatus')).passed,true);
    terminal.output.children.shift();
    assert.equal((await terminal.run('onlineIdeStatus')).passed,false);
    assert.equal((await terminal.run('runOnlineIde',source)).ok,false);
    assert.equal(terminal.entered(),1);
});

test('IDE automation leaves a nonempty app.js and busy terminal alone', async () => {
    for(const settings of [{existingCode:'const userCode = true'},{idle:false}]) {
        const terminal=terminalFixture(settings);
        assert.equal((await terminal.run('runOnlineIde','module.exports = 1')).ok,false);
        assert.equal(terminal.command(),undefined);
        assert.equal(terminal.entered(),0);
    }
});

test('a reviewed IDE solution is submitted once and only confirmed grading counts as completed', async () => {
    const automation={runId:0};
    const actions=[];
    const ctx=vm.createContext({location:{href:url},automation,crypto:webcrypto,
        getAutomationContext:()=>({}),automationPolicy:{canExecute:()=>true},
        setTimeout:fn=>fn(),updateAutomationUI(){},waitWhilePaused:async()=>true,
        safeSendMessage:async message=>{
            actions.push(message.action);
            if(message.action==='focusOnlineIde') return {ok:true,found:true};
            if(message.action==='runOnlineIde') return {ok:true,started:true};
            return {ok:true,done:true,passed:true,submitted:true};
        },
        apiRequest:async()=>({ok:true,data:{code_reviewed:true,results:JSON.stringify([{type:'code',code:'module.exports = app'}])}}),
        stopAutomation(state){automation.state=state;automation.runId++;}});
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    vm.runInContext(source.slice(source.indexOf('    async function runOnlineIdeAutomation('),source.indexOf('    async function startPracticeAutomation(')),ctx);
    await ctx.runOnlineIdeAutomation({title:'Movies',text:'Write all seven API routes.',workspace:'EXAMPLE5A1'});
    assert.deepEqual(actions,['focusOnlineIde','runOnlineIde','onlineIdeStatus']);
    assert.equal(automation.state,'COMPLETED');
    assert.equal(automation.completed,1);
});
