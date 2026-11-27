#!/usr/bin/env bash
# Point this checkout's workspace links at its own packages.
#
# A Git worktree can share another tree's node_modules (a directory of per-entry
# links to it, or a symlinked scope directory). Every @earendil-works/* package
# and @todo/app then resolves from that other tree, so the same package loads
# twice: chord once from packages/chord/src by the example's relative imports,
# once from the other tree by package name. Chord's contract registry is a
# module-level WeakMap, so a handle declared through one copy is refused by the
# other ("todo.todos: not a declared contract"), and tsc reports the two copies
# as incompatible types (TuiScope). packages/tui fails the same way on its
# native module's identity.
#
# This script makes the workspace packages resolve to ./packages/*, keeps every
# third-party entry of @earendil-works, points @todo/app at the tutorial package,
# and verifies that each package has one instance inside the checkout. It
# changes node_modules only, never a tracked file, and is idempotent.
#
# Usage: scripts/fix-module-links.sh
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
modules="$root/node_modules"

# npm package name -> directory under packages/ (root package.json workspaces).
WORKSPACE_PACKAGES=(
	"chord:chord"
	"pi-agent-core:agent"
	"pi-ai:ai"
	"pi-codemode:codemode"
	"pi-coding-agent:coding-agent"
	"pi-durable:durable"
	"pi-env:env"
	"pi-evals:evals"
	"pi-mcp:mcp"
	"pi-schema:schema"
	"pi-telemetry:telemetry"
	"pi-tui:tui"
)

# The tutorial package is a workspace of its own, outside packages/*.
TODO_APP="packages/chord/test/examples/61-tutorial"

fail() {
	printf 'fix-module-links: %s\n' "$*" >&2
	exit 1
}

# A scope directory another tree owns arrives as a symlink. Replace it with a
# real directory, keeping each entry as a link to what it already resolved to,
# so third-party packages keep coming from the install that provides them.
materialize_scope() {
	local scope="$1" target entry resolved
	if [[ ! -L "$scope" ]]; then
		mkdir -p "$scope"
		return
	fi
	target=$(readlink -f "$scope")
	rm -f "$scope"
	mkdir -p "$scope"
	while IFS= read -r entry; do
		[[ -n "$entry" ]] || continue
		resolved=$(readlink -f "$target/$entry")
		ln -sfn "$resolved" "$scope/$entry"
	done < <(ls -A "$target")
}

# One link per workspace package, relative to the scope directory so the checkout
# stays relocatable.
link_workspaces() {
	local pair name dir
	materialize_scope "$modules/@earendil-works"
	for pair in "${WORKSPACE_PACKAGES[@]}"; do
		name=${pair%%:*}
		dir=${pair##*:}
		ln -sfn "../../packages/$dir" "$modules/@earendil-works/$name"
	done
	materialize_scope "$modules/@todo"
	ln -sfn "../../$TODO_APP" "$modules/@todo/app"
}

# A package whose link leaves the checkout is a second instance of it.
expect_inside() {
	local name="$1" actual="$2" expected="$3"
	[[ -d "$actual" ]] || fail "$name does not resolve to a directory ($actual)"
	actual=$(cd "$actual" && pwd -P)
	[[ "$actual" == "$expected" ]] || fail "$name resolves to $actual, expected $expected"
}

verify() {
	local pair name dir actual resolved from_root from_example
	for pair in "${WORKSPACE_PACKAGES[@]}"; do
		name=${pair%%:*}
		dir=${pair##*:}
		expect_inside "@earendil-works/$name" "$modules/@earendil-works/$name" "$root/packages/$dir"
	done
	expect_inside "@todo/app" "$modules/@todo/app" "$root/$TODO_APP"

	# Chord is imported relatively by the tutorial and by name through its
	# plugins, so both roots must reach the same module.
	resolve_chord() {
		(cd "$1" && node --conditions=source -e 'process.stdout.write(require.resolve("@earendil-works/chord"))')
	}
	from_root=$(resolve_chord "$root")
	from_example=$(resolve_chord "$root/$TODO_APP")
	[[ "$from_root" == "$from_example" ]] ||
		fail "@earendil-works/chord resolves to two paths: $from_root and $from_example"
	[[ "$from_root" == "$root"/packages/chord/* ]] ||
		fail "@earendil-works/chord resolves outside this checkout: $from_root"

	resolved=$(cd "$root/$TODO_APP" && node --conditions=source -e 'process.stdout.write(require.resolve("@todo/app/v1"))')
	[[ "$resolved" == "$root/$TODO_APP"/* ]] ||
		fail "@todo/app/v1 resolves outside this checkout: $resolved"

	printf 'workspace links fixed: %d packages, @todo/app\n' "${#WORKSPACE_PACKAGES[@]}"
	printf '@earendil-works/chord -> %s\n' "$from_root"
	printf '@todo/app/v1 -> %s\n' "$resolved"
}

link_workspaces
verify
