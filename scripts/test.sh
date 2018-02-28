#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Executes cleanup function at script exit.
trap cleanup EXIT

cleanup() {
  echo "Cleaning up"
  # Kill the client instance that we started (if we started one and if it's still running).
  if [ -n "$client_pid" ] && ps -p $client_pid > /dev/null; then
    kill -9 $client_pid
  fi

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

client_port=8080
client_running() {
  nc -z localhost "$client_port"
}

start_client() {
  npm run authorized-dev > /dev/null &
  client_pid=$!
}

if testrpc_running; then
  echo "Using existing testrpc instance"
else
  echo "Starting our own testrpc instance"
  start_testrpc
fi

if client_running; then
  echo "Using existing client instance"
else
  echo "Starting our own client instance"
  start_client
fi

npm run test "$@"
