#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Executes cleanup function at script exit.
trap cleanup EXIT

cleanup() {
  echo "Cleaning up"
  # Kill the testrpc instance that we started (if we started one and if it's still running).
  if [ -n "$testrpc_pid" ] && ps -p $testrpc_pid > /dev/null; then
    kill -9 $testrpc_pid
  fi
  echo "Done"
}

testrpc_port=8545
testrpc_running() {
  nc -z localhost "$testrpc_port"
}

start_testrpc() {
  npm run testrpc > /dev/null &
  testrpc_pid=$!
}


if testrpc_running; then
  echo "Using existing testrpc instance"
else
  echo "Starting our own testrpc instance"
  start_testrpc
fi

npm run test "$@"
