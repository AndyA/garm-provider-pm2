#!/usr/bin/bash

set -e

[[ -f $GARM_PROVIDER_CONFIG_FILE ]] && source $GARM_PROVIDER_CONFIG_FILE

export PATH
export HOME

cd $(dirname "$0")

node bin/provider.js | tee -a /tmp/provider.log