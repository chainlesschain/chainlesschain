import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const repo=process.cwd(), output=path.resolve('.work/public-jetbrains-current-driver-v2');
const javaHome=path.resolve('.work/jdk21-release-validation/jdk-21.0.12.1+1');
const robot=path.resolve('packages/jetbrains-plugin/build/idea-sandbox/verify01-jetbrains-gui-3yPXRt/IC-2024.2/plugins_runIdeForUiTests/robot-server-plugin');
const jars=[
'org.junit.jupiter/junit-jupiter-api/5.10.2/fb55d6e2bce173f35fd28422e7975539621055ef/junit-jupiter-api-5.10.2.jar',
'org.junit.platform/junit-platform-commons/1.10.2/3197154a1f0c88da46c47a9ca27611ac7ec5d797/junit-platform-commons-1.10.2.jar',
'org.opentest4j/opentest4j/1.3.0/152ea56b3a72f655d4fd677fc0ef2596c3dd5e6e/opentest4j-1.3.0.jar',
'org.apiguardian/apiguardian-api/1.1.2/a231e0d844d2721b0fa1b238006d15c6ded6842a/apiguardian-api-1.1.2.jar'
].map(p=>path.join('C:/Users/longfa/.gradle/caches/modules-2/files-2.1',p));
const hash=p=>'sha256:'+createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inventory=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?inventory(path.join(dir,e.name)):[path.join(dir,e.name)]);
fs.mkdirSync(output);fs.mkdirSync(path.join(output,'classes'));
const main=path.join(output,'PublicJetBrainsDriver.java');
fs.writeFileSync(main,'package com.chainlesschain.ide.uitest;\npublic final class PublicJetBrainsDriver { public static void main(String[] args) throws Exception { new IdeUiSmokeTest().chainlessChainChatAndControlJourney(); } }\n',{flag:'wx'});
const sourceDir=path.resolve('packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest');
const sources=[...inventory(sourceDir).filter(p=>p.endsWith('.java')),main];
const deps=[...inventory(path.join(robot,'lib')).filter(p=>p.endsWith('.jar')),...jars];
const classpath=[path.join(robot,'lib','*'),...jars].join(path.delimiter);
const args=['-encoding','UTF-8','-cp',classpath,'-d',path.join(output,'classes'),...sources];
const javac=path.join(javaHome,'bin/javac.exe'), java=path.join(javaHome,'bin/java.exe');
const version=spawnSync(javac,['-version'],{windowsHide:true,encoding:'utf8'});
const result=spawnSync(javac,args,{windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
fs.writeFileSync(path.join(output,'compile.log'),(result.stdout||'')+(result.stderr||''),{flag:'wx'});
const manifest={schema:'chainlesschain.current-ui-driver-compile/v1',createdAt:new Date().toISOString(),repo,output,javaHome,java,robot,classpath,compiler:{path:javac,sha256:hash(javac),version:(version.stdout+version.stderr).trim()},arguments:args,result:{status:result.status,signal:result.signal,error:result.error?.message||null,exceptionOutput:/Exception|compiler bug|编译器.*异常/i.test((result.stdout||'')+(result.stderr||''))},sources:sources.map(p=>({path:p,sha256:hash(p)})),dependencies:deps.map(p=>({path:p,sha256:hash(p)})),classes:inventory(path.join(output,'classes')).map(p=>({path:p,sha256:hash(p)})),gradleInvoked:false,pluginRebuilt:false,guiStarted:false,modelInputCount:0};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({manifest:path.join(output,'manifest.json'),result:manifest.result,classes:manifest.classes.length,sourceCount:sources.length,compileLog:path.join(output,'compile.log')}));
if(result.status!==0||manifest.result.exceptionOutput)process.exitCode=1;
