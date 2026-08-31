.PHONY: all check-fmt lint typecheck test check-version stage package sign clean

DIST := dist
STAGE := $(DIST)/package
XPI := $(DIST)/markdown-helper.xpi

all: check-fmt lint typecheck test

check-fmt:
	bunx --bun biome format .

lint:
	bunx --bun biome lint .

typecheck:
	bunx --bun tsc -p jsconfig.json

test:
	node --test test/*.test.js

# Fails unless VERSION matches every version the repository declares, so a
# release tag can never ship a package that names a different version.
check-version:
	@test -n "$$VERSION" || { echo 'set VERSION, e.g. make check-version VERSION=0.1.0'; exit 1; }
	@node scripts/check-version.js "$${VERSION#v}"

# Build the XPI after its prerequisite tests have passed.
assemble: stage
	rm -f $(XPI)
	cd $(STAGE) && zip -r ../../$(XPI) .

# Assemble exactly what ships, so `package` and `sign` cannot diverge.
stage:
	rm -rf $(STAGE)
	mkdir -p $(STAGE)
	cp -R src/. $(STAGE)/
	rm -f $(STAGE)/globals.d.ts $(STAGE)/icons/icon-1024.png
	cp LICENSE $(STAGE)/

package: test assemble

# Signed by addons.mozilla.org; needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET.
sign: test stage
	bunx web-ext sign --source-dir $(STAGE) --artifacts-dir $(DIST) --channel unlisted

clean:
	rm -rf $(DIST)
