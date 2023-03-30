#!/usr/bin/bash

set -e

# GARM_COMMAND=CreateInstance
# GPM2_ARCH=amd64
# GPM2_ARCHITECTURE=x64
# GPM2_CALLBACK_URL=https://garm.example.com/api/v1/callbacks/status
# GPM2_CA_CERT_BUNDLE=null
# GPM2_DOWNLOAD_URL=https://github.com/actions/runner/releases/download/v2.299.1/actions-runner-linux-x64-2.299.1.tar.gz
# GPM2_FILENAME=actions-runner-linux-x64-2.299.1.tar.gz
# GPM2_FLAVOR=m1.small
# GPM2_IMAGE=8ed8a690-69b6-49eb-982f-dcb466895e2d
# GPM2_INSTANCE_TOKEN=super secret JWT token
# GPM2_LABELS=ubuntu,self-hosted,x64,linux,openstack,runner-controller-id:f9286791-1589-4f39-a106-5b68c2a18af4,runner-pool-id:9dcf590a-1192-4a9c-b3e4-e0902974c2c0
# GPM2_METADATA_URL=https://garm.example.com/api/v1/metadata
# GPM2_NAME=garm-e73542f6-2c10-48bb-bfe7-a0374618f405
# GPM2_OS=linux
# GPM2_POOL_ID=9dcf590a-1192-4a9c-b3e4-e0902974c2c0
# GPM2_REPO_URL=https://github.com/gabriel-samfira/scripts
# GPM2_RUNNER_HOME=/home/andy/Works/Github/garm-provider-pm2/work/job/garm-zuku718yotc8q2upuprh
# GPM2_RUNNER_ID=garm-zuku718yotc8q2upuprh
# GPM2_SHA_256_CHECKSUM=147c14700c6cb997421b9a239c012197f11ea9854cd901ee88ead6fe73a72c74
# GPM2_SSH_KEYS=null
# GPM2_STASH_DIR=/home/andy/Works/Github/garm-provider-pm2/work/stash

function call() {
	local PAYLOAD="$1"
  >&2 echo "$PAYLOAD"
	# curl --fail -s -X POST -d "${PAYLOAD}"                \
  #   -H "Accept: application/json"                      \
  #   -H "Authorization: Bearer ${GPM2_INSTANCE_TOKEN}"  \
  #   "${GPM2_CALLBACK_URL}"                             \
  #   || echo "failed to call home: exit code ($?)"
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

pushd "$GPM2_STASH_DIR" > /dev/null

env | sort | grep '^GPM2_'

# TODO check it really is a tgz.
PROTO_DIR="${GPM2_FILENAME%.tar.gz}"

if [[ ! -d "$PROTO_DIR" ]]; then
  # Download?
  if [[ ! -e "$GPM2_FILENAME" ]]; then
    sendStatus "Downloading $GPM2_DOWNLOAD_URL"

    TMP="${GPM2_FILENAME}.tmp"
    curl -L --show-error --fail -o "$TMP" "$GPM2_DOWNLOAD_URL" \
      || fail "Can't get $url"
    mv "$TMP" "$GPM2_FILENAME"

    sendStatus "Verifying $GPM2_FILENAME"

    # Verify checksum
    if which sha256sum > /dev/null; then
      check="$(sha256sum "$GPM2_FILENAME" | awk '{ print $1 }')"
    else
      check="$(shasum -a 256 "$GPM2_FILENAME" | awk '{ print $1 }')"
    fi

    [[ $check = $GPM2_SHA_256_CHECKSUM ]] || fail "Bad hash ($check != $GPM2_SHA_256_CHECKSUM)"
  fi

  # Unpack
  mkdir -p "$PROTO_DIR"
  pushd "$PROTO_DIR" > /dev/null
  tar zxf "../$GPM2_FILENAME"
  popd > /dev/null
fi

sendStatus "Cloning into $GPM2_RUNNER_HOME"

# Need to rm -rf first because garm-external-provider already
# created it.
rm -rf "$GPM2_RUNNER_HOME"

# Hard links - speedy and small.
cp -rl "$PROTO_DIR" "$GPM2_RUNNER_HOME"

popd > /dev/null
