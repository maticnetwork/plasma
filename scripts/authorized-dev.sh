#!/usr/bin/env bash

cross-env \
  CHAIN_AUTHORIZED_NODE=true \
  nodemon src/index.js --exec node
