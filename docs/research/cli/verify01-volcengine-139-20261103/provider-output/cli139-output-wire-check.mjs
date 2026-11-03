import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {chatWithTools} from '../../../../../packages/cli/src/runtime/agent-core.js';
const proof=JSON.parse(fs.readFileSync(new URL('./cli139-output-wire-proof.json',import.meta.url),'utf8'));
for (const file of proof.files) {
 const bytes=fs.readFileSync(new URL('../../../../../packages/cli/'+file.path,import.meta.url));
 assert.equal('sha256:'+createHash('sha256').update(bytes).digest('hex'),file.digest);
}
const original=globalThis.fetch;
const cases=[];
let active;
const model='deepseek-v4-flash-ga-260731';
const usage={prompt_tokens:100,completion_tokens:20000,total_tokens:20100,prompt_tokens_details:{cached_tokens:0},completion_tokens_details:{reasoning_tokens:0}};
globalThis.fetch=async (url,init)=>{
 const body=JSON.parse(init.body);
 assert.equal(String(url),'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
 assert.equal(body.max_tokens,active.expected);
 assert.equal(Object.hasOwn(body,'max_tokens'),active.expected!==undefined);
 cases.push({name:active.name,stream:body.stream===true,maxTokensPresent:Object.hasOwn(body,'max_tokens'),maxTokens:body.max_tokens??null,mockedCompletionTokens:usage.completion_tokens});
 const value=body.stream?`data: ${JSON.stringify({id:'offline',model,choices:[{index:0,delta:{role:'assistant',content:'offline'},finish_reason:'stop'}],usage})}\n\ndata: [DONE]\n\n`:JSON.stringify({id:'offline',model,choices:[{index:0,message:{role:'assistant',content:'offline'},finish_reason:'stop'}],usage});
 return new Response(value,{status:200,headers:{'Content-Type':body.stream?'text/event-stream':'application/json'}});
};
try {
 for(const entry of [{name:'json-default',expected:undefined,stream:false},{name:'sse-default',expected:undefined,stream:true},{name:'json-explicit-model-maximum',expected:393216,stream:false},{name:'sse-explicit-model-maximum',expected:393216,stream:true}]){
  active=entry;
  const result=await chatWithTools([{role:'user',content:'offline wire probe'}],{provider:'volcengine',model,baseUrl:'https://ark.cn-beijing.volces.com/api/v3',apiKey:'offline-no-real-key',contextMemorySkipPlanning:true,enabledToolNames:[],extraToolDefinitions:[],disableTransportRetry:true,...(entry.expected?{maxOutputTokens:entry.expected}:{}),...(entry.stream?{onToken:()=>{}}:{})});
  assert.equal(result.message.content,'offline');
 }
} finally {globalThis.fetch=original;}
const report={...proof,scope:'Published .139 source byte matched; offline real chatWithTools request capture; zero network or paid inference',cases,passed:true};
// Replay emits its outcome without overwriting the original package evidence.
console.log(JSON.stringify({passed:true,cases}));
