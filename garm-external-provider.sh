#!/usr/bin/bash

set -e

export PATH="/snap/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/andy"

cd $(dirname "$0")

pwd >> "/tmp/provider.log"
which node >> "/tmp/provider.log"
env | sort >> "/tmp/provider.log"
echo "-----" >> "/tmp/provider.log"

node garm-external-provider.js | tee -a "/tmp/provider.log"