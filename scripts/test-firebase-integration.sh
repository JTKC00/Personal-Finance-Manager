#!/bin/sh
set -eu

for mac_java_bin in "/opt/homebrew/opt/openjdk@21/bin" "/usr/local/opt/openjdk@21/bin"; do
  if [ -x "$mac_java_bin/java" ]; then
    PATH="$mac_java_bin:$PATH"
    export PATH
    break
  fi
done

firebase emulators:exec \
  --project demo-personal-finance-manager \
  --only auth,firestore \
  "vitest run --config vitest.integration.config.ts"
