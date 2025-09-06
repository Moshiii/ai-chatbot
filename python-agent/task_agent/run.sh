# Start of Selection

#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Start the agent servers in the background
# python "$SCRIPT_DIR/trending_agent.py" &
# trending_pid=$!

# python "$SCRIPT_DIR/analyzer_agent.py" &
# analyzer_pid=$!

# python "$SCRIPT_DIR/host_agent.py" &
# host_pid=$!

# python "$SCRIPT_DIR/market_analysis_agent.py" &
# market_analysis_pid=$!

# python "$SCRIPT_DIR/__main__.py" &
# main_pid=$!

python "$SCRIPT_DIR/orchestrator_executor.py" &
client_pid=$!

# Wait for the servers to start
sleep 5

# Run the client tests
python "$SCRIPT_DIR/orchestrator_client.py"

# Kill the agent servers
# kill $trending_pid
# kill $analyzer_pid
# kill $host_pid
# kill $market_analysis_pid
kill $client_pid