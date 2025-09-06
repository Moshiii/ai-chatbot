
#!/bin/bash


# Start the agent servers in the background
# python trending_agent.py &
# trending_pid=$!

# python analyzer_agent.py &
# analyzer_pid=$!

# python host_agent.py &
# host_pid=$!

# python market_analysis_agent.py &
# market_analysis_pid=$!

# python __main__.py &
# main_pid=$!

python /Users/moshiwei/Documents/GitHub/ai-chatbot/python-agent/task_agent/orchestrator_executor.py &
client_pid=$!

# Wait for the servers to start
sleep 5

# # Run the client tests
python /Users/moshiwei/Documents/GitHub/ai-chatbot/python-agent/task_agent/orchestrator_client.py

# # Kill the agent servers
# kill $trending_pid
# kill $analyzer_pid
# kill $host_pid
# kill $market_analysis_pid
kill $client_pid