#!/usr/bin/env bash

cross-env \
  APP_PORT=9090 \
  CHAIN_DB=./devdb\
  CHAIN_AUTHORIZED_NODE=false \
  NETWORK_EXTERNAL_HOST=0.0.0.0 \
  NETWORK_PORT=9091 \
  NETWORK_PEERS=0.0.0.0:8081 \
  nodemon src/index.js --exec node
