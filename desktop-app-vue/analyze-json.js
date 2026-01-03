const fs = require('fs');

// Run vitest and capture JSON output
const { execSync } = require('child_process');

try {
  const output = execSync('npm run test -- --reporter=json --reporter=verbose 2>&1', {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120000
  }).toString();
  
  // Find JSON output (it's usually at the end)
  const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
  if (jsonMatch) {
    const results = JSON.parse(jsonMatch[0]);
    
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Total test files: ${results.numTotalTestSuites}`);
    console.log(`Passed test files: ${results.numPassedTestSuites}`);
    console.log(`Failed test files: ${results.numFailedTestSuites}`);
    console.log(`Total tests: ${results.numTotalTests}`);
    console.log(`Passed tests: ${results.numPassedTests}`);
    console.log(`Failed tests: ${results.numFailedTests}`);
    
    if (results.testResults) {
      const failedFiles = results.testResults.filter(f => f.status === 'failed');
      if (failedFiles.length > 0) {
        console.log('\n=== FAILED TEST FILES ===');
        failedFiles.forEach(f => {
          console.log(`${f.name}: ${f.assertionResults.filter(a => a.status === 'failed').length} failures`);
        });
      }
    }
  } else {
    console.log('Could not find JSON results in output');
  }
} catch (err) {
  console.error('Error running tests:', err.message);
  process.exit(1);
}
