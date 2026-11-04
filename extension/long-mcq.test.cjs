const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');

function snippetBackground() {
    let listener;
    const injections=[];
    const ctx=vm.createContext({URL,importScripts(){},browserAssistantReadMcqSnippets(){},
        chrome:{alarms:{create(){},onAlarm:{addListener(){}}},
            runtime:{id:'ours',onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
            scripting:{executeScript:async options=>{injections.push(options);return [{result:{ok:true,sources:['full source including offscreen tail']}}];}}}});
    vm.runInContext(fs.readFileSync(`${__dirname}/background.js`,'utf8'),ctx);
    return {injections,send:sender=>new Promise(resolve=>listener({action:'mcqSnippets'},sender,resolve))};
}

test('full MCQ snippet access survives CCBP SPA routes, review pages and missing top-frame URL',async()=>{
    const h=snippetBackground();
    const current='https://learning.ccbp.in/primitive-coding/practice/a/b';
    for(const url of [current,'https://learning.ccbp.in/question/old-document',
        'https://learning.ccbp.in/primitive-coding-review/practice/a/b',undefined]) {
        const result=await h.send({id:'ours',url,frameId:0,tab:{id:7,url:current}});
        assert.equal(result.ok,true,`Document URL: ${url}`);
        assert.match(result.sources[0],/offscreen tail/);
    }
    assert.equal(h.injections.length,4);
    for(const injection of h.injections) {
        assert.equal(injection.world,'MAIN');assert.equal(injection.target.tabId,7);
        assert.deepEqual(Array.from(injection.target.frameIds),[0]);
    }
    assert.equal((await h.send({id:'ours',url:current,frameId:4,tab:{id:7,url:current}})).ok,true);
    assert.deepEqual(Array.from(h.injections[4].target.frameIds),[4]);
});

test('snippet route expansion still rejects foreign senders, sites and unidentified child frames',async()=>{
    const h=snippetBackground();
    const sender={id:'ours',url:'https://learning.ccbp.in/primitive-coding/practice/a/b',frameId:0,tab:{id:7,url:'https://learning.ccbp.in/'}};
    for(const invalid of [{...sender,id:'other'},{...sender,tab:undefined},
        {...sender,url:'https://learning.ccbp.in.evil.test/primitive-coding/practice/a/b'},
        {...sender,url:'http://learning.ccbp.in/primitive-coding/practice/a/b'},
        {...sender,url:undefined,frameId:4},{...sender,url:'about:blank',frameId:4}]) {
        assert.equal((await h.send(invalid)).ok,false);
    }
    assert.equal(h.injections.length,0);
});
test('snippet bridge reads full offscreen source from a read-only model without writing',()=>{
    const code='const db = null;\n'.repeat(1000)+'response.send("TAIL_SENTINEL");';
    const node={getClientRects:()=>[{}],closest:()=>null,matches:s=>s==='.ace_editor',env:{editor:{getReadOnly:()=>true,getValue:()=>code,setValue:()=>{throw new Error('must not write');}}}};
    const ctx=vm.createContext({document:{querySelectorAll:()=>[node]}});
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`,'utf8'),ctx);
    const result=ctx.browserAssistantReadMcqSnippets();
    assert.equal(result.ok,true);assert.equal(result.sources[0],code);
});
test('read-only MCQ pseudocode can reuse the coding editor id without being excluded',()=>{
    const node={getClientRects:()=>[{}],closest:selector=>selector.includes('#codingQuestionEditor')?{}:null,
        matches:s=>s==='.ace_editor',env:{editor:{getValue:()=> 'result.push_back(prefix[R] - prefix[L - 1])'}}};
    const ctx=vm.createContext({document:{querySelectorAll:()=>[node]}});
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`,'utf8'),ctx);
    assert.equal(ctx.browserAssistantReadMcqSnippets().sources.length,1);
});
test('Ace viewport rerenders do not alter MCQ identity, but real prompt changes do',()=>{
    const {document,window}=parseHTML('<html><body><section><div id="generic-question-wrapper-id"><p>What is returned by the successful database update?</p><div class="ace_editor"><div class="ace_line">first visible line</div></div></div><fieldset><div role="radiogroup"><div role="radio">DB Error</div><div role="radio">Update successful</div></div></fieldset></section></body></html>');
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    vm.runInContext(fs.readFileSync(`${__dirname}/automation-policy.js`,'utf8'),vm.createContext({window,URL}));
    const adapter=window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const before=adapter.getQuestion(document);
    document.querySelector('.ace_line').textContent='another line visible after scrolling';
    const after=adapter.getQuestion(document);
    assert.equal(before.identityText,after.identityText);assert.notEqual(before.text,after.text);
    document.querySelector('p').textContent='What happens when the database update fails?';
    assert.notEqual(adapter.getQuestion(document).identityText,before.identityText);
});

for(const partial of [false,true])test(`Ace pseudocode DOM fallback requires every logical row (partial=${partial})`,()=>{
    const lines=['buildPrefixSum(arr) {','return prefix[R] - prefix[L - 1]','}'];
    const node={getClientRects:()=>[{}],closest:()=>null,matches:s=>s==='.ace_editor',querySelectorAll:selector=>
        selector==='.ace_line'?lines.map(textContent=>({textContent,getBoundingClientRect:()=>({height:20})})):
        lines.map((_,index)=>({textContent:String(index+1)})),
        querySelector:()=>({style:{height:partial?'400px':'60px'},scrollHeight:partial?400:60})};
    const ctx=vm.createContext({document:{querySelectorAll:()=>[node]}});
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`,'utf8'),ctx);
    const snapshot=ctx.browserAssistantReadMcqSnippets();
    assert.equal(snapshot.ok,!partial);
    if(!partial)assert.equal(snapshot.sources[0],lines.join('\n'));
});

test('MCQ can recover complete source in the isolated world when MAIN injection returns nothing',async()=>{
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    let requests=0;
    const ctx=vm.createContext({waitWhilePaused:async()=>true,hasSameQuestionOptions:()=>true,getAuthorizedQuestion:()=>({}),
        safeSendMessage:async()=>{requests++;return {ok:false,error:'No result from MAIN world'};},
        browserAssistantReadMcqSnippets:()=>({ok:true,sources:['Complete 25-line pseudocode']}),setTimeout:fn=>fn()});
    vm.runInContext(source.slice(source.indexOf('    async function readMcqSnippetSnapshot('),source.indexOf('    async function requestPracticeAnswer(')),ctx);
    const snapshot=await ctx.readMcqSnippetSnapshot({},1);
    assert.equal(snapshot.sources[0],'Complete 25-line pseudocode');assert.equal(requests,1);
});

test('MCQ waits for a late-mounted editor and does not accept a partial fallback',async()=>{
    const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    let requests=0;
    const ctx=vm.createContext({waitWhilePaused:async()=>true,hasSameQuestionOptions:()=>true,getAuthorizedQuestion:()=>({}),
        safeSendMessage:async()=>++requests<3?{ok:false}:{ok:true,sources:['Full model after mount']},
        browserAssistantReadMcqSnippets:()=>({ok:false,error:'Partial DOM'}),setTimeout:fn=>fn()});
    vm.runInContext(source.slice(source.indexOf('    async function readMcqSnippetSnapshot('),source.indexOf('    async function requestPracticeAnswer(')),ctx);
    const snapshot=await ctx.readMcqSnippetSnapshot({},1);
    assert.equal(snapshot.sources[0],'Full model after mount');assert.equal(requests,3);
});

test('SQL editor options retain complete model text and survive viewport repaint during a request',async()=>{
    const {document,window}=parseHTML(`<html><body><section>
        <div id="generic-question-wrapper-id"><p>Which SQL query finds books with matching titles?</p></div>
        <fieldset><div role="radiogroup">
          <div role="radio"><div class="ace_editor"><div class="ace_gutter">1</div><div class="ace_line">SELECT *</div></div></div>
          <div role="radio"><div class="ace_editor"><div class="ace_gutter">1</div><div class="ace_line">SELECT *</div></div></div>
        </div></fieldset><button>Submit</button></section></body></html>`);
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    const editors=[...document.querySelectorAll('.ace_editor')];
    const models=['SELECT *\nFROM book\nWHERE title LIKE "%harry%";', 'SELECT *\nFROM book\nWHERE title = "harry";'];
    editors.forEach((node,index)=>{node.env={editor:{getValue:()=>models[index]}};});
    const ctx=vm.createContext({document,window,URL});
    for(const file of ['editor-bridge.js','automation-policy.js','answer-requests.js'])
        vm.runInContext(fs.readFileSync(`${__dirname}/${file}`,'utf8'),ctx);
    const content=fs.readFileSync(`${__dirname}/content.js`,'utf8');
    vm.runInContext(content.slice(content.indexOf('    function normalizeAutomationText('),content.indexOf('    function getAuthorizedQuestion(')),ctx);
    const adapter=window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq');
    const initial=adapter.getQuestion(document);
    const snapshot=ctx.browserAssistantReadMcqSnippets();
    ctx.browserAssistantCacheMcqSnippets(snapshot);
    const question=adapter.getQuestion(document);
    assert.equal(ctx.hasSameQuestionOptions(initial,question),true);
    assert.match(question.options[0].text,/FROM book WHERE title LIKE/);
    assert.match(question.options[1].text,/FROM book WHERE title =/);
    assert.notEqual(question.options[0].text,question.options[1].text);
    const signature=ctx.questionSignature(question.identityText,question.options);
    const response={ok:true};
    const result=await window.BrowserAssistantAnswerRequests.run({
        request:async()=>{
            editors[0].querySelector('.ace_line').textContent='WHERE title LIKE "%harry%";';
            editors[0].querySelector('.ace_gutter').textContent='3';
            editors[1].querySelector('.ace_line').textContent='WHERE title = "harry";';
            return response;
        },active:()=>true,ready:async()=>true,
        current:()=>ctx.hasSameQuestionOptions(question,adapter.getQuestion(document)),
        onRetry(){throw Error('No retry expected');},sleep:async()=>{},
    });
    assert.equal(result,response);
    assert.equal(ctx.questionSignature(question.identityText,adapter.getQuestion(document).options),signature);
    assert.equal(JSON.stringify(ctx.browserAssistantReadMcqSnippets().sources),JSON.stringify(snapshot.sources));
    models[1]='DELETE FROM book;';
    assert.notEqual(JSON.stringify(ctx.browserAssistantReadMcqSnippets().sources),JSON.stringify(snapshot.sources));
    document.querySelector('p').textContent='Which query deletes all books?';
    assert.equal(ctx.hasSameQuestionOptions(question,adapter.getQuestion(document)),false);
});

test('cached models keep duplicate editor bindings even when source text is deduplicated',()=>{
    const {document,window}=parseHTML('<html><body><div class="ace_editor"></div><div class="ace_editor"></div></body></html>');
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    const nodes=[...document.querySelectorAll('.ace_editor')];
    nodes.forEach(node=>{node.env={editor:{getValue:()=> 'SELECT * FROM book;'}};});
    const ctx=vm.createContext({document});
    vm.runInContext(fs.readFileSync(`${__dirname}/editor-bridge.js`,'utf8'),ctx);
    const snapshot=ctx.browserAssistantReadMcqSnippets();
    assert.equal(snapshot.sources.length,1);assert.equal(snapshot.editorSources.length,2);
    ctx.browserAssistantCacheMcqSnippets(snapshot);
    for(const node of nodes)assert.equal(ctx.browserAssistantCachedMcqSnippet(node),'SELECT * FROM book;');
});
