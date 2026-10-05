const fs=require('node:fs');
const identity=process.argv[2],args=process.argv.slice(3);
const mode=identity==='managed'?'valid':fs.readFileSync("C:\\Users\\longfa\\AppData\\Local\\Temp\\cc-onboard-N642Dt\\capture\\version-mode.txt",'utf8');
fs.appendFileSync("C:\\Users\\longfa\\AppData\\Local\\Temp\\cc-onboard-N642Dt\\identity-trace.jsonl",JSON.stringify({at:new Date().toISOString(),pid:process.pid,identity,args,mode})+'\n');
if(args.includes('--version'))console.log(mode==='gcc'?'cc (GCC) 12.2.0':'0.166.89');
else if(args[0]==='agent'){console.error('Agent invocation forbidden in identity diagnostic');process.exitCode=98;}
else if(args[0]==='config'&&args[1]==='get')console.log('');
else console.log('{}');
