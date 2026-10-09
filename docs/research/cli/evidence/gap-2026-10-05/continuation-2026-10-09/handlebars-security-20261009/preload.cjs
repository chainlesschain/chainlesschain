// Test-only exact artifact injection. Leaves repository node_modules untouched.
const Module=require('node:module'),path=require('node:path'),assert=require('node:assert/strict');
const filename=path.join(__dirname,'package','lib','index.js');
const metadata=require(path.join(__dirname,'package','package.json'));
assert.equal(metadata.version,'4.7.10');
const fromPackage=Module.createRequire(filename), semver=require('semver');
const dependencies={};
for(const [name,range] of Object.entries(metadata.dependencies)){
 const dependencyPath=fromPackage.resolve(name+'/package.json'); const version=require(dependencyPath).version;
 assert.ok(semver.satisfies(version,range),name+' '+version+' satisfies '+range);dependencies[name]={version,path:dependencyPath};
}
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return request==='handlebars'?filename:resolve.call(this,request,parent,...rest)};
assert.equal(require('handlebars').VERSION,'4.7.10');
process.stderr.write('[Handlebars validation] '+JSON.stringify({actualVersion:require('handlebars').VERSION,filename,dependencies})+'\n');
