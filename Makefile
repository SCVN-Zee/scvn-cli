# Makefile — build and package the scvn CLI (maintainer tasks).
#
#   make build         Build the self-contained dist/cli.mjs (tsup).
#   make pack          Build, then bundle bin/dist/templates + ~/.scvn/store + a pinned Node
#                      runtime into pkg/scvn-bundle-<version>.zip (deliver to a teammate).
#   make pack-no-node  Same as pack, but omit the bundled Node (consumer needs system Node >=20).
#
# Packaging reuses the CLI's own TypeScript pack logic via tsx (a devDependency); there is no
# `scvn pack` command — producing a bundle is a maintainer action triggered here.

.PHONY: build pack pack-no-node

build:
	npm run build

pack: build
	npx tsx scripts/pack.ts

pack-no-node: build
	npx tsx scripts/pack.ts --no-node
