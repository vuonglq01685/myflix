SHELL := /bin/bash
COMPOSE := docker compose
CPU := $(COMPOSE) -f docker-compose.yml -f infra/compose/docker-compose.cpu.yml

KB_CODE_DOC := myflix-code

.PHONY: help up up-cpu down logs ps verify migrate seed studio fmt test test-e2e clean kb

help:           ## Show this help
	@grep -hE '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*## /\t/' | expand -t22

up:             ## Start the full stack (needs an NVIDIA GPU)
	$(COMPOSE) up -d --build

up-cpu:         ## Start the stack with the libx264 fallback transcoder
	$(CPU) up -d --build

down:           ## Stop everything, keep volumes
	$(COMPOSE) down

logs:           ## Tail all logs
	$(COMPOSE) logs -f --tail=100

ps:             ## Service status
	$(COMPOSE) ps

verify:         ## Run the Phase 0 Definition of Done checks
	bash scripts/verify-phase0.sh

migrate:        ## Apply Prisma migrations inside the api container
	$(COMPOSE) exec api npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

seed:           ## Seed admin account + genres
	$(COMPOSE) exec api node packages/db/dist/seed.js

test:           ## Run workspace unit tests
	pnpm -r test

test-e2e:       ## API integration tests against the compose datastores, then Playwright
	$(COMPOSE) -f docker-compose.yml -f infra/compose/docker-compose.test.yml up -d --build
	set -a; . ./.env; set +a; \
	DATABASE_URL=postgresql://$$POSTGRES_USER:$$POSTGRES_PASSWORD@localhost:5432/$$POSTGRES_DB \
	REDIS_HOST=localhost S3_ENDPOINT=http://localhost:9000 pnpm --filter @myflix/api test:e2e
	pnpm --filter @myflix/e2e test:e2e

clean:          ## Stop and delete volumes — DESTROYS the database and media
	$(COMPOSE) down -v

# `kb code-ingest` rewrites every L1/L2 in -code from its own scaffold, which
# wipes the verbatim body `kb summarize` wrote for sections whose L3 prose is
# under BRIEF_CHARS. Those are filled deterministically (no LLM), so repair
# them here rather than leaving --strict red. CI cannot do this: kb summarize
# aborts when no LLM CLI is on PATH, even for sections that need none.
kb:             ## Re-extract code knowledge, repair brief sections, validate
	kb code-ingest --scaffold-svc
	@ids=$$(kb build --strict 2>&1 \
	  | sed -n 's/^\[error\] $(KB_CODE_DOC) §\([^:]*\): brief section.*/\1/p' | sort -u); \
	if [ -n "$$ids" ]; then \
	  echo "repairing brief sections: $$ids"; \
	  kb summarize $(KB_CODE_DOC) --redo --yes \
	    $$(for i in $$ids; do printf -- '--section %s ' "$$i"; done) || true; \
	fi
	kb build --strict
