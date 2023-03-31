#!/usr/bin/bash

set -e

function call() {
	local PAYLOAD="$1"
  echo "$PAYLOAD" >> "/tmp/bootstrap.log"
	curl --fail -s -X POST -d "${PAYLOAD}"                \
    -H "Accept: application/json"                      \
    -H "Authorization: Bearer ${GPM2_INSTANCE_TOKEN}"  \
    "${GPM2_CALLBACK_URL}"                             \
    || echo "failed to call home: exit code ($?)"
}

function sendStatus() {
	local MSG="$1"
	call "{\"status\": \"installing\", \"message\": \"$MSG\"}"
}

function success() {
	local MSG="$1"
	local ID="$2"
	call "{\"status\": \"idle\", \"message\": \"$MSG\", \"agent_id\": $ID}"
}

function fail() {
  echo "$MSG" 
	local MSG="$1"
	call "{\"status\": \"failed\", \"message\": \"$MSG\"}"
	exit 1
}

sendStatus "Configuring runner"

./config.sh                       \
  --unattended                    \
  --url "${GPM2_REPO_URL}"        \
  --token "${GPM2_GITHUB_TOKEN}"  \
  --name "${GPM2_NAME}"           \
  --labels "${GPM2_LABELS}"       \
  --ephemeral                     \
  || fail "Failed to configure runner"

sendStatus "Starting service"

success "Runner successfully started"

./run.sh || fail "Failed to start service"
