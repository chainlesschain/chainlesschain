# Contributing to ChainlessChain

We love your input! We want to make contributing to ChainlessChain as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## 🌟 We Use [GitHub Flow](https://guides.github.com/introduction/flow/)

Pull requests are the best way to propose changes to the codebase:

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## 📝 Development Process

### Setting Up Development Environment

```bash
# Clone your fork
git clone https://github.com/your-username/chainlesschain.git
cd chainlesschain

# Add upstream remote
git remote add upstream https://github.com/chainlesschain/chainlesschain.git

# Install dependencies for desktop-app-vue (recommended)
cd desktop-app-vue
npm install

# Start development
npm run dev
```

### Code Style

- **JavaScript/TypeScript**: Follow ESLint configuration
- **Vue/React**: Use component-based architecture
- **Commits**: Use semantic commit messages (see below)
- **Formatting**: Use Prettier (run `npm run format`)

### Semantic Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
feat: add new feature
fix: bug fix
docs: documentation changes
style: code style changes (formatting, etc)
refactor: code refactoring
test: add or update tests
chore: maintenance tasks
perf: performance improvements
```

Examples:
```
feat(rag): add reranker support for better search accuracy
fix(ukey): resolve Windows driver compatibility issue
docs: update API documentation for LLM integration
```

## 🐛 Report Bugs Using GitHub Issues

We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/chainlesschain/chainlesschain/issues/new).

### Bug Report Template

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

Example:

```markdown
## Bug Description
Image OCR fails with non-Latin characters

## Steps to Reproduce
1. Upload an image with Chinese text
2. Click "Extract Text"
3. Observe the error

## Expected Behavior
Should extract Chinese text correctly

## Actual Behavior
Error: "Unsupported language"

## Environment
- OS: Windows 11
- Version: v0.11.0
- Node.js: 20.10.0
```

## 🔒 Security Vulnerabilities

**DO NOT** open public issues for security vulnerabilities. Instead:

1. Email security@chainlesschain.com
2. Include detailed description and steps to reproduce
3. Allow up to 48 hours for initial response
4. Major vulnerabilities may be eligible for bug bounty

## 💡 Feature Requests

We welcome feature requests! Please:

1. Check existing issues to avoid duplicates
2. Clearly describe the feature and use case
3. Explain why it would be valuable
4. Consider contributing the implementation

## 🧪 Testing

### Running Tests

```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e
```

### Writing Tests

- Write tests for all new features
- Maintain test coverage above 70%
- Use descriptive test names
- Mock external dependencies

Example:
```typescript
describe('RAG Service', () => {
  it('should retrieve relevant documents for query', async () => {
    const query = 'What is quantum computing?';
    const results = await ragService.search(query);

    expect(results).toHaveLength(5);
    expect(results[0].score).toBeGreaterThan(0.7);
  });
});
```

## 📚 Documentation

### Updating Documentation

- Update README.md for user-facing changes
- Update technical docs in `/docs` for API changes
- Add inline comments for complex logic
- Update CHANGELOG.md for all changes

### Documentation Style

- Use clear, concise language
- Include code examples
- Add screenshots for UI changes
- Keep it up-to-date

## 🎯 Priority Areas

We're currently focusing on:

### 🔴 High Priority
- P2P end-to-end encryption (Signal protocol)
- Voice input functionality
- Mobile UI completion (Android/iOS)
- Git encryption integration

### 🟡 Medium Priority
- Browser extension for web clipping
- Knowledge graph visualization
- Performance optimization
- Cross-platform USB Key support (macOS/Linux)

### 🟢 Low Priority
- Plugin system
- Multi-language UI
- Enterprise features

## 🏗️ Project Structure

Understanding the project structure:

```
chainlesschain/
├── desktop-app-vue/      # ⭐ Main PC application (Vue3)
│   ├── src/main/         # Backend (Electron main process)
│   └── src/renderer/     # Frontend (Vue3 components)
├── community-forum/      # Forum backend + frontend
├── android-app/          # Android native app
├── mobile-app/           # React Native app
└── docs/                 # Documentation
```

Focus your contributions on:
- **desktop-app-vue**: Primary development target
- **community-forum**: Social features
- **android-app**: Mobile native implementation

## ✅ Pull Request Process

1. **Update your fork**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make your changes**
   - Write clean, readable code
   - Follow existing code style
   - Add tests if applicable

4. **Commit your changes**
   ```bash
   git commit -m "feat: add amazing feature"
   ```

5. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```

6. **Open a Pull Request**
   - Use the PR template
   - Reference related issues
   - Wait for review

### Pull Request Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added to complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added/updated and passing
- [ ] Dependent changes merged

## 🤝 Code Review Process

- All PRs require at least one approval
- Maintainers will review within 3-5 business days
- Address review comments promptly
- Be open to feedback and suggestions
- Squash commits before merge (if requested)

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 🙋 Questions?

- Open a [GitHub Discussion](https://github.com/chainlesschain/chainlesschain/discussions)
- Join our community (links in README)
- Email: zhanglongfa@chainlesschain.com

## 🎉 Recognition

Contributors will be:
- Listed in CHANGELOG.md
- Mentioned in release notes
- Added to contributors list
- Eligible for contributor badges

---

Thank you for contributing to ChainlessChain! Together we're building a privacy-first, AI-native, decentralized future. 🚀
