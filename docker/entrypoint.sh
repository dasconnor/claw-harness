#!/bin/bash
set -e
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
sleep 0.5
export DISPLAY=:99
exec "$@"
