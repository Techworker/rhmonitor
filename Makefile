build:
	pkg rhmonitor.js -t=node10-win-x64 -o=bin/rhmonitor-win-x64
	pkg rhmonitor.js -t=node10-linux-x64 -o=bin/rhmonitor-linux-x64
	pkg rhmonitor.js -t=node10-macos-x64 -o=bin/rhmonitor-macos-x64
	pkg rhmonitor.js -t=node10-win-x86 -o=bin/rhmonitor-win-x86
	pkg rhmonitor.js -t=node10-linux-x86 -o=bin/rhmonitor-linux-x86
	pkg rhmonitor.js -t=node10-macos-x86 -o=bin/rhmonitor-macos-x86
