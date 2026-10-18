# Development commands. Run them from the worktree you are working on.
SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help test check active active-status worktree package

help: ## List commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-15s %s\n", $$1, $$2}'

test: ## Run unit tests
	@node --test "tests/*.test.mjs"

check: ## Syntax-check all scripts, then run tests
	@for f in scripts/*.mjs scripts/**/*.mjs tools/*.mjs tests/*.mjs; do node --check "$$f" || exit 1; done
	@$(MAKE) --no-print-directory test

active: ## Make Foundry load THIS worktree (symlink in Data/modules; FOUNDRY_DATA overrides the path)
	@tools/active.sh link "$(CURDIR)"

active-status: ## Show which worktree Foundry is loading
	@tools/active.sh status

worktree: ## Create/reuse the worktree of an issue: make worktree ISSUE=4 [SLUG=name]
	@tools/worktree.sh "$(ISSUE)" $(SLUG)

package: ## Build dist/module.zip and dist/module.json
	@tools/package.sh
