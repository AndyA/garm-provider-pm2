#!/usr/bin/bash

set -e

function call() {
	local PAYLOAD="$1"
  echo "$PAYLOAD" >> "/tmp/download.log"
	curl --fail -s -X POST -d "${PAYLOAD}"                \
    -H "Accept: application/json"                      \
    -H "Authorization: Bearer ${GPM2_INSTANCE_TOKEN}"  \
    "${GPM2_CALLBACK_URL}"                             \
    || echo "failed to call home: exit code ($?)" 1>&2
}

function sendStatus() {
	local MSG="$1"
	call "{\"status\": \"installing\", \"message\": \"$MSG\"}"
}

function fail() {
  echo "$MSG" 
	local MSG="$1"
	call "{\"status\": \"failed\", \"message\": \"$MSG\"}"
	exit 1
}

pushd "$GPM2_STASH_DIR" > /dev/null

# env | sort | grep '^GPM2_'

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
