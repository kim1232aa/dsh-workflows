#!/usr/bin/env bash
# e2e: pack -> install into isolated `wftest` profile -> run headless against mock LLM (18191). Never touches 3080.
set -e
cd "$(dirname "$0")/../.."
npm pack -q --pack-destination /tmp >/dev/null
dsh plugin --profile wftest add file:/tmp/dsh-workflows-$(node -p 'require("./package.json").version').tgz >/dev/null
rm -f /tmp/mock-llm.log
mkdir -p /tmp/wfe2e && cd /tmp/wfe2e
MOCK_API_KEY=mock timeout 180 dsh wftest "RUN_WF please"
