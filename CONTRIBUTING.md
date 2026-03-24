# Contributing to Crabcage

Thanks for your interest in contributing to crabcage.

## Development Setup

```bash
git clone https://github.com/boxshopio/crabcage.git
cd crabcage
npm install
npm test          # run tests
npm run build     # compile TypeScript
npm run dev       # run CLI directly via tsx
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Write tests for any new functionality
3. Run `npm test` and `npm run build` before submitting
4. Keep PRs focused — one feature or fix per PR
5. Write clear commit messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`

## Project Structure

```
src/
  cli.ts              # CLI entry point
  commands/           # CLI command implementations
  config/             # Config schema, validation, loading
  credentials/        # Credential validation + auth detection
  docker/             # Compose generation + Docker client
  mounts/             # Mount path validation + resolution
tests/                # Mirrors src/ structure
container/            # Dockerfile + entrypoint
```

## Running Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
npx vitest run tests/config/  # run specific test directory
```

## Code Style

- TypeScript strict mode
- ESM modules (`"type": "module"`)
- Tests use vitest
- Follow existing patterns in the codebase

## Reporting Issues

- Use GitHub Issues
- Include: what you expected, what happened, steps to reproduce
- For security issues, email security@boxshop.io instead of opening a public issue
