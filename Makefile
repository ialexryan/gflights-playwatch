SHELL := /bin/bash
PROJECT_DIR := $(shell pwd)
LAUNCH_AGENT_NAME := com.gflights.playwatch
LAUNCH_AGENT := $(HOME)/Library/LaunchAgents/$(LAUNCH_AGENT_NAME).plist

.PHONY: install login watch plist plist-load plist-unload plist-logs clean

install:
	npm install

login:
	npm run login

watch:
	npm run watch

plist: bin/run-watch.sh plist-template.plist
	sed "s|__PROJECT_DIR__|$(PROJECT_DIR)|g" plist-template.plist > $(LAUNCH_AGENT)

plist-load: plist
	launchctl load -w $(LAUNCH_AGENT)
	@echo "Loaded: $(LAUNCH_AGENT)"

plist-unload:
	-launchctl unload $(LAUNCH_AGENT)
	-rm -f $(LAUNCH_AGENT)
	@echo "Unloaded: $(LAUNCH_AGENT)"

plist-logs:
	@mkdir -p logs
	@touch logs/watch.log logs/watch.err
	tail -n 200 -f logs/watch.log logs/watch.err

clean:
	rm -rf node_modules logs/* last-output.txt
