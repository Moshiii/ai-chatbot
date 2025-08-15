# Python Agent Protocol Guide

## Overview
This document defines the communication protocol between the Next.js canvas application and the Python agent orchestrator. All communication happens via the A2A (Agent-to-Agent) provider using JSON-formatted messages.

## Connection Configuration
```javascript
// Next.js configuration
const A2A_AGENT_URL = process.env.A2A_AGENT_URL; // e.g., "http://localhost:8000"
const provider = a2a(A2A_AGENT_URL, {
  maxHistoryLength: 5,
  maxRetries: 2,
  toolcallSupport: true,
  taskMode: true
});
```

## Protocol Messages

### 1. Create Canvas with Task Decomposition

**Tool Call Format:**
```json
{
  "type": "toolcall",
  "tool": "create_canvas",
  "arguments": {
    "title": "Project Title or Goal Description",
    "description": "Detailed description of what needs to be broken down"
  }
}
```

**Expected Response (A2A Protocol Format):**
```json
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"newTask\":{\"id\":\"task-uuid-1\",\"title\":\"Data Collection and Preparation\",\"description\":\"Gather and preprocess data from multiple sources\",\"status\":\"pending\",\"assignedAgent\":{\"id\":\"agent-uuid-1\",\"name\":\"DataCollector\",\"description\":\"Specializes in web scraping and API integration\",\"capabilities\":[\"Web Scraping\",\"API Integration\",\"Data Validation\"],\"pricingUsdt\":0.75,\"walletAddress\":\"0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4\"}}}"
      }
    ]
  }
}
```

**Note:** The A2A provider automatically converts this to `data-textDelta` format for the UI.

**Notes:**
- Tasks should be streamed one at a time with `newTask` events via `data-textDelta`
- Each task MUST include a pre-assigned agent
- Agent names should be <= 15 characters  
- Agent descriptions should be <= 10 words
- Capabilities should be exactly 3 items
- Use 200ms delay between tasks (not 800ms)
- All streaming should use A2A `artifact-update` format with canvas artifacts

### 2. Execute All Agents (Batch Execution)

**Tool Call Format:**
```json
{
  "type": "toolcall",
  "tool": "execute_all_agents",
  "arguments": {
    "canvasId": "canvas-uuid",
    "agents": [
      {
        "id": "agent-uuid-1",
        "name": "DataCollector",
        "taskId": "task-uuid-1",
        "capabilities": ["Web Scraping", "API Integration", "Data Validation"],
        "pricingUsdt": 0.75
      },
      {
        "id": "agent-uuid-2",
        "name": "Analyzer",
        "taskId": "task-uuid-2",
        "capabilities": ["Statistical Analysis", "Pattern Recognition", "Reporting"],
        "pricingUsdt": 1.25
      }
    ],
    "tasks": [
      {
        "id": "task-uuid-1",
        "title": "Data Collection and Preparation",
        "description": "Gather and preprocess data from multiple sources"
      },
      {
        "id": "task-uuid-2",
        "title": "Data Analysis",
        "description": "Analyze collected data for patterns and insights"
      }
    ],
    "totalCostUsdt": 2.00,
    "executionMode": "parallel"
  }
}
```

**Expected Response (Streaming):**
```json
{
  "type": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "data",
        "data": {
          "type": "agent-response",
          "agentId": "agent-uuid-1",
          "taskId": "task-uuid-1",
          "status": "in-progress",
          "content": "Starting data collection from 15 sources...",
          "timestamp": "2024-01-20T10:30:00Z"
        }
      }
    ]
  }
}
```

**Response Completion Event:**
```json
{
  "type": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "data",
        "data": {
          "type": "agent-response",
          "agentId": "agent-uuid-1",
          "taskId": "task-uuid-1",
          "status": "completed",
          "content": "Data collection completed. Collected 2,847 data points from 15 sources with 98% accuracy. Data validated and stored.",
          "timestamp": "2024-01-20T10:31:45Z"
        }
      }
    ]
  }
}
```

### 3. Generate Summary Report

**Tool Call Format:**
```json
{
  "type": "toolcall",
  "tool": "generate_summary",
  "arguments": {
    "canvasId": "canvas-uuid",
    "responses": [
      {
        "id": "response-uuid-1",
        "agentId": "agent-uuid-1",
        "content": "Data collection completed. Collected 2,847 data points..."
      },
      {
        "id": "response-uuid-2",
        "agentId": "agent-uuid-2",
        "content": "Analysis completed. Identified 12 significant patterns..."
      }
    ],
    "agents": ["agent-uuid-1", "agent-uuid-2"],
    "tasks": ["task-uuid-1", "task-uuid-2"]
  }
}
```

**Expected Response:**
```json
{
  "type": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "data",
        "data": {
          "type": "summary-report",
          "id": "summary-uuid",
          "content": "Executive Summary Report\n\nProject Status: 2/2 tasks completed (100%)\n\nKey Findings:\n• 2 agents successfully executed their assigned tasks\n• Data collection phase gathered 2,847 data points with 98% accuracy\n• Analysis identified 12 significant patterns\n\nRecommendations:\n1. Proceed with implementation of identified patterns\n2. Schedule follow-up analysis in 30 days\n\nGenerated by: DataCollector, Analyzer\nTimestamp: 2024-01-20T10:35:00Z",
          "timestamp": "2024-01-20T10:35:00Z"
        }
      }
    ]
  }
}
```

### 4. Request Agent Selection (Legacy - Being Deprecated)

**Note:** This will be removed as agents are now pre-assigned with tasks.

**Tool Call Format:**
```json
{
  "type": "toolcall",
  "tool": "select_agent",
  "arguments": {
    "taskDescription": "Analyze collected data for patterns and insights",
    "taskId": "task-uuid-2"
  }
}
```

## Streaming Protocol

### Stream Event Types

1. **`data-textDelta`** - For incremental task/agent updates
2. **`agent-response`** - For agent execution results
3. **`summary-report`** - For final summary generation
4. **`task-status-update`** - For task status changes

### Status Values

**Task Status:**
- `pending` - Task created but not started
- `recruiting` - Finding agent for task (deprecated)
- `in-progress` - Task being executed
- `completed` - Task finished successfully
- `failed` - Task execution failed

**Agent Response Status:**
- `in-progress` - Agent is processing
- `completed` - Agent finished successfully
- `failed` - Agent execution failed

## Error Handling

**Error Response Format:**
```json
{
  "type": "error",
  "error": {
    "code": "AGENT_EXECUTION_FAILED",
    "message": "Failed to execute agent: DataCollector",
    "details": {
      "agentId": "agent-uuid-1",
      "taskId": "task-uuid-1",
      "reason": "Connection timeout to data source"
    }
  }
}
```

**Error Codes:**
- `TASK_DECOMPOSITION_FAILED` - Failed to break down project into tasks
- `AGENT_SELECTION_FAILED` - Failed to assign agent to task
- `AGENT_EXECUTION_FAILED` - Agent execution error
- `BATCH_EXECUTION_FAILED` - Multiple agents failed
- `SUMMARY_GENERATION_FAILED` - Failed to generate summary

## Implementation Notes

### Python Agent Requirements

1. **Task Decomposition:**
   - Analyze project title/description using LLM
   - Generate 3-8 meaningful, actionable tasks
   - Assign appropriate specialized agents to each task
   - Stream tasks incrementally for better UX

2. **Agent Execution:**
   - Execute agents in parallel when possible
   - Stream real-time progress updates
   - Generate realistic, task-specific responses
   - Handle failures gracefully with retry logic

3. **Response Streaming:**
   - Use Server-Sent Events (SSE) or WebSocket for real-time updates
   - Send incremental content updates every 100-500ms
   - Include timestamps for all events

### Data Constraints

| Field | Maximum Length | Notes |
|-------|---------------|-------|
| Agent Name | 15 characters | Will be truncated if longer |
| Agent Description | 10 words | Brief, action-oriented |
| Task Title | 50 characters | Clear and concise |
| Task Description | 200 characters | Detailed explanation |
| Capabilities | 3 items | Exactly 3, not more or less |
| Response Content | Unlimited | Stream in chunks |

### Performance Guidelines

- Task streaming delay: 200ms between tasks (matches create-canvas tool)
- Response streaming rate: 30-50 chars/second
- Batch execution timeout: 60 seconds total
- Individual agent timeout: 15 seconds
- Message format: Direct `data-textDelta` (not nested `artifact-update`)

## Complete Message Flow Examples

### Scenario 1: Agent-Initiated Canvas Creation

**User Message:**
```json
{
  "role": "user",
  "content": "I need to build a web scraping system to monitor competitor prices"
}
```

**Python Agent Analysis:**
The agent detects this is a complex project requiring planning and decides to create a canvas.

**Step 1: Agent Invokes Canvas Creation Tool**
```json
{
  "type": "toolcall_initiated",
  "toolcall": {
    "id": "toolcall-001",
    "function": "create_canvas",
    "arguments": {
      "title": "Competitor Price Monitoring System",
      "tasks": [
        {
          "id": "task-001",
          "title": "Setup Web Scraping Infrastructure",
          "description": "Configure scraping framework and proxy rotation",
          "status": "pending",
          "assignedAgent": {
            "id": "agent-001",
            "name": "ScraperSetup",
            "description": "Infrastructure and configuration specialist",
            "capabilities": ["Infrastructure", "Configuration", "Security"],
            "pricingUsdt": 0.75,
            "walletAddress": "0x1234...abcd"
          }
        },
        {
          "id": "task-002",
          "title": "Identify Target Websites",
          "description": "Research and map competitor websites and price locations",
          "status": "pending",
          "assignedAgent": {
            "id": "agent-002",
            "name": "WebAnalyzer",
            "description": "Website structure and pattern analyzer",
            "capabilities": ["Analysis", "Mapping", "Research"],
            "pricingUsdt": 0.50,
            "walletAddress": "0x5678...efgh"
          }
        },
        {
          "id": "task-003",
          "title": "Build Scraping Logic",
          "description": "Implement scrapers for each competitor site",
          "status": "pending",
          "assignedAgent": {
            "id": "agent-003",
            "name": "ScraperDev",
            "description": "Scraping logic implementation expert",
            "capabilities": ["Development", "Parsing", "Extraction"],
            "pricingUsdt": 1.25,
            "walletAddress": "0x9abc...ijkl"
          }
        },
        {
          "id": "task-004",
          "title": "Create Data Pipeline",
          "description": "Build pipeline for data cleaning and storage",
          "status": "pending",
          "assignedAgent": {
            "id": "agent-004",
            "name": "DataPipeline",
            "description": "Data processing and storage architect",
            "capabilities": ["ETL", "Database", "Processing"],
            "pricingUsdt": 1.00,
            "walletAddress": "0xdef0...mnop"
          }
        }
      ]
    }
  }
}
```

**Step 2: Python Agent Streams Tasks**
For each task, the Python agent sends A2A artifact-update messages:

```json
// First task stream
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"newTask\":{\"id\":\"task-001\",\"title\":\"Setup Web Scraping Infrastructure\",\"description\":\"Configure scraping framework and proxy rotation\",\"status\":\"pending\",\"assignedAgent\":{\"id\":\"agent-001\",\"name\":\"ScraperSetup\",\"description\":\"Infrastructure and configuration specialist\",\"capabilities\":[\"Infrastructure\",\"Configuration\",\"Security\"],\"pricingUsdt\":0.75,\"walletAddress\":\"0x1234...abcd\"}}}"
      }
    ]
  }
}

// Second task stream (after 200ms delay)
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"newTask\":{\"id\":\"task-002\",\"title\":\"Identify Target Websites\",\"description\":\"Research and map competitor websites and price locations\",\"status\":\"pending\",\"assignedAgent\":{\"id\":\"agent-002\",\"name\":\"WebAnalyzer\",\"description\":\"Website structure and pattern analyzer\",\"capabilities\":[\"Analysis\",\"Mapping\",\"Research\"],\"pricingUsdt\":0.50,\"walletAddress\":\"0x5678...efgh\"}}}"
      }
    ]
  }
}
// ... continues for all tasks
```

**Step 3: Agent Confirms Canvas Creation**
```json
{
  "type": "message",
  "role": "assistant",
  "content": "I've created a project canvas for your competitor price monitoring system with 4 key tasks:\n\n1. **Setup Web Scraping Infrastructure** - Configure the technical foundation\n2. **Identify Target Websites** - Map competitor sites and price locations\n3. **Build Scraping Logic** - Implement specific scrapers\n4. **Create Data Pipeline** - Process and store the data\n\nEach task has been assigned a specialized agent. You can review the plan in the canvas and execute all agents when ready. The total cost will be 3.50 USDT for all agents."
}
```

### Scenario 2: Batch Agent Execution

**User Action:** Clicks "Execute All Agents" button in canvas

**Step 1: Frontend Sends Execution Request**
```json
{
  "type": "toolcall",
  "tool": "execute_all_agents",
  "arguments": {
    "canvasId": "canvas-123",
    "agents": [
      {
        "id": "agent-001",
        "name": "ScraperSetup",
        "taskId": "task-001",
        "capabilities": ["Infrastructure", "Configuration", "Security"],
        "pricingUsdt": 0.75
      },
      {
        "id": "agent-002",
        "name": "WebAnalyzer",
        "taskId": "task-002",
        "capabilities": ["Analysis", "Mapping", "Research"],
        "pricingUsdt": 0.50
      },
      {
        "id": "agent-003",
        "name": "ScraperDev",
        "taskId": "task-003",
        "capabilities": ["Development", "Parsing", "Extraction"],
        "pricingUsdt": 1.25
      },
      {
        "id": "agent-004",
        "name": "DataPipeline",
        "taskId": "task-004",
        "capabilities": ["ETL", "Database", "Processing"],
        "pricingUsdt": 1.00
      }
    ],
    "tasks": [
      {"id": "task-001", "title": "Setup Web Scraping Infrastructure"},
      {"id": "task-002", "title": "Identify Target Websites"},
      {"id": "task-003", "title": "Build Scraping Logic"},
      {"id": "task-004", "title": "Create Data Pipeline"}
    ],
    "totalCostUsdt": 3.50,
    "executionMode": "parallel"
  }
}
```

**Step 2: Python Agent Orchestrates Execution**
The Python agent executes agents in parallel and streams updates:

```json
// Agent 1 starts (A2A format)
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"agentResponse\":{\"agentId\":\"agent-001\",\"taskId\":\"task-001\",\"status\":\"in-progress\",\"content\":\"Initializing scraping infrastructure setup...\",\"timestamp\":\"2024-01-20T10:30:00Z\"}}"
      }
    ]
  }
}

// Agent 2 starts (parallel)
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"agentResponse\":{\"agentId\":\"agent-002\",\"taskId\":\"task-002\",\"status\":\"in-progress\",\"content\":\"Analyzing competitor websites...\",\"timestamp\":\"2024-01-20T10:30:01Z\"}}"
      }
    ]
  }
}

// Agent 1 progress update (streaming)
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"agentResponse\":{\"agentId\":\"agent-001\",\"taskId\":\"task-001\",\"status\":\"in-progress\",\"content\":\"Initializing scraping infrastructure setup...\\n✓ Configured Scrapy framework\\n✓ Set up proxy rotation (50 proxies)\\n✓ Implemented rate limiting\\n→ Testing connection stability...\",\"timestamp\":\"2024-01-20T10:30:15Z\"}}"
      }
    ]
  }
}

// Agent 1 completes
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"agentResponse\":{\"agentId\":\"agent-001\",\"taskId\":\"task-001\",\"status\":\"completed\",\"content\":\"Infrastructure setup completed successfully:\\n✓ Scrapy framework configured\\n✓ 50 rotating proxies active\\n✓ Rate limiting: 2 req/sec per domain\\n✓ Error handling and retry logic implemented\\n✓ Connection pool optimized\\n\\nSystem ready for scraping operations.\",\"timestamp\":\"2024-01-20T10:31:00Z\"}}"
      }
    ]
  }
}

// Continue for all agents...
```

### Scenario 3: Summary Generation

**After all agents complete, Python agent automatically generates summary:**

```json
{
  "kind": "artifact-update",
  "artifact": {
    "kind": "canvas",
    "parts": [
      {
        "kind": "text",
        "text": "{\"summary\":{\"id\":\"summary-001\",\"content\":\"## Executive Summary: Competitor Price Monitoring System\\n\\n### Project Status\\n✅ All 4 tasks completed successfully (100%)\\n⏱️ Total execution time: 5 minutes 32 seconds\\n💰 Total cost: 3.50 USDT\\n\\n### Key Accomplishments\\n\\n**1. Infrastructure Setup (ScraperSetup)**\\n- Configured Scrapy framework with 50 rotating proxies\\n- Implemented rate limiting and error handling\\n- Set up distributed scraping capability\\n\\n**2. Website Analysis (WebAnalyzer)**\\n- Identified 12 competitor websites\\n- Mapped 847 product price locations\\n- Documented site-specific scraping patterns\\n\\n**3. Scraper Implementation (ScraperDev)**\\n- Built custom scrapers for all 12 sites\\n- Implemented dynamic content handling\\n- Added anti-detection measures\\n\\n**4. Data Pipeline (DataPipeline)**\\n- PostgreSQL database configured\\n- Real-time data cleaning pipeline\\n- Automated price change detection\\n- Daily report generation system\\n\\n### System Capabilities\\n- Monitor 10,000+ products across 12 sites\\n- Update frequency: Every 6 hours\\n- Price change detection: < 1% threshold\\n- Historical data retention: 90 days\\n\\n### Next Steps\\n1. Deploy to production environment\\n2. Set up monitoring dashboards\\n3. Configure alert thresholds\\n4. Schedule first production run\\n\\n### Technical Metrics\\n- Scraping success rate: 98.5%\\n- Average response time: 1.2s\\n- Data accuracy: 99.7%\\n- System uptime target: 99.9%\\n\\nGenerated: 2024-01-20T10:35:00Z\\nOrchestrated by: Python Agent v2.0\",\"timestamp\":\"2024-01-20T10:35:00Z\"}}"
      }
    ]
  }
}
```

## Python Agent Implementation Example

```python
import asyncio
import json
import uuid
from datetime import datetime
from typing import List, Dict, Any

class CanvasOrchestrator:
    def __init__(self, a2a_client):
        self.a2a_client = a2a_client
        self.active_agents = {}
    
    async def detect_planning_need(self, user_message: str) -> bool:
        """Analyze if user message requires project planning"""
        planning_indicators = [
            'build', 'create', 'develop', 'implement',
            'system', 'project', 'plan', 'need to',
            'want to', 'help me', 'multiple steps'
        ]
        return any(indicator in user_message.lower() for indicator in planning_indicators)
    
    async def create_canvas_with_tasks(self, project_description: str):
        """Create canvas with task decomposition and pre-assigned agents"""
        
        # Analyze project and create tasks
        tasks = await self.decompose_project(project_description)
        
        # Assign agents to tasks
        tasks_with_agents = await self.assign_agents_to_tasks(tasks)
        
        # Send canvas creation tool call
        canvas_message = {
            "type": "toolcall_initiated",
            "toolcall": {
                "id": f"toolcall-{uuid.uuid4()}",
                "function": "create_canvas",
                "arguments": {
                    "title": self.extract_project_title(project_description),
                    "tasks": tasks_with_agents
                }
            }
        }
        
        # Send canvas creation tool call first
        await self.a2a_client.send(canvas_message)
        
        # Stream each task individually for visual effect
        for task in tasks_with_agents:
            await asyncio.sleep(0.2)  # 200ms delay (matches create-canvas tool)
            await self.stream_task(task)
    
    async def stream_task(self, task: Dict[str, Any]):
        """Stream individual task to canvas"""
        message = {
            "kind": "artifact-update",
            "artifact": {
                "kind": "canvas",
                "parts": [
                    {
                        "kind": "text",
                        "text": json.dumps({"newTask": task})
                    }
                ]
            }
        }
        await self.a2a_client.send(message)
    
    async def execute_agents_batch(self, agents: List[Dict], tasks: List[Dict]):
        """Execute multiple agents in parallel"""
        
        # Start all agents
        agent_tasks = []
        for agent in agents:
            task = next((t for t in tasks if t['id'] == agent.get('taskId')), None)
            if task:
                agent_tasks.append(
                    self.execute_single_agent(agent, task)
                )
        
        # Run in parallel
        results = await asyncio.gather(*agent_tasks)
        
        # Generate summary
        await self.generate_summary(agents, tasks, results)
    
    async def execute_single_agent(self, agent: Dict, task: Dict):
        """Execute a single agent and stream updates"""
        
        # Start execution
        await self.stream_agent_update(
            agent['id'], task['id'], 'in-progress',
            f"Starting {agent['name']} for {task['title']}..."
        )
        
        # Simulate agent work with progress updates
        for progress in range(0, 101, 20):
            await asyncio.sleep(1)
            await self.stream_agent_update(
                agent['id'], task['id'], 'in-progress',
                f"Progress: {progress}%\n{self.generate_progress_details(agent, progress)}"
            )
        
        # Complete
        final_result = self.generate_agent_result(agent, task)
        await self.stream_agent_update(
            agent['id'], task['id'], 'completed',
            final_result
        )
        
        return final_result
    
    async def stream_agent_update(self, agent_id: str, task_id: str, 
                                   status: str, content: str):
        """Stream agent execution update"""
        message = {
            "kind": "artifact-update",
            "artifact": {
                "kind": "canvas",
                "parts": [
                    {
                        "kind": "text",
                        "text": json.dumps({
                            "agentResponse": {
                                "agentId": agent_id,
                                "taskId": task_id,
                                "status": status,
                                "content": content,
                                "timestamp": datetime.utcnow().isoformat() + 'Z'
                            }
                        })
                    }
                ]
            }
        }
        await self.a2a_client.send(message)

# Usage in main agent loop
async def handle_user_message(user_message: str, orchestrator: CanvasOrchestrator):
    """Main agent message handler"""
    
    # Check if planning is needed
    if await orchestrator.detect_planning_need(user_message):
        # Create canvas automatically
        await orchestrator.create_canvas_with_tasks(user_message)
        
        # Respond to user
        return {
            "role": "assistant",
            "content": "I've created a project canvas with a detailed plan. "
                      "You can review the tasks and execute all agents when ready."
        }
    else:
        # Normal conversation flow
        return await handle_regular_conversation(user_message)
```

## Testing Checklist

- [ ] Agent detects when canvas creation is needed
- [ ] Task decomposition returns tasks with pre-assigned agents
- [ ] Agent names are <= 15 characters
- [ ] Tasks stream individually with 200ms delays (not 800ms)
- [ ] Batch execution processes all agents in parallel
- [ ] Agent responses stream incrementally with progress
- [ ] Status updates (pending → in-progress → completed)
- [ ] Error handling works for failed agents
- [ ] Summary generation includes all responses
- [ ] Total cost calculation is accurate
- [ ] Canvas saves and loads correctly
- [ ] Transaction dialog shows all agents
- [ ] Execute All Agents button triggers batch execution
- [ ] Messages use A2A `artifact-update` format
- [ ] JSON data is in `text` parts within artifact
- [ ] Canvas `kind` is specified in artifact
- [ ] Parallel execution completes within timeout

## Common Integration Issues and Solutions

### Issue 1: Tasks Not Appearing in Canvas
**Symptom:** Canvas creates but remains empty
**Solution:** Ensure `newTask` format matches exactly:
```json
{"newTask": {...}}  // Correct
{"task": {...}}     // Wrong
{"tasks": [...]}    // Wrong for streaming
```

### Issue 2: Agents Not Linked to Tasks
**Symptom:** Agents appear but not connected to tasks in flow
**Solution:** Include `taskId` in agent and agent has `assignedAgent` in task

### Issue 3: Responses Not Updating UI
**Symptom:** Agent executes but UI doesn't update
**Solution:** Ensure `agentId` matches and status changes are sent

### Issue 4: Summary Not Displaying
**Symptom:** Summary generated but not shown
**Solution:** Use `summary` key in data-textDelta, not `summary-report` type

### Issue 5: Wrong Delay Between Tasks
**Symptom:** Tasks stream too slowly
**Solution:** Use 200ms delay, not 800ms (matches create-canvas tool implementation)

### Issue 6: Incorrect Message Format
**Symptom:** Messages not reaching canvas
**Solution:** Use A2A standard `artifact-update` format with `text` parts

### Issue 7: Wrong Protocol Layer
**Symptom:** Direct `data-textDelta` not working
**Solution:** Always use A2A `artifact-update` format - the provider converts automatically