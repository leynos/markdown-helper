.PHONY: all test package clean

DIST := dist
XPI := $(DIST)/markdown-helper.xpi

all: test

test:
	node --test 'test/**/*.test.js'

package: test
	mkdir -p $(DIST)
	rm -f $(XPI)
	cd src && zip -r ../$(XPI) manifest.json background.js content.js markdown.js

clean:
	rm -rf $(DIST)
