#!/bin/bash

# Task Agent Orchestrator Server Starter
# This script starts the orchestrator server on port 9999 for Next.js integration

echo "Starting Task Agent Orchestrator Server..."
echo "This will start an A2A server on http://localhost:9999"
echo "Press Ctrl+C to stop the server"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to the python-agent directory
cd "$SCRIPT_DIR/.."

# Start the orchestrator server (this will run persistently)
python -m task_agent