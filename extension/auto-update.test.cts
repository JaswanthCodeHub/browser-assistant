const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
for(const scenario of ['idle','busy','old extraction','offline']) {
    test(`workspace updater handles ${scenario} without refreshing a page`,async()=>{
        let reloads=0,prepared=0,refreshes=0;
        const context=vm.createContext({importScripts(){},AbortSignal:{timeout:()=>({})},
            fetch:async url=>{if(scenario==='offline')throw Error('offline');return {ok:true,json:async()=>({version:url.includes('extension-release')?'2.0':scenario==='old extraction'?'1.0':'2.0'})};},
            chrome:{alarms:{create(){},onAlarm:{addListener(){}}},runtime:{getManifest:()=>({version:'1.0'}),getURL:()=> 'chrome-extension://id/manifest.json',reload:()=>{reloads++;},onMessage:{addListener(){}},onInstalled:{addListener(){}}},
                tabs:{query:async()=>[{id:1,url:'https://example.test'}],reload:()=>{refreshes++;},sendMessage:async(_id,request)=>{
                    if(request.action==='assistantUpdateStatus')return {busy:scenario==='busy'};
                    prepared++;return {ready:true};
                }}}});
        vm.runInContext(fs.readFileSync(`${__dirname}/background.js`,'utf8'),context);
        await context.checkWorkspaceUpdate();
        assert.equal(reloads,scenario==='idle'?1:0);
        assert.equal(prepared,scenario==='idle'?1:0);
        assert.equal(refreshes,0);
    });
}
