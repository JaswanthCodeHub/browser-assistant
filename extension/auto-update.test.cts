const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
for(const scenario of ['idle','busy','incomplete build','no workspace marker']) {
    test(`workspace updater handles ${scenario} without refreshing a page`,async()=>{
        let reloads=0,prepared=0,refreshes=0;
        const context=vm.createContext({importScripts(){},rememberDetachedPanelForUpdate:async()=>{},AbortSignal:{timeout:()=>({})},
            fetch:async url=>{
                assert.match(url,/^chrome-extension:\/\/id\//);
                const marker = url.includes('workspace-release.json');
                return {ok:scenario!=='no workspace marker',json:async()=>({version:marker || scenario!=='incomplete build'?'2.0':'1.0'})};
            },
            chrome:{alarms:{create(){},onAlarm:{addListener(){}}},runtime:{getManifest:()=>({version:'1.0'}),getURL:file=> 'chrome-extension://id/'+file,reload:()=>{reloads++;},onMessage:{addListener(){}},onInstalled:{addListener(){}}},
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
