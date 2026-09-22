SHELL := /bin/bash
COMPOSE := docker compose
CPU := $(COMPOSE) -f docker-compose.yml -f docker-compose.cpu.yml

.PHONY: help up up-cpu down logs ps verify migrate seed studio fmt test test-e2e clean

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
	$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml up -d --build
	set -a; . ./.env; set +a; \
	DATABASE_URL=postgresql://$$POSTGRES_USER:$$POSTGRES_PASSWORD@localhost:5432/$$POSTGRES_DB \
	REDIS_HOST=localhost S3_ENDPOINT=http://localhost:9000 pnpm --filter @myflix/api test:e2e
	pnpm --filter @myflix/e2e test:e2e

clean:          ## Stop and delete volumes — DESTROYS the database and media
	$(COMPOSE) down -v
