#!/usr/bin/bash

set -e

[[ -f $GARM_PROVIDER_CONFIG_FILE ]] && source $GARM_PROVIDER_CONFIG_FILE

export PATH
export HOME

cd $(dirname "$0")

node bin/provider.js 2>> /tmp/provider.log | tee -a /tmp/provider.log