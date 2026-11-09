const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const content=fs.readFileSync(`${__dirname}/content.js`,'utf8');

function setup({changed=false,raw=false,code=false,mismatch=false}={}) {
    const question={text:'Budget 4000: rent and entertainment combined?',identityText:'Budget 4000: rent and entertainment combined?',
        options:[{text:'1400'},{text:'2800 BELOW_VIEWPORT_SENTINEL'}]};
    let current=question;
    const requests=[],errors=[],displayed=[],captures=[];
    const journalCountdownBadge={style:{visibility:''}};
    const ctx=vm.createContext({window:{BrowserAssistantQuestionVisuals:{
        nodes:()=>code?[]:[{}],fingerprint:()=> 'chart-unchanged',reviewCapture:async image=>image,
        capture:async()=>({images:['data:image/png;base64,FULL_CHART','data:image/png;base64,FULL_LEGEND'],fingerprint:'chart-unchanged'})}},
        location:{href:'https://learning.ccbp.in/primitive-coding/practice/a/b',origin:'https://learning.ccbp.in'},
        document:{querySelector:()=>code?{}:null},root:{style:{visibility:''}},journalCountdownBadge,selectedMode:'auto',isScanning:false,isCollapsed:false,
        getAuthorizedQuestion:()=>current,hasSameQuestionOptions:(before,after)=>before===after,
        render(){},setLoading(){},updateScanControls(){},requestAnimationFrame:fn=>fn(),console:{error(){}},
        safeSendMessage:async request=>{captures.push(request.action);
            if(request.action==='captureVisibleTab')assert.equal(journalCountdownBadge.style.visibility,'hidden');
            return request.action==='mcqSnippets'
            ?{ok:true,sources:['SELECT * FROM book WHERE title LIKE "%harry%"; FULL_SQL_TAIL'],editorSources:['FULL_SQL_TAIL']}
            :{dataUrl:'data:image/png;base64,SCREEN'};},
        browserAssistantCacheMcqSnippets(){question.options[1].text='SELECT * FROM book FULL_SQL_TAIL';},
        apiRequest:async(path,method,body)=>{requests.push({path,method,body});if(changed)current={...question,text:'Different question'};
            const answer=`Option ${mismatch?'A':'B'}: ${question.options[1].text}`;
            return {ok:true,data:{provider:'test [cross-checked]',answer_verified:true,
                results:raw?'Option B: 2800':JSON.stringify([{type:'mcq',answer}])}};},
        displayResults:(...args)=>displayed.push(args),showError:error=>errors.push(error),clearTimeout(){},
    });
    vm.runInContext(content.slice(content.indexOf('    function answerIndexesFromResult('),content.indexOf('    function updateAutomationUI(')),ctx);
    vm.runInContext(content.slice(content.indexOf('    async function visionScan('),content.indexOf('    // ── Page text scan')),ctx);
    return {ctx,requests,errors,displayed,captures};
}

test('manual Vision sends the complete chart and below-viewport options without a cropped screenshot',async()=>{
    const h=setup();await h.ctx.visionScan();
    assert.equal(h.errors.length,0);assert.equal(h.displayed.length,1);
    assert.equal(h.captures.length,0);
    assert.match(h.requests[0].body.text,/B\. 2800 BELOW_VIEWPORT_SENTINEL/);
    assert.equal(h.requests[0].body.image,'data:image/png;base64,FULL_CHART');
    assert.deepEqual(Array.from(h.requests[0].body.images),['data:image/png;base64,FULL_LEGEND']);
    assert.equal(h.requests[0].body.practice_type,'mcq');
    assert.equal(h.requests[0].body.verify_answer,true);
});

test('manual Vision does not display a stale result after the question changes',async()=>{
    const h=setup({changed:true});await h.ctx.visionScan();
    assert.equal(h.displayed.length,0);assert.match(h.errors[0],/Question or illustration changed/);
});

test('Vision never fabricates an answer by extracting a letter from malformed output',async()=>{
    const h=setup({raw:true});await h.ctx.visionScan();
    assert.equal(h.displayed.length,0);assert.match(h.errors[0],/invalid answer format/);
});

test('manual Vision withholds a result when its letter and displayed option conflict',async()=>{
    const h=setup({mismatch:true});await h.ctx.visionScan();
    assert.equal(h.displayed.length,0);assert.match(h.errors[0],/did not match the displayed options/);
});

test('manual Vision hydrates full code options before requesting an answer and rechecks them',async()=>{
    const h=setup({code:true});await h.ctx.visionScan();
    assert.equal(h.errors.length,0);assert.equal(h.displayed.length,1);
    assert.match(h.requests[0].body.text,/Complete code snippets:/);
    assert.match(h.requests[0].body.text,/B\. SELECT \* FROM book FULL_SQL_TAIL/);
    assert.equal(h.captures.filter(action=>action==='mcqSnippets').length,3);
    assert.equal(h.ctx.journalCountdownBadge.style.visibility,'');
});
