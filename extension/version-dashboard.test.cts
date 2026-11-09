const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
test('panel build comes from the installed manifest, never a stale release literal',()=>{
    const declaration=source.match(/    const extensionVersion = [^;]+;/)[0];
    const ctx=vm.createContext({chrome:{runtime:{getManifest:()=>({version:'9.8.7'})}}});
    assert.equal(vm.runInContext(`${declaration}\nextensionVersion`,ctx),'9.8.7');
    assert.ok(source.includes('`Build ${extensionVersion}'));
    assert.doesNotMatch(source,/Build \d+\.\d+\.\d+/);
});
test('Home feedback is not detected or sent to the AI even when it has radio controls',()=>{
    const ctx=vm.createContext({window:{location:{origin:'https://learning.ccbp.in',pathname:'/'}},
        getAutomationContext:()=>({}),getAutomationAdapter:()=>{throw Error('Must not detect mentor feedback');}});
    const fn=source.slice(source.indexOf('    function getAuthorizedQuestion('),source.indexOf('    const AUTO_RESUME_KEY'));
    vm.runInContext(fn,ctx);
    assert.equal(ctx.getAuthorizedQuestion(),null);
});
test('starting on Home returns an instruction without selecting or submitting feedback',async()=>{
    let updates=0;
    const ctx=vm.createContext({window:{location:{origin:'https://learning.ccbp.in',pathname:'/'}},
        automation:{running:false},updateAutomationUI:()=>updates++});
    const fn=source.slice(source.indexOf('    async function startPracticeAutomation('),source.indexOf('    function safeSendMessage('));
    vm.runInContext(fn,ctx);
    await ctx.startPracticeAutomation();
    assert.equal(ctx.automation.state,'OPEN_PRACTICE');
    assert.match(ctx.automation.error,/Mentor feedback/);
    assert.equal(ctx.automation.running,false);assert.equal(updates,1);
});
