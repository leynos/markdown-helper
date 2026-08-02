.PHONY: all check-fmt lint typecheck test package clean

DIST := dist
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

package: test
	mkdir -p $(DIST)
	rm -f $(XPI)
	cd src && zip -r ../$(XPI) manifest.json background.js content.js markdown.js icons -x 'icons/icon-1024.png'
	zip -j $(XPI) LICENSE

clean:
	rm -rf $(DIST)
