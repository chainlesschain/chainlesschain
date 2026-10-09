const phase=process.env.SDK_DIAGNOSTIC_PHASE;
process.stdin.once('data',()=>{process.exitCode=1;process.stdin.destroy();});
process.stdout.write(JSON.stringify({type:'diagnostic_fixture',phase,detail:phase+' event'})+'\n');
process.stderr.write(phase+' diagnostic stderr\n');
