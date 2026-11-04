const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup() {
    const ctx=vm.createContext({window:{}});
    vm.runInContext(fs.readFileSync(`${__dirname}/answer-requests.js`,'utf8'),ctx);
    return ctx.window.BrowserAssistantAnswerRequests;
}
const success={ok:true,data:{results:'[{"answer":"Option A: 8%"}]'}};
function options(request, overrides={}) {
    return {request,active:()=>true,current:()=>true,ready:async()=>true,onRetry(){},sleep:async()=>{},...overrides};
}
test('temporary chart service failure recovers on the same question without submitting anything',async()=>{
    let calls=0,waited=0;const retries=[];
    const result=await setup().run(options(async()=>++calls===1?{ok:false,status:503,data:{detail:'Service temporarily unavailable'}}:success,
        {onRetry:event=>retries.push(event),sleep:async ms=>{waited+=ms;}}));
    assert.equal(result,success);assert.equal(calls,2);assert.equal(waited,1000);
    assert.equal(retries[0].attempt,2);
});
test('429 and network disconnect recover within three attempts',async()=>{
    let calls=0;const request=async()=>{
        calls++;if(calls===1)throw Error('Local server is offline');
        return calls===2?{ok:false,status:429,data:{detail:'Rate limit'}}:success;
    };
    assert.equal(await setup().run(options(request)),success);assert.equal(calls,3);
});
test('vision rate limiting waits for the server cooldown before retrying',async()=>{
    let calls=0,waited=0;
    const limited={ok:false,status:429,data:{detail:{message:'Vision is temporarily rate-limited',retry_after_seconds:4}}};
    const result=await setup().run(options(async()=>{
        if (++calls===1) return limited;
        assert.equal(waited,4000);
        return success;
    },{sleep:async ms=>{waited+=ms;}}));
    assert.equal(result,success);
    assert.equal(calls,2);
});
test('a long rate limit reports the wait without restarting the request',async()=>{
    let calls=0;
    await assert.rejects(setup().run(options(async()=>{
        calls++;
        return {ok:false,status:429,data:{detail:{message:'Try again in 120 seconds.',retry_after_seconds:120}}};
    })),/Try again in 120 seconds/);
    assert.equal(calls,1);
});
test('persistent service failure is bounded and reports the real provider error',async()=>{
    let calls=0;
    await assert.rejects(setup().run(options(async()=>{calls++;return {ok:false,status:502,data:{detail:{message:'All vision providers failed',errors:['Vision provider connection timed out']}}};})),
        /HTTP 502: All vision providers failed: Vision provider connection timed out/);
    assert.equal(calls,3);
});
for(const status of [400,401,403,404,422])test(`HTTP ${status} is not repeatedly sent`,async()=>{
    let calls=0;
    await assert.rejects(setup().run(options(async()=>{calls++;return {ok:false,status,data:{detail:'Request rejected'}};})),new RegExp(`HTTP ${status}`));
    assert.equal(calls,1);
});
test('nested provider access denial is not retried just because the API wraps it in 500',async()=>{
    let calls=0;
    await assert.rejects(setup().run(options(async()=>{calls++;return {ok:false,status:500,data:{detail:{message:'All providers failed',errors:['403 Access denied']}}};})),/Access denied/);
    assert.equal(calls,1);
});
test('Stop during retry waiting cancels before another request',async()=>{
    let calls=0,active=true;
    const result=await setup().run(options(async()=>{calls++;throw Error('Network timeout');},
        {active:()=>active,sleep:async()=>{active=false;}}));
    assert.equal(result,null);assert.equal(calls,1);
});
test('a changed chart or question during backoff prevents retrying the stale payload',async()=>{
    let calls=0,current=true;
    await assert.rejects(setup().run(options(async()=>{calls++;throw Error('Network timeout');},
        {current:()=>current,sleep:async()=>{current=false;}})),/Question changed/);
    assert.equal(calls,1);
});
test('a changed question during an otherwise successful request cannot receive its answer',async()=>{
    let current=true;
    await assert.rejects(setup().run(options(async()=>{current=false;return success;},{current:()=>current})),/Question changed/);
});
test('a completed old run cannot override a newer run after Stop or Start',async()=>{
    let active=true;
    const result=await setup().run(options(async()=>{active=false;return success;},{active:()=>active}));
    assert.equal(result,null);
});
test('Pause blocks the next request until the run is resumed',async()=>{
    let resume,calls=0;
    const paused=new Promise(resolve=>{resume=resolve;});
    const running=setup().run(options(async()=>{calls++;return success;},{ready:async()=>paused}));
    await Promise.resolve();assert.equal(calls,0);
    resume(true);assert.equal(await running,success);assert.equal(calls,1);
});
test('error formatting retains validation details and redacts credentials',()=>{
    const helper=setup();
    assert.match(helper.failure({status:422,data:{detail:[{msg:'Question too large'}]}}).message,/Question too large/);
    assert.doesNotMatch(helper.failure({data:{detail:'API key gsk_exampleSecret'}}).message,/gsk_exampleSecret/);
});
