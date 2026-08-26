# Makefile — build and package the scvn CLI (maintainer tasks).
#
#   make dev           Start the desktop (Electron) app in dev mode.
#   make bump          Bump the version (patch) and create the matching v<version>
#                      commit + git tag that the release workflow triggers on. Works
#                      even with a dirty tree / staged WIP: the release commit contains
#                      only package.json + package-lock.json, nothing else.
#                      Override the bump: `make bump LEVEL=minor` / `LEVEL=major` /
#                      an explicit version `LEVEL=1.2.3`. Push with `git push --follow-tags`.
#   make build         Build the self-contained dist/cli.mjs (tsup).
#   make pack          Build, then bundle bin/dist/templates + ~/.scvn/store + a pinned Node
#                      runtime into pkg/scvn-bundle-<version>.zip (deliver to a teammate).
#   make pack-no-node  Same as pack, but omit the bundled Node (consumer needs system Node >=20).
#
# Packaging reuses the CLI's own TypeScript pack logic via tsx (a devDependency); there is no
# `scvn pack` command — producing a bundle is a maintainer action triggered here.

LEVEL ?= patch

.PHONY: dev bump build pack pack-no-node

dev:
	npm run desktop:dev

bump:
	npm version $(LEVEL) --no-git-tag-version
	@v=$$(node -p "require('./package.json').version") && \
	  git commit -q -m "release: $$v" package.json package-lock.json && \
	  git tag "v$$v" && \
	  echo "Bumped to v$$v — commit + tag created. Push with: git push --follow-tags"

build:
	npm run build

pack: build
	npx tsx scripts/pack.ts

pack-no-node: build
	npx tsx scripts/pack.ts --no-node
