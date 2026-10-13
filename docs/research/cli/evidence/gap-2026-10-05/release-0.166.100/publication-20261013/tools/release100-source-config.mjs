import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
export const toolingDirectory=fileURLToPath(new URL('.',import.meta.url));
export const originalBindingPath=fileURLToPath(new URL('./release100-final-source-binding.json',import.meta.url));
export const historicalBranch='feature/cli-ide-gap-retry-completion-20261012-main';
export const isolatedReleaseBranch='feature/cli-ide-release100-final-20261013';
export function verifySourceBranch(branch) {
 assert([historicalBranch,isolatedReleaseBranch].includes(branch),'Unrecognized release source branch');
 return branch;
}
export function configuredSourceBranch() {
 const binding=JSON.parse(fs.readFileSync(process.env.CC_RELEASE100_SOURCE_BINDING||originalBindingPath,'utf8'));
 if(binding.schema==='chainlesschain.release-source-binding/v2') return verifySourceBranch(binding.sourceBranch);
 assert.equal(binding.sourceCommit,'ff292775c4a032541fb50147d49dd353967be3b4','Unknown legacy branch binding');
 return historicalBranch;
}
