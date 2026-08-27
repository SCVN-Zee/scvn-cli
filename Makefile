# Makefile — build and package the scvn CLI (maintainer tasks).
#
#   make dev           Start the desktop (Electron) app in dev mode.
#   make bump          Bump the version (patch) and create the matching v<version>
#                      commit + git tag that the release workflow triggers on. Works
#                      even with a dirty tree / staged WIP: the release commit contains
#                      only package.json + package-lock.json, nothing else.
#                      Override the bump: `make bump VERSION=minor` / `VERSION=major` /
#                      an explicit version `VERSION=1.2.3`. Push with `git push --follow-tags`.
#   make build         Build the self-contained dist/cli.mjs (tsup).
#   make pack          Build, then bundle bin/dist/templates + ~/.scvn/store + a pinned Node
#                      runtime into pkg/scvn-bundle-<version>.zip (deliver to a teammate).
#   make pack-no-node  Same as pack, but omit the bundled Node (consumer needs system Node >=20).
#
# Packaging reuses the CLI's own TypeScript pack logic via tsx (a devDependency); there is no
# `scvn pack` command — producing a bundle is a maintainer action triggered here.

VERSION ?= patch

.PHONY: dev bump build pack pack-no-node

dev:
	npm run desktop:dev

bump:
	npm version $(VERSION) --no-git-tag-version
	@v=$$(node -p "require('./package.json').version") && \
	  echo "Bumped to v$$v"

build:
	npm run build

pack: build
	npx tsx scripts/pack.ts

pack-no-node: build
	npx tsx scripts/pack.ts --no-node
