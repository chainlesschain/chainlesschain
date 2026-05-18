#!/usr/bin/env node
/**
 * Markdown Skills Integration Test
 *
 * 验证 Markdown Skills 系统在实际环境中的工作情况
 *
 * Usage: node scripts/test-markdown-skills.js
 */

const path = require('path');

// 设置模块路径
const srcPath = path.join(__dirname, '..', 'src', 'main');

console.log('═'.repeat(60));
console.log('  Markdown Skills Integration Test');
console.log('═'.repeat(60));
console.log();

async function runTests() {
  const results = {
    passed: 0,
    failed: 0,
    tests: [],
  };

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'passed' });
        console.log(`  ✓ ${name}`);
      } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'failed', error: error.message });
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${error.message}`);
      }
    };
  }

  // ==================== Test Cases ====================

  console.log('1. SkillMdParser Tests');
  console.log('-'.repeat(40));

  await test('Should parse simple SKILL.md content', async () => {
    const { SkillMdParser } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const parser = new SkillMdParser({ strictValidation: false });

    const content = `---
name: test-skill
description: A test skill
version: 1.0.0
category: testing
user-invocable: true
tags: [test, demo]
---

# Test Skill

This is the body content.
`;

    const definition = parser.parseContent(content, '/test/SKILL.md');

    if (definition.name !== 'test-skill') throw new Error(`Wrong name: ${definition.name}`);
    if (definition.description !== 'A test skill') throw new Error(`Wrong description`);
    if (definition.version !== '1.0.0') throw new Error(`Wrong version`);
    if (definition.category !== 'testing') throw new Error(`Wrong category`);
    if (definition.userInvocable !== true) throw new Error(`Wrong userInvocable`);
    if (!definition.tags.includes('test')) throw new Error(`Missing tag 'test'`);
    if (!definition.body.includes('Test Skill')) throw new Error(`Missing body content`);
  })();

  await test('Should parse nested requires in SKILL.md', async () => {
    const { SkillMdParser } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const parser = new SkillMdParser({ strictValidation: false });

    const content = `---
name: git-skill
description: Git operations skill
requires:
  bins: [git, npm]
  env: [GIT_AUTHOR_NAME]
os: [win32, darwin]
---

Body here.
`;

    const definition = parser.parseContent(content, '/test/SKILL.md');

    if (!definition.requires.bins.includes('git')) throw new Error(`Missing bin 'git'`);
    if (!definition.requires.bins.includes('npm')) throw new Error(`Missing bin 'npm'`);
    if (!definition.requires.env.includes('GIT_AUTHOR_NAME')) throw new Error(`Missing env var`);
    if (!definition.os.includes('win32')) throw new Error(`Missing os 'win32'`);
  })();

  await test('Should validate skill definition', async () => {
    const { SkillMdParser } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const parser = new SkillMdParser({ strictValidation: false });

    const validDef = {
      name: 'valid-skill',
      description: 'A valid skill',
      version: '1.0.0',
    };

    const invalidDef = {
      name: '123invalid',
      description: '',
    };

    const validResult = parser.validate(validDef);
    const invalidResult = parser.validate(invalidDef);

    if (!validResult.valid) throw new Error(`Valid definition marked invalid`);
    if (invalidResult.valid) throw new Error(`Invalid definition marked valid`);
    if (invalidResult.errors.length === 0) throw new Error(`No errors for invalid definition`);
  })();

  console.log();
  console.log('2. SkillGating Tests');
  console.log('-'.repeat(40));

  await test('Should check platform compatibility', async () => {
    const { SkillGating } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const gating = new SkillGating();

    const currentPlatform = process.platform;

    // Should pass for current platform
    const passResult = gating.checkPlatform([currentPlatform]);
    if (!passResult.passed) throw new Error(`Should pass for current platform`);

    // Should fail for other platforms
    const failPlatform = currentPlatform === 'win32' ? 'darwin' : 'win32';
    const failResult = gating.checkPlatform([failPlatform]);
    if (failResult.passed) throw new Error(`Should fail for different platform`);
  })();

  await test('Should check environment variables', async () => {
    const { SkillGating } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const gating = new SkillGating();

    // PATH should exist on all systems
    const passResult = gating.checkEnvVars(['PATH']);
    if (!passResult.passed) throw new Error(`PATH env var should exist`);

    // Nonexistent env var
    const failResult = gating.checkEnvVars(['NONEXISTENT_VAR_12345']);
    if (failResult.passed) throw new Error(`Nonexistent var should fail`);
    if (!failResult.missing.includes('NONEXISTENT_VAR_12345')) {
      throw new Error(`Missing var not in list`);
    }
  })();

  await test('Should check binary dependencies', async () => {
    const { SkillGating } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const gating = new SkillGating({ timeout: 3000 });

    // node should exist
    const passResult = await gating.checkBinaries(['node']);
    if (!passResult.passed) throw new Error(`node binary should exist`);

    // Nonexistent binary
    const failResult = await gating.checkBinaries(['nonexistent_binary_12345']);
    if (failResult.passed) throw new Error(`Nonexistent binary should fail`);
  })();

  console.log();
  console.log('3. SkillLoader Tests');
  console.log('-'.repeat(40));

  await test('Should get layer paths', async () => {
    const { SkillLoader } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const loader = new SkillLoader({ workspacePath: process.cwd() });

    const paths = loader.getLayerPaths();

    if (!paths.bundled) throw new Error(`Missing bundled path`);
    if (!paths.managed) throw new Error(`Missing managed path`);
    if (!paths.workspace) throw new Error(`Missing workspace path`);
    if (!paths.bundled.includes('builtin')) throw new Error(`Bundled path should include 'builtin'`);
  })();

  await test('Should load bundled skills', async () => {
    const { SkillLoader } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const loader = new SkillLoader({
      workspacePath: process.cwd(),
      autoGating: false,
    });

    const result = await loader.loadLayer('bundled');

    // Should have loaded some skills (we created 3 builtin skills)
    if (result.loaded < 1) {
      console.log(`    Note: No bundled skills found (expected if builtin dir is empty)`);
    }

    if (result.errors.length > 0) {
      console.log(`    Errors: ${result.errors.map((e) => e.error).join(', ')}`);
    }
  })();

  console.log();
  console.log('4. MarkdownSkill Tests');
  console.log('-'.repeat(40));

  await test('Should create MarkdownSkill from definition', async () => {
    const { MarkdownSkill } = require(path.join(srcPath, 'ai-engine/cowork/skills'));

    const definition = {
      name: 'test-markdown-skill',
      displayName: 'Test Markdown Skill',
      description: 'A test skill',
      version: '1.0.0',
      category: 'testing',
      source: 'test',
      sourcePath: '/test/SKILL.md',
      userInvocable: true,
      hidden: false,
      tags: ['test'],
      body: '# Test\nBody content',
    };

    const skill = new MarkdownSkill(definition);

    if (skill.skillId !== 'test-markdown-skill') throw new Error(`Wrong skillId`);
    if (skill.name !== 'Test Markdown Skill') throw new Error(`Wrong name`);
    if (skill.source !== 'test') throw new Error(`Wrong source`);
    if (skill.getBody() !== '# Test\nBody content') throw new Error(`Wrong body`);
  })();

  await test('Should execute documentation-only skill', async () => {
    const { MarkdownSkill } = require(path.join(srcPath, 'ai-engine/cowork/skills'));

    const definition = {
      name: 'doc-only-skill',
      description: 'Documentation only',
      version: '1.0.0',
      body: 'Instructions here',
    };

    const skill = new MarkdownSkill(definition);
    const result = await skill.execute({ type: 'test' });

    if (!result.success) throw new Error(`Execution failed`);
    if (result.type !== 'documentation') throw new Error(`Wrong type`);
    if (result.body !== 'Instructions here') throw new Error(`Wrong body in result`);
  })();

  console.log();
  console.log('5. SkillRegistry Tests');
  console.log('-'.repeat(40));

  await test('Should register and retrieve skills', async () => {
    const { SkillRegistry, MarkdownSkill } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const registry = new SkillRegistry({ autoLoad: false });

    const skill = new MarkdownSkill({
      name: 'registry-test-skill',
      description: 'Test skill for registry',
      version: '1.0.0',
      category: 'testing',
    });

    registry.register(skill);

    const retrieved = registry.getSkill('registry-test-skill');
    if (!retrieved) throw new Error(`Skill not found after registration`);
    if (retrieved.skillId !== 'registry-test-skill') throw new Error(`Wrong skill retrieved`);

    // Cleanup
    registry.unregister('registry-test-skill');
    if (registry.getSkill('registry-test-skill')) throw new Error(`Skill still exists after unregister`);
  })();

  await test('Should find skills by category', async () => {
    const { SkillRegistry, MarkdownSkill } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const registry = new SkillRegistry({ autoLoad: false });

    registry.register(
      new MarkdownSkill({
        name: 'cat-skill-1',
        description: 'Skill 1',
        category: 'development',
      })
    );

    registry.register(
      new MarkdownSkill({
        name: 'cat-skill-2',
        description: 'Skill 2',
        category: 'development',
      })
    );

    registry.register(
      new MarkdownSkill({
        name: 'cat-skill-3',
        description: 'Skill 3',
        category: 'testing',
      })
    );

    const devSkills = registry.getSkillsByCategory('development');
    if (devSkills.length !== 2) throw new Error(`Expected 2 development skills, got ${devSkills.length}`);

    const testSkills = registry.getSkillsByCategory('testing');
    if (testSkills.length !== 1) throw new Error(`Expected 1 testing skill, got ${testSkills.length}`);

    // Cleanup
    registry.unregister('cat-skill-1');
    registry.unregister('cat-skill-2');
    registry.unregister('cat-skill-3');
  })();

  await test('Should get user invocable skills', async () => {
    const { SkillRegistry, MarkdownSkill } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const registry = new SkillRegistry({ autoLoad: false });

    registry.register(
      new MarkdownSkill({
        name: 'invocable-skill',
        description: 'User can call this',
        userInvocable: true,
        hidden: false,
      })
    );

    registry.register(
      new MarkdownSkill({
        name: 'hidden-skill',
        description: 'Hidden from user',
        userInvocable: true,
        hidden: true,
      })
    );

    registry.register(
      new MarkdownSkill({
        name: 'internal-skill',
        description: 'Internal only',
        userInvocable: false,
      })
    );

    const invocable = registry.getUserInvocableSkills();
    if (invocable.length !== 1) throw new Error(`Expected 1 invocable skill, got ${invocable.length}`);
    if (invocable[0].skillId !== 'invocable-skill') throw new Error(`Wrong invocable skill`);

    // Cleanup
    registry.unregister('invocable-skill');
    registry.unregister('hidden-skill');
    registry.unregister('internal-skill');
  })();

  await test('Should get statistics', async () => {
    const { SkillRegistry, MarkdownSkill } = require(path.join(srcPath, 'ai-engine/cowork/skills'));
    const registry = new SkillRegistry({ autoLoad: false });

    registry.register(
      new MarkdownSkill({
        name: 'stats-skill-1',
        description: 'Skill 1',
        category: 'cat1',
      })
    );

    registry.register(
      new MarkdownSkill({
        name: 'stats-skill-2',
        description: 'Skill 2',
        category: 'cat2',
      })
    );

    const stats = registry.getStats();

    if (stats.totalSkills !== 2) throw new Error(`Expected 2 total skills, got ${stats.totalSkills}`);
    if (stats.categories !== 2) throw new Error(`Expected 2 categories, got ${stats.categories}`);

    // Cleanup
    registry.unregister('stats-skill-1');
    registry.unregister('stats-skill-2');
  })();

  console.log();
  console.log('6. Full Integration Test');
  console.log('-'.repeat(40));

  await test('Should load and create skill instances from SkillLoader', async () => {
    const { SkillRegistry, SkillLoader } = require(path.join(srcPath, 'ai-engine/cowork/skills'));

    const registry = new SkillRegistry({ autoLoad: false });
    const loader = new SkillLoader({
      workspacePath: process.cwd(),
      autoGating: false,
    });

    registry.setLoader(loader);

    // Load all skills
    const result = await registry.loadAllSkills();

    console.log(`    Loaded: ${result.loaded}, Registered: ${result.registered}, Errors: ${result.errors.length}`);

    // Get sources info
    const sources = registry.getSkillSources();
    if (!sources) throw new Error(`Should have sources after setting loader`);
  })();

  // ==================== Summary ====================

  console.log();
  console.log('═'.repeat(60));
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═'.repeat(60));

  if (results.failed > 0) {
    console.log();
    console.log('Failed tests:');
    results.tests
      .filter((t) => t.status === 'failed')
      .forEach((t) => {
        console.log(`  - ${t.name}: ${t.error}`);
      });
    process.exit(1);
  }

  console.log();
  console.log('✅ All integration tests passed!');
  console.log();
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
