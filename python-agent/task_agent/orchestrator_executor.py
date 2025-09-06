"""Task Agent Executor - A2A-compliant agent for task decomposition and execution with real OpenAI integration"""

import asyncio
import json
import uuid
import httpx
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, AsyncGenerator

from a2a.server.agent_execution import RequestContext, AgentExecutor
from a2a.server.events import EventQueue
from a2a.types import Artifact, Part, TaskArtifactUpdateEvent, TaskStatusUpdateEvent, AgentCard, MessageSendParams, SendMessageRequest, TaskState, AgentCapabilities, AgentSkill
from a2a.utils import new_agent_text_message, new_task
from a2a.server.tasks import TaskUpdater
from a2a.client import A2AClient
from openai import AsyncOpenAI
from common import log_error, Colors, log_a2a_api_call, log_a2a_protocol, create_agent_a2a_server, run_server, log_a2a_function_call, log_agent_activity, log_agent_request, log_agent_response
import dotenv
dotenv.load_dotenv()


class Orchestrator(AgentExecutor):
    """A2A-compliant agent executor for task decomposition and job execution with real OpenAI integration"""

    SYSTEM_INSTRUCTION = """
    You are an intelligent task decomposition agent that can analyze user requests and create structured, actionable tasks.
    
    Available specialized A2A agents for task execution:
    - trending: For finding trending topics and current events
    - analyzer: For analyzing specific topics or trends
    - host: For comprehensive analysis with quantitative data
    - market_analysis: For comprehensive financial market analysis and detailed reports

    Your role is to:
    1. Understand user requests and break them down into specific, actionable tasks
    2. Create detailed task descriptions and assign appropriate agents
    3. Generate realistic project structures based on the type of request
    4. Provide clear titles, descriptions, and agent assignments for each task

    For task generation, analyze the user's request and create 2-5 concrete, executable tasks with:
    - Clear titles and detailed descriptions
    - Appropriate specialized agent assignments
    - Logical ordering and dependencies
    - Realistic effort estimates and capabilities

    For job execution, coordinate with the assigned agents to complete the work.
    """

    def __init__(self, openai_api_key: str = None):
        super().__init__()
        self.job_counter = 0
        self.agent_counter = 0
        self.tasks_store = {}  # Store task data by taskId
        self.webhook_base_url = "http://localhost:3000"  # Default Next.js URL
        
        # Initialize OpenAI client for intelligent task generation
        self.openai_client = AsyncOpenAI(api_key=openai_api_key) if openai_api_key else None
        
        # Define available A2A agents for task execution
        self.available_agents = {
            "trending": "http://localhost:10020",
            "analyzer": "http://localhost:10021", 
            "host": "http://localhost:10022",
            # "market_analysis": "http://localhost:10023"
        }
        
        self._agent_info_cache: dict[str, dict[str, Any] | None] = {}
        self.default_timeout = 240.0
    
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Dispatch by request type: generate tasks or execute jobs."""
        log_a2a_function_call("execute", f"Task: {context.task_id}")

        print(f"[TaskAgent] Execute called - Task: {context.task_id}")

        try:
            # Extract raw user message text
            user_message = self._extract_user_message(context)
            log_agent_request("Orchestrator", user_message, context.context_id)
            print(f"[TaskAgent] Incoming message: '{user_message}'")

            # Check if this is a blocking request by examining the context
            is_blocking_request = self._is_blocking_request(context)
            print(f"[TaskAgent] Request type: {'blocking' if is_blocking_request else 'non-blocking'}")

            # Branch: job execution vs task generation
            if self._is_job_execution_request(user_message):
                log_agent_activity("Orchestrator", "Detected job execution request")
                print("[TaskAgent] Detected job execution request")
                await self._execute_jobs_async(context, user_message)

                # Also mark the A2A task as completed for blocking clients
                await event_queue.enqueue_event(TaskStatusUpdateEvent(
                    taskId=context.task_id,
                    contextId=context.context_id,
                    status={"state": "completed"},
                    final=True
                ))
            else:
                log_agent_activity("Orchestrator", "Detected task generation request")
                print("[TaskAgent] Detected task generation request")
                if is_blocking_request:
                    # For blocking requests, return data synchronously through the task result
                    await self._generate_tasks_blocking(context, user_message, event_queue)
                else:
                    # For non-blocking requests, use the webhook pattern
                    await self._generate_tasks_response(context, user_message, event_queue)
                print("[TaskAgent] Task generation completed - response sent to A2A client")
        except Exception as e:
            log_error(f"Error in execute: {e}")
            print(f"[TaskAgent] Error in execute: {e}")
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "failed"},
                final=True
            ))

    def _generate_task_data(self, job, i, user_message, context):
        """Helper function to generate task data."""
        job_id = str(uuid.uuid4())
        return {
            "type": "task",
            "task": {
                "id": job_id,
                "title": job.get("title", f"Task {i+1}"),
                "description": job.get("description", f"Generated task {i+1} for: {user_message}"),
                "status": "submitted",
                "assignedAgent": job.get("assignedAgent"),
                "contextId": context.context_id,
                "priority": "medium",
                "createdAt": datetime.utcnow().isoformat() + 'Z',
                "webhookToken": str(uuid.uuid4()),
                "order": i,
                "metadata": {
                    "source": "a2a_agent",
                    "userRequest": user_message,
                    "generatedAt": datetime.utcnow().isoformat() + 'Z'
                }
            }
        }

    async def _generate_tasks_response(self, context: RequestContext, user_message: str,
                                     event_queue: EventQueue) -> None:
        """Generate tasks using OpenAI and return them in A2A-compliant format for client-side processing"""
        log_a2a_function_call("_generate_tasks_response", f"User message: {user_message}")
        print(f"[TaskAgent] Generating A2A-compliant tasks using OpenAI for: '{user_message}'")

        try:
            # Generate intelligent tasks using OpenAI
            jobs = await self._generate_jobs_with_openai(user_message)

            # Create data parts for each task in A2A-compliant format
            data_parts = [Part(kind="data", data=self._generate_task_data(job, i, user_message, context)) for i, job in enumerate(jobs)]

            # Create an artifact containing all task data
            artifact = Artifact(
                artifactId=str(uuid.uuid4()),
                parts=data_parts  # Include only the data parts with task objects
            )
            
            # Send the artifact with task data via TaskArtifactUpdateEvent
            await event_queue.enqueue_event(TaskArtifactUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                artifact=artifact,
                final=False  # Not final yet, we'll send completion status next
            ))
            
            print(f"[TaskAgent] ✅ Sent TaskArtifactUpdateEvent with {len(data_parts)} tasks")
            
            # Send a human-readable message for the UI
            response_message = new_agent_text_message(
                f"I've analyzed your request and created {len(jobs)} structured tasks for execution. Each task has been assigned to a specialized agent and is ready for processing."
            )
            await event_queue.enqueue_event(response_message)
            
            # Send final completion status
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "completed"},
                final=True
            ))

            print(f"[TaskAgent] ✅ Successfully generated {len(jobs)} A2A-compliant tasks using OpenAI")
            log_agent_response("Orchestrator", "Tasks generated successfully", context.context_id)

        except Exception as e:
            log_error(f"Error generating tasks: {e}")
            print(f"[TaskAgent] ❌ Error generating tasks: {e}")
            import traceback
            traceback.print_exc()
            raise

    async def _generate_tasks_blocking(self, context: RequestContext, user_message: str,
                                     event_queue: EventQueue) -> None:
        """Generate tasks for blocking requests using OpenAI - return data synchronously"""
        log_a2a_function_call("_generate_tasks_blocking", f"User message: {user_message}")
        print(f"[TaskAgent] Generating tasks for blocking request using OpenAI: '{user_message}'")

        try:
            # Generate intelligent tasks using OpenAI
            jobs = await self._generate_jobs_with_openai(user_message)

            # Create data parts for each task in A2A-compliant format
            data_parts = [Part(kind="data", data=self._generate_task_data(job, i, user_message, context)) for i, job in enumerate(jobs)]

            # For blocking requests, we need to return the tasks in the final response
            artifact = Artifact(
                artifactId=str(uuid.uuid4()),
                parts=data_parts  # Include only the data parts with task objects
            )
            
            # Send the artifact with task data via TaskArtifactUpdateEvent
            await event_queue.enqueue_event(TaskArtifactUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                artifact=artifact,
                final=True  # This is final for blocking requests
            ))
            
            print(f"[TaskAgent] ✅ Sent blocking TaskArtifactUpdateEvent with {len(data_parts)} tasks using OpenAI")
            log_agent_response("Orchestrator", "Blocking tasks generated successfully", context.context_id)

        except Exception as e:
            log_error(f"Error generating blocking tasks: {e}")
            print(f"[TaskAgent] ❌ Error generating blocking tasks: {e}")
            import traceback
            traceback.print_exc()
            # Send error status for blocking requests
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "failed"},
                final=True
            ))
            raise

    async def _execute_jobs_async(self, context: RequestContext, user_message: str) -> None:
        """Execute jobs for a given task using real A2A agent calls with webhook pattern for status updates"""
        log_a2a_function_call("_execute_jobs_async", "Executing jobs asynchronously")
        print(f"[TaskAgent] Executing jobs asynchronously with real A2A agents")

        try:
            # Extract webhook configuration from context
            webhook_config = None
            if hasattr(context, 'message') and context.message:
                if hasattr(context.message, 'configuration') and context.message.configuration:
                    webhook_config = context.message.configuration.get('pushNotificationConfig')

            if not webhook_config:
                print(f"[TaskAgent] No webhook configuration found for execution updates")
                return

            webhook_url = webhook_config.get('url')
            webhook_token = webhook_config.get('token')

            if not webhook_url or not webhook_token:
                print(f"[TaskAgent] Incomplete webhook configuration for execution updates")
                return

            # Extract task ID from user message or use context task_id
            task_id = context.task_id

            # Send initial execution webhook
            initial_task_data = {
                "id": task_id,
                "contextId": context.context_id,
                "status": {"state": "working", "message": "Starting job execution with A2A agents"},
                "artifacts": []
            }
            self._call_webhook(webhook_url, webhook_token, initial_task_data)

            # Parse job execution request to get task details
            try:
                job_data = json.loads(user_message)
                tasks = job_data.get("tasks", [])
            except:
                print(f"[TaskAgent] Could not parse job execution request, using fallback")
                tasks = []

            # Execute each task using real A2A agents
            for i, task in enumerate(tasks):
                task_title = task.get("title", f"Task {i+1}")
                task_description = task.get("description", "")
                assigned_agent = task.get("assignedAgent", {})
                
                # Send job start webhook
                job_start_data = {
                    "id": f"{task_id}-job-{i}",
                    "contextId": context.context_id,
                    "status": {"state": "working", "message": f"Executing: {task_title}"},
                    "artifacts": []
                }
                self._call_webhook(webhook_url, webhook_token, job_start_data)

                # Execute task using appropriate A2A agent
                result = await self._execute_task_with_agent(task_description, assigned_agent)

                # Send job completion webhook with real results
                job_complete_data = {
                    "id": f"{task_id}-job-{i}",
                    "contextId": context.context_id,
                    "status": {"state": "completed", "message": f"Completed: {task_title}"},
                    "artifacts": [{
                        "artifactId": str(uuid.uuid4()),
                        "parts": [{
                            "kind": "data",
                            "data": {
                                "jobId": f"{task_id}-job-{i}",
                                "result": result,
                                "timestamp": datetime.utcnow().isoformat() + 'Z'
                            }
                        }]
                    }]
                }
                self._call_webhook(webhook_url, webhook_token, job_complete_data)

            # Send final completion webhook
            final_task_data = {
                "id": task_id,
                "contextId": context.context_id,
                "status": {"state": "completed", "message": f"Successfully executed {len(tasks)} jobs with A2A agents"},
                "artifacts": []
            }
            self._call_webhook(webhook_url, webhook_token, final_task_data)

            print(f"[TaskAgent] Job execution completed with real A2A agents and webhook notifications")
            log_agent_response("Orchestrator", "Jobs executed successfully", context.context_id)

        except Exception as e:
            log_error(f"Error in async job execution: {e}")
            print(f"[TaskAgent] Error in async job execution: {e}")
            raise

    async def _execute_task_with_agent(self, task_description: str, assigned_agent: Dict[str, Any]) -> str:
        """Execute a task using the appropriate A2A agent"""
        try:
            # Determine which A2A agent to use based on task description and assigned agent
            agent_name = self._determine_best_agent(task_description, assigned_agent)
            
            if agent_name not in self.available_agents:
                return f"Agent {agent_name} not available. Task description: {task_description}"
            
            agent_url = self.available_agents[agent_name]
            
            # Use the real A2A client to execute the task
            result = await self._call_a2a_agent(agent_url, task_description)
            return result
            
        except Exception as e:
            print(f"[TaskAgent] Error executing task with agent: {e}")
            return f"Error executing task: {str(e)}"

    async def _call_a2a_agent(self, agent_url: str, message: str) -> str:
        """Call a real A2A agent using the same logic as ClientAgent"""
        print(f"[TaskAgent] Calling A2A agent at {agent_url} with message: {message[:100]}...")
        
        timeout_config = httpx.Timeout(
            timeout=self.default_timeout,
            connect=10.0,
            read=self.default_timeout,
            write=10.0,
            pool=5.0,
        )

        try:
            async with httpx.AsyncClient(timeout=timeout_config) as httpx_client:
                # Fetch agent card
                if agent_url in self._agent_info_cache and self._agent_info_cache[agent_url] is not None:
                    agent_card_data = self._agent_info_cache[agent_url]
                else:
                    agent_card_url = f"{agent_url}/.well-known/agent.json"
                    
                    try:
                        agent_card_response = await httpx_client.get(agent_card_url)
                        
                        if agent_card_response.status_code != 200:
                            return f"Error: Failed to fetch agent card from {agent_url}. Status: {agent_card_response.status_code}"
                        
                        agent_card_data = self._agent_info_cache[agent_url] = agent_card_response.json()
                        
                    except httpx.ConnectError as e:
                        return f"Error: Cannot connect to agent at {agent_url}. Please ensure the agent server is running."
                    except httpx.TimeoutException as e:
                        return f"Error: Timeout connecting to agent at {agent_url}. Please check if the agent server is responsive."
                    except Exception as e:
                        return f"Error: Unexpected error connecting to agent at {agent_url}: {str(e)}"

                agent_card = AgentCard(**agent_card_data)
                client = A2AClient(httpx_client=httpx_client, agent_card=agent_card)

                # Create message payload
                message_id = uuid.uuid4().hex
                send_message_payload = {
                    "message": {
                        "role": "user",
                        "parts": [{"kind": "text", "text": message}],
                        "messageId": message_id,
                    }
                }

                request_id = str(uuid.uuid4())
                request = SendMessageRequest(id=request_id, params=MessageSendParams(**send_message_payload))
                
                try:
                    response = await client.send_message(request)
                    response_dict = response.model_dump(mode="json", exclude_none=True)

                    if "result" in response_dict and "artifacts" in response_dict["result"]:
                        artifacts = response_dict["result"]["artifacts"]
                        
                        for i, artifact in enumerate(artifacts):
                            if "parts" in artifact:
                                parts = artifact["parts"]
                                
                                for j, part in enumerate(parts):
                                    if "text" in part:
                                        text_content = part["text"]
                                        return text_content

                    return json.dumps(response_dict, indent=2)
                    
                except Exception as e:
                    return f"Error: Unexpected error sending message to agent at {agent_url}: {str(e)}"
                    
        except Exception as e:
            return f"Error: Failed to create task with agent at {agent_url}: {str(e)}"

    def _determine_best_agent(self, task_description: str, assigned_agent: Dict[str, Any]) -> str:
        """Determine which A2A agent is best suited for the task"""
        task_lower = task_description.lower()
        
        # Check for specific keywords to determine the best agent
        if any(keyword in task_lower for keyword in ["trend", "trending", "current", "popular", "viral"]):
            return "trending"
        elif any(keyword in task_lower for keyword in ["market", "stock", "financial", "investment", "trading"]):
            return "market_analysis"
        elif any(keyword in task_lower for keyword in ["analyze", "analysis", "research", "study"]):
            return "analyzer"
        else:
            return "host"  # Default comprehensive agent

    async def _generate_jobs_with_openai(self, user_message: str) -> List[Dict[str, Any]]:
        """Generate jobs using OpenAI for intelligent task decomposition"""
        if not self.openai_client:
            print(f"[TaskAgent] OpenAI client not available, falling back to rule-based generation")
            return await self._generate_jobs_fallback(user_message)

        print(f"[TaskAgent] Using OpenAI for intelligent task generation")
        
        # Enhanced prompt for better task generation
        prompt = f"""
        You are a professional task decomposition agent. Break down the following user request into 2-5 specific, actionable tasks.

        User Request: "{user_message}"

        For each task, provide:
        1. A clear, concise title
        2. A detailed description of what needs to be done
        3. The most appropriate agent type from: Project Analyst, Frontend Specialist, Backend Engineer, Database Architect, QA Engineer, Travel Planning Specialist, Data Scientist, ML Engineer, E-commerce Developer, Payment Security Specialist, Scraping Specialist, Data Engineer, API Architect, Mobile Developer, DevOps Engineer, Full-Stack Developer

        Return the response as a JSON array of task objects with this structure:
        [
            {{
                "title": "Task Title",
                "description": "Detailed description of the task",
                "assignedAgent": {{
                    "name": "Agent Name",
                    "description": "Agent expertise description",
                    "capabilities": ["skill1", "skill2", "skill3"],
                    "pricingUsdt": 2.5,
                    "rating": 4.8,
                    "completedTasks": 150
                }}
            }}
        ]
        """

        response = await self.openai_client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": self.SYSTEM_INSTRUCTION},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000
        )

        # Parse the OpenAI response
        response_content = response.choices[0].message.content
        print(f"[TaskAgent] OpenAI response length: {len(response_content)}")

        # Try to extract JSON from the response
        # Look for JSON array in the response
        start_idx = response_content.find('[')
        end_idx = response_content.rfind(']') + 1
        
        if start_idx != -1 and end_idx != -1:
            json_str = response_content[start_idx:end_idx]
            jobs = json.loads(json_str)
            
            # Ensure each job has required fields and generate IDs
            for job in jobs:
                if "id" not in job:
                    job["id"] = str(uuid.uuid4())
                if "status" not in job:
                    job["status"] = "submitted"
                
                # Ensure assignedAgent has all required fields
                if "assignedAgent" in job and isinstance(job["assignedAgent"], dict):
                    agent = job["assignedAgent"]
                    if "id" not in agent:
                        agent["id"] = f"agent-{self._next_agent_id()}"
                    if "walletAddress" not in agent:
                        agent["walletAddress"] = f"0x{uuid.uuid4().hex[:40]}"
            
            print(f"[TaskAgent] Successfully generated {len(jobs)} tasks using OpenAI")
            return jobs
        else:
            raise ValueError("No JSON array found in response")
                    

    async def cancel(self) -> None:
        """Cancel the current execution"""
        raise NotImplementedError("Cancellation not supported")

    def _call_webhook(self, url: str, token: str, task_data: Dict[str, Any]) -> bool:
        """Send webhook notification to Next.js application using session token"""
        try:
            payload = {
                "id": task_data["id"],
                "contextId": task_data.get("contextId", "default"),
                "kind": "task",
                "status": task_data["status"],
                "artifacts": task_data.get("artifacts", [])
            }

            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

            print(f"[Webhook] Sending notification for task {task_data['id']} to {url}")
            
            # Use httpx with synchronous client
            with httpx.Client(timeout=10.0) as client:
                response = client.post(url, json=payload, headers=headers)

            if response.status_code == 204:
                print(f"[Webhook] Successfully notified for task {task_data['id']}")
                return True
            else:
                print(f"[Webhook] Failed for task {task_data['id']}: {response.status_code} - {response.text}")
                return False

        except Exception as e:
            print(f"[Webhook] Error sending notification for task {task_data['id']}: {e}")
            return False

    def _extract_user_message(self, context: RequestContext) -> str:
        """Extract the user message from the request context"""
        if hasattr(context, 'message') and context.message:
            if hasattr(context.message, 'parts') and context.message.parts:
                for part in context.message.parts:
                    if hasattr(part, 'root') and part.root:
                        if hasattr(part.root, 'text') and part.root.text:
                            text = part.root.text
                            # Clean up the text by removing client-specific metadata
                            lines = text.split('\n')
                            clean_lines = []
                            for line in lines:
                                # Skip client-specific metadata lines
                                if any(prefix in line for prefix in ['Urgency:', 'Context:', 'CanvasDocumentId:']):
                                    continue
                                if "Current request:" in line:
                                    clean_lines.append(line.split("Current request:")[-1].strip())
                                else:
                                    clean_lines.append(line)
                            return '\n'.join(clean_lines).strip()
        return ""
    
    def _is_job_execution_request(self, message: str) -> bool:
        """Check if the message is requesting job execution"""
        try:
            data = json.loads(message)
            return data.get("type") == "execute_jobs"
        except:
            return False
    
    def _is_blocking_request(self, context: RequestContext) -> bool:
        """Check if this is a blocking request by examining the context"""
        if hasattr(context, 'message') and context.message:
            if hasattr(context.message, 'configuration') and context.message.configuration:
                blocking_value = context.message.configuration.get('blocking', False)
                return blocking_value
        
        # Default to blocking for better compatibility with tool-based clients
        return True

    def _next_agent_id(self) -> int:
        """Get next agent ID for agent assignment"""
        self.agent_counter += 1
        return self.agent_counter

def main():
    """Main function to run the customized client executor as an A2A server."""
    openai_api_key = os.getenv("OPENAI_API_KEY")
    
    if not openai_api_key:
        log_error("OPENAI_API_KEY environment variable not set")
        print(f"{Colors.BOLD}{Colors.FAIL}Error: OPENAI_API_KEY environment variable not set{Colors.ENDC}")
        return

    log_a2a_api_call("main", "Starting main function for A2A server with OpenAI API key")

    client_agent_card = AgentCard(
        name="A2A Orchestrator Agent",
        url="http://localhost:9999",
        description="Orchestrator agent for intelligent task decomposition, project structuring, and job execution using OpenAI and specialized A2A agents",
        version="1.0",
        capabilities=AgentCapabilities(streaming=True),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["application/json"],
        skills=[
            AgentSkill(
                id="orchestrator",
                name="Orchestrator",
                description="Orchestrate intelligent task decomposition and execution using OpenAI and specialized A2A agents",
                tags=["orchestration", "task-management", "ai", "agents", "decomposition"],
                examples=[
                    "Coordinate a multi-step project with several specialized agents",
                    "Orchestrate the execution of a complex workflow using multiple A2A agents",
                    "Manage and assign jobs to the best-suited agent for each task",
                    "Oversee the progress of a project and ensure timely completion",
                    "Integrate OpenAI-powered planning with agent-based execution"
                ],
            )
        ],
    )

    log_a2a_protocol("Agent card created", "→", "main", "A2A server")

    def create_agent():
        log_a2a_function_call("create_agent", "Creating A2A server agent")
        return create_agent_a2a_server(Orchestrator(openai_api_key), client_agent_card)

    asyncio.run(run_server(create_agent, 9999, "Orchestrator"))


if __name__ == "__main__":
    main()