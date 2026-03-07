#!/usr/bin/env bash
# Start local debugging for ArrangeV4 Next.js app
set -e

cd "$(dirname "$0")/src/arrange-v4"
npm run dev
