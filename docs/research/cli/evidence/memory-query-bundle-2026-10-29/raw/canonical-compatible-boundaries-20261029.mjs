import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createCompatiblePrototype } from "./canonical-compatible-prototype-20261029.mjs";
const require=createRequire(import.meta.url);
const oracle=require("./canonical-allocation-PMXXwt/oracle/canonical.js");
const {invalidArgument}=require("./canonical-allocation-PMXXwt/oracle/errors.js");
const candidate=createCompatiblePrototype(oracle,invalidArgument);
const {canonicalize,canonicalJson,canonicalDigest,cloneCanonical}=candidate;

function compareFactory(factory) {
  const oldTrace=[],newTrace=[];
  const expected=JSON.stringify(canonicalize(factory(oldTrace)));
  const actual=canonicalJson(factory(newTrace));
  assert.equal(actual,expected);
  assert.deepEqual(newTrace,oldTrace);
  return actual;
}
function withProperty(target,key,descriptor,operation) {
  const previous=Object.getOwnPropertyDescriptor(target,key);
  Object.defineProperty(target,key,{configurable:true,...descriptor});
  try { operation(); } finally {
    if(previous) Object.defineProperty(target,key,previous);
    else delete target[key];
  }
}

test("preserves getter filtering, sorted second reads, nested traversal, and skipped undefined",()=>{
  const make=trace=>{
    const value={};
    for(const key of ["b","a","2","omit"]) {
      let reads=0;
      Object.defineProperty(value,key,{enumerable:true,get(){trace.push(`${key}:${++reads}`);return key==="omit"?undefined:key==="a"&&reads===2?Object.defineProperty({},"nested",{enumerable:true,get(){trace.push("nested");return true;}}):reads;}});
    }
    return value;
  };
  assert.equal(compareFactory(make),'{"2":2,"a":{"nested":true},"b":2}');
  const trace=[];canonicalJson(make(trace));
  assert.deepEqual(trace,["2:1","b:1","a:1","omit:1","2:2","a:2","nested","nested","b:2"]);
});

test("uses native integer-key ordering and stable equivalent Unicode ordering",()=>{
  const keys=["10","2","0","4294967294","4294967295","4294967296","-0","01","1e0","é","e\u0301","É","E\u0301"];
  assert.equal("é".localeCompare("e\u0301","en"),0);
  for(const order of [keys,[...keys].reverse()]) compareFactory(()=>Object.fromEntries(order.map((key,i)=>[key,i])));
  const forward=canonicalJson({"é":1,"e\u0301":2});
  const reverse=canonicalJson({"e\u0301":2,"é":1});
  assert.notEqual(forward,reverse);
});

test("preserves holes, map overrides, native species, and inherited array indices",()=>{
  compareFactory(()=>{const array=new Array(4);array[2]=-0;return array;});
  compareFactory(trace=>{
    const array=[{x:1}];
    array.map=function(callback){trace.push("override");return [callback(this[0],0),"custom-map"]};
    return array;
  });
  compareFactory(trace=>{
    class Output extends Array {toJSON(){trace.push("species-toJSON");return {kind:"species",values:Array.from(this)};}}
    class Input extends Array {static get [Symbol.species](){trace.push("species");return Output;}}
    const array=new Input(2);array[1]={x:1};return array;
  });
  compareFactory(trace=>{
    class Input extends Array {}
    Object.defineProperty(Input.prototype,"1",{configurable:true,get(){trace.push("inherited-index");return "inherited";},set(){throw new Error("must define own output index");}});
    const array=new Input(3);array[0]="first";return array;
  });
  compareFactory(trace=>{
    const array=[1,2,3];
    Object.defineProperty(array,"0",{get(){trace.push("shrink");array.length=1;return 1;}});
    return array;
  });
});

test("matches inherited toJSON for normal and null-prototype inputs",()=>{
  withProperty(Object.prototype,"toJSON",{value:function(){return Object.hasOwn(this,"marker")?`hook:${this.marker}`:this;}},()=>{
    compareFactory(()=>({nested:{marker:"normal"}}));
    compareFactory(()=>Object.assign(Object.create(null),{marker:"null-proto"}));
    compareFactory(()=>({toJSON:null,nested:{marker:"child"}}));
    compareFactory(()=>({toJSON:undefined,marker:"omitted"}));
  });
  withProperty(Array.prototype,"toJSON",{value:function(){return {arrayLength:this.length,first:this[0]};}},()=>{
    compareFactory(()=>[1,{nested:2}]);
  });
});

test("defines __proto__ and inherited-setter keys as own ordinary data properties",()=>{
  withProperty(Object.prototype,"setterKey",{set(){throw new Error("inherited setter must not run");}},()=>{
    compareFactory(()=>JSON.parse('{"__proto__":{"safe":true},"setterKey":1,"constructor":2,"prototype":3}'));
  });
  const input=Object.assign(Object.create(null),JSON.parse('{"__proto__":3,"toJSON":null}'));
  const result=cloneCanonical(input);
  assert.equal(Object.getPrototypeOf(result),Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(result,"__proto__").value,3);
  assert.equal(Object.getPrototypeOf(canonicalize(input)),Object.prototype);
});

test("retains JSON primitive encoding and complete type rejection",()=>{
  for(const value of [null,true,false,-0,1e-7,1e21,Number.MIN_VALUE,Number.MAX_VALUE,"\ud800","\udfff","\ud800\udfff","\u0000\n\"\\"]){
    assert.equal(canonicalJson(value),JSON.stringify(canonicalize(value)));
    assert.equal(canonicalDigest(value),oracle.canonicalDigest(value));
    assert.deepEqual(cloneCanonical(value),oracle.cloneCanonical(value));
  }
  for(const value of [undefined,NaN,Infinity,-Infinity,1n,Symbol("x"),()=>{},new Date(),new Map(),new Number(1),Object.create({x:1}),[undefined],[,undefined],{nested:NaN},{nested:[Infinity]},{toJSON(){return 1;}}]) {
    let expected;
    try{canonicalize(value);}catch(error){expected=error;}
    assert.ok(expected);
    for(const operation of [canonicalJson,canonicalDigest,...(value===undefined?[]:[cloneCanonical])]) {
      assert.throws(()=>operation(value),error=>error.code===expected.code&&error.message===expected.message&&JSON.stringify(error.details)===JSON.stringify(expected.details));
    }
  }
  assert.equal(cloneCanonical(undefined),undefined);
});
