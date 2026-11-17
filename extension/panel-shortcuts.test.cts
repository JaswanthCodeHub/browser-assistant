const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(`${__dirname}/content.js`,'utf8');
function harness(activeElement={}){
    let listener, messageListener;
    const calls={render:0,scan:0};
    const ctx=vm.createContext({automation:{},selectedTab:'auto',isHidden:true,isCollapsed:true,isMinimalMode:false,
        panelToken:'',root:{style:{display:'block'}},window:{},lifecycle:{signal:{}},performance,
        document:{activeElement,addEventListener:(_event,fn)=>{listener=fn;}},
        chrome:{runtime:{id:'test-extension',onMessage:{addListener:fn=>{messageListener=fn;}}}},
        directRun:null,render(){calls.render++;},visionScan(){calls.scan++;},toggleDirectAutomation(){},
        HTMLInputElement:class{},HTMLTextAreaElement:class{},HTMLSelectElement:class{},Element:class{}});
    const start=source.indexOf('    function openPanel(');
    vm.runInContext(source.slice(start,source.indexOf('    // ── Vision scan',start)),ctx);
    const key=(overrides={})=>{
        // Mirror the browser: preventDefault() also sets defaultPrevented.
        const e={key:'',code:'',altKey:false,shiftKey:false,ctrlKey:false,metaKey:false,composedPath:()=>[],
            preventDefault(){this.prevented=true;this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...overrides};
        listener(e);return e;
    };
    const chord=(letter,overrides={})=>key({key:letter,code:`Key${letter}`,ctrlKey:true,shiftKey:true,...overrides});
    const command=(action,sender={id:'test-extension'})=>{
        let response;
        messageListener({action},sender,value=>{response=value;});
        return response;
    };
    return {ctx,key,chord,command,calls};
}
test('each Control chord runs its own action, not a shared fallback',()=>{
    const h=harness();
    assert.equal(h.chord('O').prevented,true);
    assert.equal(h.ctx.isHidden,false);assert.equal(h.ctx.isMinimalMode,false);
    assert.equal(h.chord('M').prevented,true);
    assert.equal(h.ctx.isMinimalMode,true);assert.equal(h.ctx.isHidden,false);
    h.chord('X');assert.equal(h.ctx.isCollapsed,true);assert.equal(h.ctx.root.style.display,'none');
    assert.equal(h.chord('S').prevented,true);assert.equal(h.calls.scan,1);
    assert.equal(h.ctx.isMinimalMode,true);
});
test('Control chords match the physical key when the layout changes the character',()=>{
    const h=harness();
    h.chord('O',{key:'\u000f'});assert.equal(h.ctx.isHidden,false);
    h.chord('S',{key:'\u0013'});assert.equal(h.calls.scan,1);
    assert.equal(h.ctx.isMinimalMode,false);
});
test('Control chords still work while a text field or the editor has focus',()=>{
    const h=harness({isContentEditable:true});
    h.chord('O');assert.equal(h.ctx.isHidden,false);
});
test('Control chords stay inert while the panel is detached to its own window',()=>{
    const h=harness();h.ctx.panelToken='token-1';
    const e=h.chord('O');assert.equal(e.prevented,undefined);assert.equal(h.ctx.isHidden,true);
});
test('the original bare keys keep working and refuse modified presses',()=>{
    const h=harness();
    h.key({key:'`',code:'Backquote'});assert.equal(h.ctx.isHidden,false);
    h.key({key:']',code:'BracketRight'});assert.equal(h.ctx.isCollapsed,true);
    h.key({key:'\\',code:'Backslash'});assert.equal(h.calls.scan,1);
    h.key({key:'[',code:'BracketLeft'});assert.equal(h.ctx.isMinimalMode,true);
    for(const overrides of [{ctrlKey:true},{metaKey:true},{altKey:true}]){
        h.key({key:'`',code:'Backquote',...overrides});
        h.key({key:'\\',code:'Backslash',...overrides});
        h.key({key:']',code:'BracketRight',...overrides});
    }
    assert.equal(h.calls.scan,1);assert.equal(h.ctx.isHidden,false);
});
test('Command, Alt and incomplete chords never trigger a panel action',()=>{
    const h=harness();
    for(const overrides of [{metaKey:true},{ctrlKey:false},{shiftKey:false},{altKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true}]){
        for(const letter of ['O','X','S','M']){
            assert.equal(h.chord(letter,overrides).prevented,undefined);
        }
    }
    assert.equal(h.calls.scan,0);assert.equal(h.calls.render,0);
    assert.equal(h.ctx.isHidden,true);assert.equal(h.ctx.isCollapsed,true);assert.equal(h.ctx.isMinimalMode,false);
});
test('bare keys are ignored while typing',()=>{
    const h=harness({role:'textbox',getAttribute:()=>'textbox'});
    h.key({key:'`',code:'Backquote'});
    h.key({key:'[',code:'BracketLeft'});
    assert.equal(h.ctx.isHidden,true);assert.equal(h.ctx.isMinimalMode,false);
});
test('browser-level commands drive the same actions from the background',()=>{
    const h=harness();
    assert.equal(h.command('panel:open').ok,true);
    assert.equal(h.ctx.isHidden,false);
    h.command('panel:minimal');assert.equal(h.ctx.isMinimalMode,true);
    h.command('panel:minimal');assert.equal(h.ctx.isMinimalMode,false);
    h.command('panel:vision');assert.equal(h.calls.scan,1);
    h.command('panel:close');assert.equal(h.ctx.isCollapsed,true);
    assert.equal(h.command('panel:nonsense'),undefined);
});
test('a browser command that echoes a just-handled key is not applied twice',()=>{
    const h=harness();
    h.chord('M');
    assert.equal(h.ctx.isMinimalMode,true);
    assert.equal(h.command('panel:minimal').ok,true);
    assert.equal(h.ctx.isMinimalMode,true,'the echoed command must not toggle again');
    h.command('panel:minimal');
    assert.equal(h.ctx.isMinimalMode,false,'a real second command still toggles');
});
test('panel messages from other extensions are ignored',()=>{
    const h=harness();
    assert.equal(h.command('panel:open',{id:'other-extension'}),undefined);
    assert.equal(h.ctx.isHidden,true);
});
