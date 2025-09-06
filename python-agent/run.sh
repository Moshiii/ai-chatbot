
#!/bin/bash

# Start the agent servers in the background
python trending_agent.py &
trending_pid=$!

python analyzer_agent.py &
analyzer_pid=$!

python host_agent.py &
host_pid=$!

python market_analysis_agent.py &
market_analysis_pid=$!

# Wait for the servers to start
sleep 5

# Run the client tests
python client.py

# Kill the agent servers
kill $trending_pid
kill $analyzer_pid
kill $host_pid
kill $market_analysis_pid
