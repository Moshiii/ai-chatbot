# Task A2A Agent

A Python A2A agent that handles task decomposition and job execution for the chatbot.

## Features

- ✅ Decomposes projects into jobs with pre-assigned agents
- ✅ Executes jobs and streams real-time updates
- ✅ Generates project execution summaries
- ✅ Supports different project types (web, scraping, API, generic)
- ✅ Uses `createTask` and `updateTask` tools for chatbot integration

## Quick Start

1. **Install dependencies:**
   ```bash
   cd python-agent
   pip install -e .
   ```

2. **Run the agent:**
   ```bash
   python -m task_agent
   ```

3. **Agent will start on:**
   ```
   http://localhost:9999
   ```

## Integration with Chatbot

1. **Set environment variable:**
   ```bash
   export NEXT_PUBLIC_ENABLE_A2A=true
   export A2A_AGENT_URL=http://localhost:9999
   ```

2. **Select "Python Agent (A2A)" model in chatbot**

3. **Test with messages like:**
   - "Create a task for building a web application"
   - "Help me plan a web scraping project"
   - "I need to build an API"
   - "Execute the jobs for task-abc123"

## Message Format

The agent sends messages in the format expected by the chatbot:

```json
{
  "newTask": {
    "id": "task-1",
    "title": "Frontend Development", 
    "description": "Create responsive UI...",
    "status": "pending",
    "assignedAgent": {
      "id": "agent-1",
      "name": "Frontend Specialist",
      "capabilities": ["React", "TypeScript"],
      "pricingUsdt": 1.5
    }
  }
}
```

## Project Structure

```
task_agent/
├── __init__.py          # Package init
├── __main__.py          # Entry point & server setup
└── agent_executor.py    # Core logic & message handling
```

This agent is designed to be simple and extensible for future enhancements.