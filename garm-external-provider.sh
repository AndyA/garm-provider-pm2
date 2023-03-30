#!/usr/bin/bash

set -e

export PATH="/snap/bin:/usr/local/bin:/usr/bin:/bin"

cd $(dirname "$0")

pwd >> "tmp/tracer.log"
which node >> "tmp/tracer.log"
env | sort >> "tmp/tracer.log"

node garm-external-provider.js 2>&1 >> "tmp/hook.log"