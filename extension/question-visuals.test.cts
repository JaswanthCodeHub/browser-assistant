const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');

function setup() {
    const {document,window}=parseHTML(`<html><body><header><img src="logo.png"></header><section>
      <div id="generic-question-wrapper-id"><img id="chart" src="https://charts.example/budget.png" width="600" height="600">
      <p>If the household budget is Rs. 4000, what is spent on Rent and Entertainment combined?</p></div>
      <fieldset><div role="radiogroup"><div role="radio">Rs. 1,400</div><div role="radio">Rs. 2,800</div></div></fieldset>
      </section></body></html>`);
    window.HTMLElement.prototype.getClientRects=()=>[{}];
    window.setTimeout=setTimeout;window.clearTimeout=clearTimeout;
    const ctx=vm.createContext({document,window,URL,location:{href:'https://learning.ccbp.in/primitive-coding-review/practice/a/b'}});
    for(const file of ['automation-policy.js','question-visuals.js'])vm.runInContext(fs.readFileSync(`${__dirname}/${file}`,'utf8'),ctx);
    const question=window.BrowserAssistantAutomationPolicy.getAdapter('semantic-mcq').getQuestion(document);
    return {document,window,ctx,question,visuals:window.BrowserAssistantQuestionVisuals};
}
function fakeImageDecoder(fixture) {
    fixture.ctx.Image=class {naturalWidth=600;naturalHeight=600;set src(value){if(value)queueMicrotask(()=>this.onload());}};
    const create=fixture.document.createElement.bind(fixture.document);
    fixture.document.createElement=name=>name==='canvas'?{getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,complete-chart'}:create(name);
}
test('review MCQ reads the chart from the question, excludes header logos and tracks chart changes',()=>{
    const f=setup();
    assert.equal(f.visuals.nodes(f.question).length,1);
    assert.equal(f.visuals.nodes(f.question)[0].id,'chart');
    const before=f.visuals.fingerprint(f.question);
    f.document.querySelector('#chart').setAttribute('src','https://charts.example/other.png');
    assert.notEqual(f.visuals.fingerprint(f.question),before);
});
test('complete illustration is captured without viewport screenshots or page scrolling',async()=>{
    const f=setup();fakeImageDecoder(f);
    const requests=[];
    const result=await f.visuals.capture(f.question,async request=>{requests.push(request);return {dataUrl:'data:image/png;base64,source'};});
    assert.equal(result.images[0],'data:image/jpeg;base64,complete-chart');
    assert.equal(requests.length,1);assert.equal(requests[0].action,'questionImage');
    assert.equal(requests[0].url,'https://charts.example/budget.png');
});
for(const count of [1,3,5])test(`illustration capture preserves all ${count} user-facing images and their order`,async()=>{
    const f=setup();fakeImageDecoder(f);
    for(let i=1;i<count;i++){
        const img=f.document.createElement('img');img.setAttribute('src',`https://charts.example/image-${i}.png`);
        f.question.visualRegion.appendChild(img);
    }
    const urls=[];
    const result=await f.visuals.capture(f.question,async request=>{urls.push(request.url);return {dataUrl:'data:image/png;base64,source'};});
    assert.equal(result.images.length,count);assert.equal(urls.length,count);
    assert.equal(urls[0],'https://charts.example/budget.png');assert.equal(new Set(urls).size,count);
});
test('unreadable charts fail instead of returning an empty image list for a text-only guess',async()=>{
    const f=setup();
    await assert.rejects(f.visuals.capture(f.question,async()=>({error:'Image access failed'})),/Image access failed/);
});
test('old servers that silently ignore question context cannot supply chart answers',async()=>{
    const f=setup();
    await assert.rejects(f.visuals.requireBackend(async()=>({ok:true,data:{status:'ok'}})),/Restart the Browser Assistant server/);
    await f.visuals.requireBackend(async()=>({ok:true,data:{vision_question_context:true}}));
    await assert.rejects(f.visuals.requireBackend(async()=>({ok:true,data:{vision_question_context:true}}),5),/all five images/);
    await f.visuals.requireBackend(async()=>({ok:true,data:{vision_question_context:true,vision_batching:true}}),5);
});
test('a chart replaced while downloading is rejected',async()=>{
    const f=setup();fakeImageDecoder(f);
    await assert.rejects(f.visuals.capture(f.question,async()=>{
        f.document.querySelector('#chart').setAttribute('src','https://charts.example/changed.png');
        return {dataUrl:'data:image/png;base64,source'};
    }),/changed while loading/);
});
test('illustrations in options are included; excessive images are never silently dropped',async()=>{
    const f=setup();
    f.question.options[0].node.appendChild(f.document.createElement('img')).setAttribute('src','https://charts.example/option.png');
    assert.equal(f.visuals.nodes(f.question).length,2);
    for(let i=0;i<4;i++)f.question.visualRegion.appendChild(f.document.createElement('img')).setAttribute('src',`https://charts.example/${i}.png`);
    await assert.rejects(f.visuals.capture(f.question,async()=>{}),/more than five/);
});
test('recognized answer buttons contribute images while unrelated buttons are ignored',()=>{
    const f=setup();
    const button=f.document.createElement('button');
    button.innerHTML='<img id="answer-illustration" src="/answer.png" width="100" height="100">';
    f.question.options[0].node.replaceWith(button);
    f.question.options[0].node=button;
    const toolbarButton=f.document.createElement('button');
    toolbarButton.innerHTML='<img id="toolbar-icon" src="/icon.png" width="100" height="100">';
    f.question.visualRegion.appendChild(toolbarButton);
    assert.deepEqual(Array.from(f.visuals.nodes(f.question),node=>node.id),['chart','answer-illustration']);
});
