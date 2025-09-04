"""Task Agent Executor - A2A-compliant agent for task decomposition and execution"""

import asyncio
import json
import uuid
import httpx
from datetime import datetime
from typing import Any, Dict, List, Optional

from a2a.server.agent_execution import RequestContext, AgentExecutor
from a2a.server.events import EventQueue
from a2a.types import Artifact, Part, TaskArtifactUpdateEvent, TaskStatusUpdateEvent
from a2a.utils import new_agent_text_message


class TaskAgentExecutor(AgentExecutor):
    """A2A-compliant agent executor for task decomposition and job execution"""

    def __init__(self):
        super().__init__()
        self.job_counter = 0
        self.agent_counter = 0
        self.tasks_store = {}  # Store task data by taskId
        self.webhook_base_url = "http://localhost:3000"  # Default Next.js URL
    
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Execute as stateless task generator - return tasks in single response"""

        print(f"[TaskAgent] Starting stateless task generation - Task: {context.task_id}")

        try:
            # Extract user message
            user_message = self._extract_user_message(context)
            print(f"[TaskAgent] Processing: '{user_message}'")

            # Send initial ACK via event queue (immediate response)
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "working"},
                final=False
            ))

            # Generate tasks based on user message and return in single response
            await self._generate_tasks_response(context, user_message, event_queue)

            # For task generation, we don't send completion status - client handles storage
            print(f"[TaskAgent] Task generation completed - client will handle storage")

        except Exception as e:
            print(f"[TaskAgent] Error in execute: {e}")
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "failed"},
                final=True
            ))

    async def _generate_tasks_response(self, context: RequestContext, user_message: str,
                                     event_queue: EventQueue) -> None:
        """Generate tasks and return them in A2A-compliant format for client-side processing"""
        print(f"[TaskAgent] Generating A2A-compliant tasks for: '{user_message}'")

        try:
            # Add system prompt context to improve task generation
            enhanced_message = self._enhance_user_message_with_system_prompt(user_message)
            print(f"[TaskAgent] Enhanced message length: {len(enhanced_message)} chars")

            # Generate sample jobs based on ORIGINAL user message for keyword detection
            jobs = await self._generate_jobs(user_message)

            # Create text part for human-readable confirmation
            text_part = Part(
                kind="text",
                text=f"I've analyzed your request '{user_message}' and created {len(jobs)} structured tasks for execution. Each task has been assigned to a specialized agent and is ready for processing."
            )

            # Create data parts for each task in A2A-compliant format
            data_parts = []
            for i, job in enumerate(jobs):
                # Ensure job has proper ID
                job_id = job.get("id") or f"task-{str(uuid.uuid4())}"
                
                # A2A-compliant task data structure that matches our extraction logic
                task_data = {
                    "type": "task",  # This is the key our extraction looks for
                    "task": {
                        "id": job_id,
                        "title": job.get("title", f"Task {i+1}"),
                        "description": job.get("description", f"Generated task {i+1} for: {user_message}"),
                        "status": "submitted",  # Always start as submitted
                        "assignedAgent": job.get("assignedAgent"),
                        "contextId": context.context_id,
                        "priority": "medium",
                        "createdAt": datetime.utcnow().isoformat() + 'Z',
                        "webhookToken": str(uuid.uuid4()),  # Generate token for webhook auth
                        "order": i,
                        "metadata": {
                            "source": "a2a_agent",
                            "userRequest": user_message,
                            "generatedAt": datetime.utcnow().isoformat() + 'Z'
                        }
                    }
                }
                
                print(f"[TaskAgent] 📝 Generated task {i+1}: {task_data['task']['title']} (ID: {job_id})")
                
                data_parts.append(Part(
                    kind="data",
                    data=task_data
                ))

            # Combine all parts into single message
            all_parts = [text_part] + data_parts

            # Create and enqueue the response message using A2A-compliant format
            response_message = new_agent_text_message(
                f"Successfully created {len(jobs)} tasks for your request. The system will now create a canvas to track their progress and execution."
            )

            # Replace the message parts with our structured task data
            response_message.parts = all_parts

            # Create artifacts with task data for immediate inclusion in Task response
            artifacts = []
            for i, data_part in enumerate(data_parts):
                artifact = Artifact(
                    artifactId=f"task-artifact-{i}",
                    parts=[data_part]
                )
                artifacts.append(artifact)
                
                # Also send as event for real-time updates
                await event_queue.enqueue_event(TaskArtifactUpdateEvent(
                    taskId=context.task_id,
                    contextId=context.context_id,
                    artifact=artifact,
                    lastChunk=(i == len(data_parts) - 1)
                ))
            
            # Enqueue the response message for the task history
            await event_queue.enqueue_event(response_message)
            
            # Send a completion status with both the response message AND artifacts
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={
                    "state": "completed",
                    "message": response_message,  # Include the response message in status
                    "artifacts": artifacts  # Include artifacts in status for immediate access
                },
                final=True
            ))

            print(f"[TaskAgent] ✅ Successfully generated {len(jobs)} A2A-compliant tasks")
            print(f"[TaskAgent] 📋 Task IDs: {[job.get('id', f'task-{i}') for i, job in enumerate(jobs)]}")
            print(f"[TaskAgent] 📦 Message parts: {len(all_parts)} (1 text + {len(data_parts)} data parts)")

        except Exception as e:
            print(f"[TaskAgent] ❌ Error generating tasks: {e}")
            import traceback
            traceback.print_exc()
            raise

    async def _send_task_webhooks(self, context: RequestContext, jobs: List[Dict]) -> None:
        """Send webhooks for each task to store them in the Next.js database"""
        try:
            # Extract webhook configuration from context
            webhook_config = None
            if hasattr(context, 'message') and context.message:
                if hasattr(context.message, 'configuration') and context.message.configuration:
                    webhook_config = context.message.configuration.get('pushNotificationConfig')

            if not webhook_config:
                print(f"[TaskAgent] No webhook configuration found, skipping webhook notifications")
                return

            webhook_url = webhook_config.get('url')
            webhook_token = webhook_config.get('token')

            if not webhook_url or not webhook_token:
                print(f"[TaskAgent] Incomplete webhook configuration, skipping webhook notifications")
                return

            print(f"[TaskAgent] Sending webhooks for {len(jobs)} tasks to {webhook_url}")

            # Create a canvas document first
            canvas_document_id = str(uuid.uuid4())

            # Send webhook for each task (without documentId - let Next.js handle document creation)
            for job in jobs:
                task_id = job.get("id", str(uuid.uuid4()))
                task_data = {
                    "id": task_id,
                    "contextId": context.context_id,
                    "kind": "task",
                    "status": {"state": "submitted", "timestamp": datetime.utcnow().isoformat() + 'Z'},
                    "result": {
                        "title": job.get("title", "Unnamed Task"),
                        "description": job.get("description", ""),
                        "assignedAgent": job.get("assignedAgent"),
                        "order": jobs.index(job)
                    },
                    "artifacts": []
                }

                # Send webhook (without documentId for now)
                success = self._call_webhook(webhook_url, webhook_token, task_data, None)
                if success:
                    print(f"[TaskAgent] Successfully sent webhook for task {task_id}")
                else:
                    print(f"[TaskAgent] Failed to send webhook for task {task_id}")

            print(f"[TaskAgent] Completed sending webhooks for {len(jobs)} tasks")

        except Exception as e:
            print(f"[TaskAgent] Error sending task webhooks: {e}")
            # Don't raise here - we don't want webhook failures to break the main flow

    async def _process_request_async(self, context: RequestContext, user_message: str,
                                   document_id: Optional[str]) -> None:
        """Process request asynchronously - task creation handled in main execute method"""
        try:
            # For now, only handle job execution requests with webhooks
            # Task creation is handled in the main execute method and returns tasks directly
            if self._is_job_execution_request(user_message):
                print(f"[TaskAgent] Job execution request detected")
                await self._execute_jobs_async(context, user_message, document_id)
            else:
                print(f"[TaskAgent] Task creation handled in main execute method")

            print(f"[TaskAgent] Async processing completed for task {context.task_id}")

        except Exception as e:
            print(f"[TaskAgent] Error in async processing: {e}")
            # Send failure webhook if webhook config is available
            webhook_config = None
            if hasattr(context, 'message') and context.message:
                if hasattr(context.message, 'configuration') and context.message.configuration:
                    webhook_config = context.message.configuration.get('pushNotificationConfig')

            if webhook_config:
                webhook_url = webhook_config.get('url')
                webhook_token = webhook_config.get('token')
                if webhook_url and webhook_token:
                    error_task_data = {
                        "id": context.task_id,
                        "contextId": context.context_id,
                        "status": {"state": "failed", "message": str(e)},
                        "artifacts": []
                    }
                    self._call_webhook(webhook_url, webhook_token, error_task_data, document_id)
    
    async def _create_task_with_jobs_async(self, context: RequestContext,
                                         user_message: str, document_id: Optional[str]) -> None:
        """Create a task and decompose it into jobs - client handles storage"""
        print(f"[TaskAgent] Creating task with jobs asynchronously")

        try:
            # Generate sample jobs based on user message
            jobs = await self._generate_jobs(user_message)

            # Return jobs in response for client to handle storage
            # Webhooks are only used for execution updates, not initial creation

            print(f"[TaskAgent] Generated {len(jobs)} jobs - client will store them")

        except Exception as e:
            print(f"[TaskAgent] Error in async task creation: {e}")
            raise

    async def _execute_jobs_async(self, context: RequestContext,
                                user_message: str, document_id: Optional[str]) -> None:
        """Execute jobs for a given task using A2A webhook pattern for status updates"""
        print(f"[TaskAgent] Executing jobs asynchronously")

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
                "status": {"state": "working", "message": "Starting job execution"},
                "artifacts": []
            }
            self._call_webhook(webhook_url, webhook_token, initial_task_data, document_id)

            # Simulate job execution
            jobs = await self._generate_jobs("Execute sample jobs")  # In real implementation, get from database

            for i, job in enumerate(jobs):
                # Send job start webhook
                job_start_data = {
                    "id": f"{task_id}-job-{i}",
                    "contextId": context.context_id,
                    "status": {"state": "working", "message": f"Executing: {job['title']}"},
                    "artifacts": []
                }

                self._call_webhook(webhook_url, webhook_token, job_start_data, document_id)

                # Simulate job execution time
                await asyncio.sleep(2)

                # Send job completion webhook
                job_complete_data = {
                    "id": f"{task_id}-job-{i}",
                    "contextId": context.context_id,
                    "status": {"state": "completed", "message": f"Completed: {job['title']}"},
                    "artifacts": [{
                        "artifactId": str(uuid.uuid4()),
                        "parts": [{
                            "kind": "data",
                            "data": {
                                "jobId": f"{task_id}-job-{i}",
                                "result": f"Successfully completed {job['title']}",
                                "timestamp": datetime.utcnow().isoformat() + 'Z'
                            }
                        }]
                    }]
                }

                self._call_webhook(webhook_url, webhook_token, job_complete_data, document_id)

            # Send final completion webhook
            final_task_data = {
                "id": task_id,
                "contextId": context.context_id,
                "status": {"state": "completed", "message": f"Successfully executed {len(jobs)} jobs"},
                "artifacts": []
            }

            self._call_webhook(webhook_url, webhook_token, final_task_data, document_id)

            print(f"[TaskAgent] Job execution completed with webhook notifications")

        except Exception as e:
            print(f"[TaskAgent] Error in async job execution: {e}")
            raise

    async def _send_default_response_async(self, context: RequestContext,
                                         document_id: Optional[str]) -> None:
        """Send default response using webhook pattern"""
        print(f"[TaskAgent] Sending default response asynchronously")

        if document_id:
            webhook_token = str(uuid.uuid4())
            webhook_url = f"{self.webhook_base_url}/api/webhook/tasks"

            default_task_data = {
                "id": context.task_id,
                "contextId": context.context_id,
                "status": {"state": "completed", "message": "Request processed"},
                "artifacts": [{
                    "artifactId": str(uuid.uuid4()),
                    "parts": [{
                        "kind": "data",
                        "data": {"message": "Your request has been processed by the A2A Task Agent"}
                    }]
                }]
            }

            self._call_webhook(webhook_url, webhook_token, default_task_data, document_id)

    async def cancel(self) -> None:
        """Cancel the current execution"""
        raise NotImplementedError("Cancellation not supported")

    def _call_webhook(self, url: str, token: str, task_data: Dict[str, Any],
                     document_id: Optional[str] = None) -> bool:
        """Send webhook notification to Next.js application using session token"""
        try:
            payload = {
                "id": task_data["id"],
                "contextId": task_data.get("contextId", "default"),
                "kind": "task",
                "status": task_data["status"],
                "artifacts": task_data.get("artifacts", [])
            }

            if document_id:
                payload["documentId"] = document_id

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

    def _extract_document_id(self, context: RequestContext) -> Optional[str]:
        """Extract document ID from context (passed from Next.js)"""
        # First, try to extract from message metadata (A2A standard approach)
        if hasattr(context, 'message') and context.message:
            if hasattr(context.message, 'metadata') and context.message.metadata:
                canvas_doc_id = context.message.metadata.get('canvasDocumentId')
                if canvas_doc_id:
                    print(f"[TaskAgent] Extracted documentId from metadata: {canvas_doc_id}")
                    return canvas_doc_id

            # Fallback: extract from message parts (legacy approach)
            if hasattr(context.message, 'parts') and context.message.parts:
                for part in context.message.parts:
                    if hasattr(part, 'root') and part.root:
                        if hasattr(part.root, 'text') and part.root.text:
                            # Look for documentId in the message content
                            text = part.root.text
                            if "documentId:" in text:
                                # Extract document ID from message
                                start = text.find("documentId:") + len("documentId:")
                                end = text.find(",", start) if "," in text[start:] else len(text)
                                doc_id = text[start:end].strip()
                                if doc_id:
                                    print(f"[TaskAgent] Extracted documentId from text: {doc_id}")
                                    return doc_id
        return None

    def _extract_user_message(self, context: RequestContext) -> str:
        """Extract the user message from the request context"""
        if hasattr(context, 'message') and context.message:
            if hasattr(context.message, 'parts') and context.message.parts:
                for part in context.message.parts:
                    if hasattr(part, 'root') and part.root:
                        if hasattr(part.root, 'text') and part.root.text:
                            text = part.root.text
                            if "Current request:" in text:
                                return text.split("Current request:")[-1].strip()
                            return text
        return ""
    
    def _enhance_user_message_with_system_prompt(self, user_message: str) -> str:
        """Enhance user message with system prompt context for better task generation"""
        
        # System prompt to guide task generation
        system_prompt = """
You are a professional task decomposition agent. Your role is to break down user requests into specific, actionable tasks.

TASK GENERATION GUIDELINES:
1. Create 2-5 concrete, executable tasks
2. Each task should have a clear title and detailed description
3. Assign appropriate specialized agents to each task
4. Tasks should be logically ordered and interdependent when necessary
5. Include realistic effort estimates and agent capabilities

AGENT TYPES AVAILABLE:
- Travel Planner: Itinerary creation, destination research, booking assistance
- Recipe Developer: Meal planning, recipe creation, dietary adjustments
- Event Coordinator: Event planning, vendor coordination, timeline management
- Personal Shopper: Product research, price comparison, purchase recommendations
- Fitness Coach: Workout planning, fitness goal setting, progress tracking
- Financial Advisor: Budget planning, investment advice, expense tracking
- Home Organizer: Space optimization, decluttering strategies, storage solutions
- Learning Mentor: Study planning, resource gathering, skill development guidance

EXAMPLE TASK BREAKDOWN:
User: "Plan a week-long trip to Italy"
Tasks:
1. Destination Research - Identify key cities and attractions to visit in Italy
2. Itinerary Planning - Create a detailed day-by-day travel plan
3. Accommodation Booking - Find and suggest hotels or rentals for each location
4. Transportation Arrangement - Organize flights, trains, or car rentals between destinations
5. Budget Planning - Estimate costs and suggest ways to manage expenses

Now process this user request:
"""
        
        enhanced_message = f"{system_prompt}\n\nUser Request: {user_message}"
        return enhanced_message
    
    def _is_task_creation_request(self, message: str) -> bool:
        """Check if the message is requesting task creation/decomposition"""
        keywords = [
            "task", "create task", "decompose", "breakdown",
            "plan", "project", "build", "develop", "create"
        ]
        message_lower = message.lower()
        return any(keyword in message_lower for keyword in keywords)
    
    def _is_job_execution_request(self, message: str) -> bool:
        """Check if the message is requesting job execution"""
        try:
            data = json.loads(message)
            return data.get("type") == "execute_jobs"
        except:
            return False
    
    async def _send_default_response(self, event_queue: EventQueue, context: RequestContext) -> None:
        """Send default response"""
        response_text = "I can help you create tasks and manage job execution. Try asking me to 'create a task for building a web application'."
        await event_queue.enqueue_event(new_agent_text_message(response_text))
    
    async def _create_task_with_jobs(self, event_queue: EventQueue, context: RequestContext, user_message: str) -> None:
        """Create a task and decompose it into jobs using A2A webhook pattern"""

        print(f"[TaskAgent] Creating task decomposition")

        # Generate jobs based on the request
        jobs = await self._generate_jobs(user_message)
        project_title = self._extract_project_title(user_message)

        # Generate unique task ID (proper UUID)
        task_id = str(uuid.uuid4())
        webhook_token = str(uuid.uuid4())  # Generate webhook token
        print(f"[TaskAgent] Generated taskId: {task_id}")

        # Store task data for later execution
        self.tasks_store[task_id] = {
            "title": project_title,
            "jobs": jobs,
            "agents": [job["assignedAgent"] for job in jobs if job.get("assignedAgent")],
            "webhook_token": webhook_token,
            "context_id": context.context_id
        }
        print(f"[TaskAgent] Stored task {task_id} with {len(jobs)} jobs")

        # Extract document ID from context (passed from Next.js)
        document_id = self._extract_document_id(context)

        # Send initial task creation webhook
        task_data = {
            "id": task_id,
            "contextId": context.context_id,
            "kind": "task",
            "status": {
                "state": "working",
                "timestamp": datetime.now().isoformat() + 'Z'
            },
            "artifacts": [{
                "artifactId": str(uuid.uuid4()),
                "parts": [{
                    "kind": "data",
                    "data": {
                        "type": "task-created",
                        "title": project_title,
                        "jobs": jobs
                    }
                }]
            }]
        }

        webhook_url = f"{self.webhook_base_url}/api/webhook/tasks"
        self._call_webhook(webhook_url, webhook_token, task_data, document_id)

        # Send individual job updates with delay for better UX
        for i, job in enumerate(jobs):
            await asyncio.sleep(0.2)  # 200ms delay between jobs

            job_task_data = {
                "id": task_id,
                "contextId": context.context_id,
                "kind": "task",
                "status": {
                    "state": "working",
                    "timestamp": datetime.now().isoformat() + 'Z'
                },
                "artifacts": [{
                    "artifactId": str(uuid.uuid4()),
                    "parts": [{
                        "kind": "data",
                        "data": {
                            "type": "job-added",
                            "job": job,
                            "jobIndex": i + 1,
                            "totalJobs": len(jobs)
                        }
                    }]
                }]
            }

            self._call_webhook(webhook_url, webhook_token, job_task_data, document_id)

        print(f"[TaskAgent] Task creation completed with webhook notifications")
    
    async def _execute_jobs(self, event_queue: EventQueue, context: RequestContext, user_message: str) -> None:
        """Execute jobs for a given task using A2A webhook pattern"""

        print(f"[TaskAgent] Starting job execution")

        try:
            # Parse the execution request
            data = json.loads(user_message)
            task_id = data.get("taskId")
            execution_mode = data.get("executionMode", "parallel")

            print(f"[TaskAgent] Executing task {task_id} in {execution_mode} mode")

            # Get task data
            task_data = self.tasks_store.get(task_id)
            if not task_data:
                print(f"[TaskAgent] Task {task_id} not found, using demo data")
                task_data = self._create_demo_task_data()
                self.tasks_store[task_id] = task_data

            jobs = task_data.get("jobs", [])
            webhook_token = task_data.get("webhook_token", str(uuid.uuid4()))
            document_id = self._extract_document_id(context)
            webhook_url = f"{self.webhook_base_url}/api/webhook/tasks"

            print(f"[TaskAgent] Executing {len(jobs)} jobs")

            # Execute each job with webhook notifications
            for i, job in enumerate(jobs):
                job_id = job.get("id")
                agent = job.get("assignedAgent")

                if agent:
                    print(f"[TaskAgent] [{i+1}/{len(jobs)}] Executing job {job_id}")

                    # Send in-progress webhook update
                    progress_task_data = {
                        "id": task_id,
                        "contextId": context.context_id,
                        "kind": "task",
                        "status": {
                            "state": "working",
                            "timestamp": datetime.now().isoformat() + 'Z'
                        },
                        "artifacts": [{
                            "artifactId": str(uuid.uuid4()),
                            "parts": [{
                                "kind": "data",
                                "data": {
                                    "type": "job-progress",
                                    "jobId": job_id,
                                    "agentId": agent["id"],
                                    "agentName": agent["name"],
                                    "status": "in-progress",
                                    "content": f"Agent {agent['name']} is working on: {job['title']}",
                                    "progress": (i + 1) / len(jobs) * 100
                                }
                            }]
                        }]
                    }

                    self._call_webhook(webhook_url, webhook_token, progress_task_data, document_id)

                    # Simulate work
                    await asyncio.sleep(2)

                    # Send completion webhook update
                    result = self._generate_job_result(job, agent)
                    completion_task_data = {
                        "id": task_id,
                        "contextId": context.context_id,
                        "kind": "task",
                        "status": {
                            "state": "working",
                            "timestamp": datetime.now().isoformat() + 'Z'
                        },
                        "artifacts": [{
                            "artifactId": str(uuid.uuid4()),
                            "parts": [{
                                "kind": "data",
                                "data": {
                                    "type": "job-completed",
                                    "jobId": job_id,
                                    "agentId": agent["id"],
                                    "agentName": agent["name"],
                                    "status": "completed",
                                    "content": result,
                                    "jobIndex": i + 1,
                                    "totalJobs": len(jobs)
                                }
                            }]
                        }]
                    }

                    self._call_webhook(webhook_url, webhook_token, completion_task_data, document_id)

                    if i < len(jobs) - 1:
                        await asyncio.sleep(0.5)

            # Send final completion webhook
            final_task_data = {
                "id": task_id,
                "contextId": context.context_id,
                "kind": "task",
                "status": {
                    "state": "completed",
                    "timestamp": datetime.now().isoformat() + 'Z'
                },
                "artifacts": [{
                    "artifactId": str(uuid.uuid4()),
                    "parts": [{
                        "kind": "data",
                        "data": {
                            "type": "execution-summary",
                            "taskId": task_id,
                            "totalJobs": len(jobs),
                            "status": "completed",
                            "executionMode": execution_mode,
                            "completedAt": datetime.now().isoformat() + 'Z'
                        }
                    }]
                }]
            }

            self._call_webhook(webhook_url, webhook_token, final_task_data, document_id)

            print(f"[TaskAgent] Job execution completed with webhook notifications")

        except Exception as e:
            print(f"[TaskAgent] Error executing jobs: {e}")
            await event_queue.enqueue_event(new_agent_text_message(f"Error executing jobs: {str(e)}"))
    
    async def _send_job_update(self, event_queue: EventQueue, context: RequestContext, 
                               job_id: str, agent: Dict, status: str, content: str) -> None:
        """Send job execution update via updateTask toolcall"""
        
        toolcall_id = str(uuid.uuid4())
        
        toolcall_data = {
            "type": "toolcall_completed",
            "toolcall": {
                "id": toolcall_id,
                "function": "updateTask",
                "arguments": {
                    "jobResponse": {
                        "jobId": job_id,
                        "agentId": agent["id"],
                        "agentName": agent["name"],
                        "status": status,
                        "content": content,
                        "timestamp": datetime.now().isoformat()
                    }
                },
                "status": "completed",
                "result": f"Job {job_id} update sent"
            },
            "context_id": context.context_id,
            "timestamp": datetime.now().isoformat()
        }
        
        await event_queue.enqueue_event(TaskArtifactUpdateEvent(
            taskId=context.task_id,
            contextId=context.context_id,
            artifact=Artifact(
                artifactId=f"toolcall-job-{job_id}-{status}",
                parts=[Part(kind="data", data=toolcall_data)]
            ),
            lastChunk=False
        ))
    
    async def _send_execution_summary(self, event_queue: EventQueue, context: RequestContext,
                                      task_id: str, jobs: List[Dict], execution_mode: str) -> None:
        """Send execution summary via updateTask toolcall"""
        
        summary_content = f"""🎉 Task Execution Complete!

📊 Summary:
- Task ID: {task_id}
- Total Jobs: {len(jobs)}
- Status: All Successful
- Mode: {execution_mode}

✅ Completed Jobs:
{chr(10).join([f"• {job['title']}: ✅ Completed" for job in jobs])}

🚀 Ready for deployment and integration."""
        
        toolcall_id = str(uuid.uuid4())
        
        toolcall_data = {
            "type": "toolcall_completed",
            "toolcall": {
                "id": toolcall_id,
                "function": "updateTask",
                "arguments": {
                    "summary": {
                        "id": f"summary-{task_id}",
                        "content": summary_content,
                        "timestamp": datetime.now().isoformat()
                    }
                },
                "status": "completed",
                "result": "Execution summary sent"
            },
            "context_id": context.context_id,
            "timestamp": datetime.now().isoformat()
        }
        
        await event_queue.enqueue_event(TaskArtifactUpdateEvent(
            taskId=context.task_id,
            contextId=context.context_id,
            artifact=Artifact(
                artifactId=f"toolcall-summary-{task_id}",
                parts=[Part(kind="data", data=toolcall_data)]
            ),
            lastChunk=True
        ))
    
    def _extract_project_title(self, user_message: str) -> str:
        """Extract a project title from the user message"""
        if "web" in user_message.lower():
            return "Web Application Development"
        elif "scraping" in user_message.lower():
            return "Web Scraping System"
        elif "api" in user_message.lower():
            return "API Development Project"
        else:
            return "Project Task"
    
    async def _generate_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Generate jobs based on user request with enhanced intelligence"""
        
        # Analyze the user message to determine project type and complexity
        message_lower = user_message.lower()
        print(f"[TaskAgent] 🔍 Analyzing message: '{message_lower}'")
        
        # Determine project type based on keywords
        if any(keyword in message_lower for keyword in ["web app", "website", "web application", "frontend", "react", "next.js"]):
            print(f"[TaskAgent] 🌐 Detected web project")
            return self._create_web_project_jobs(user_message)
        elif any(keyword in message_lower for keyword in ["scraping", "scrape", "data extraction", "web scraping"]):
            print(f"[TaskAgent] 🕷️ Detected scraping project")
            return self._create_scraping_jobs(user_message)
        elif any(keyword in message_lower for keyword in ["api", "backend", "server", "database", "rest", "graphql"]):
            print(f"[TaskAgent] 🔧 Detected API project")
            return self._create_api_jobs(user_message)
        elif any(keyword in message_lower for keyword in ["mobile", "app", "ios", "android", "react native"]):
            print(f"[TaskAgent] 📱 Detected mobile project")
            return self._create_mobile_jobs(user_message)
        elif any(keyword in message_lower for keyword in ["ai", "machine learning", "ml", "data science", "analytics"]):
            print(f"[TaskAgent] 🤖 Detected AI/ML project")
            return self._create_ai_jobs(user_message)
        elif any(keyword in message_lower for keyword in ["e-commerce", "shop", "store", "payment", "checkout"]):
            print(f"[TaskAgent] 🛒 Detected e-commerce project")
            return self._create_ecommerce_jobs(user_message)
        elif any(keyword in message_lower for keyword in ["trip", "travel", "itinerary", "vacation", "journey", "plan", "japan", "destination"]):
            print(f"[TaskAgent] ✈️ Detected travel project")
            return self._create_travel_jobs(user_message)
        else:
            print(f"[TaskAgent] 📋 Using generic project template")
            return self._create_intelligent_generic_jobs(user_message)
    
    def _create_web_project_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create jobs for web project based on user requirements"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Frontend Development & UI Design",
                "description": f"Create responsive user interface for: {user_message}. Implement modern React/Next.js components with TypeScript, responsive design, and accessibility features.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Frontend Specialist",
                    "description": "Expert in React, TypeScript, and modern frontend development",
                    "capabilities": ["React", "Next.js", "TypeScript", "Tailwind CSS", "UI/UX Design"],
                    "pricingUsdt": 2.5,
                    "walletAddress": "0x742d35cc6565c1c6e9e9f8e8d8f5c4b3a2f1e0d9",
                    "rating": 4.8,
                    "completedTasks": 156
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Backend API & Authentication",
                "description": f"Build secure REST API for: {user_message}. Implement authentication, authorization, data validation, and API documentation.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Backend Engineer",
                    "description": "Specialized in Node.js, APIs, and server architecture",
                    "capabilities": ["Node.js", "Express", "PostgreSQL", "JWT", "REST APIs"],
                    "pricingUsdt": 3.0,
                    "walletAddress": "0x851e46ec6695d2c7f0f0a9a9e9f8c5d4c3b2a1f0",
                    "rating": 4.9,
                    "completedTasks": 203
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Database Architecture & Optimization",
                "description": f"Design scalable database schema for: {user_message}. Create optimized tables, indexes, relationships, and implement data migration strategies.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Database Architect",
                    "description": "Expert in database design, optimization, and performance tuning",
                    "capabilities": ["PostgreSQL", "Schema Design", "Query Optimization", "Data Modeling"],
                    "pricingUsdt": 2.8,
                    "walletAddress": "0xa1b2c3d4e5f6789012345678901234567890abcd",
                    "rating": 4.7,
                    "completedTasks": 89
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Testing & Quality Assurance",
                "description": f"Implement comprehensive testing suite for: {user_message}. Create unit tests, integration tests, E2E tests, and performance monitoring.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "QA Engineer",
                    "description": "Specialized in test automation and quality assurance",
                    "capabilities": ["Jest", "Cypress", "Playwright", "Test Automation", "Performance Testing"],
                    "pricingUsdt": 2.2,
                    "walletAddress": "0xdef456789abcdef456789abcdef456789abcdef4",
                    "rating": 4.6,
                    "completedTasks": 134
                }
            }
        ]
    
    def _create_scraping_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create jobs for scraping project"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Web Scraper Development",
                "description": f"Build robust web scraper for: {user_message}. Implement data extraction, handle anti-bot measures, and ensure reliable data collection.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Scraping Specialist",
                    "description": "Expert in web scraping and data extraction",
                    "capabilities": ["Python", "Scrapy", "BeautifulSoup", "Selenium", "Proxy Management"],
                    "pricingUsdt": 2.4,
                    "walletAddress": "0xef1234567890abcdef1234567890abcdef123456",
                    "rating": 4.6,
                    "completedTasks": 87
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Data Processing & Storage",
                "description": f"Process and store scraped data for: {user_message}. Clean data, implement ETL pipeline, and set up data storage solutions.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Data Engineer",
                    "description": "ETL pipeline and data processing specialist",
                    "capabilities": ["Python", "Pandas", "ETL", "Data Cleaning", "Database Design"],
                    "pricingUsdt": 2.6,
                    "walletAddress": "0x123456789abcdef123456789abcdef123456789a",
                    "rating": 4.7,
                    "completedTasks": 103
                }
            }
        ]
    
    def _create_api_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create jobs for API project"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "API Design & Architecture",
                "description": f"Design RESTful API for: {user_message}. Create API specification, design endpoints, and plan data models.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "API Architect",
                    "description": "Expert in API design and system architecture",
                    "capabilities": ["REST API", "GraphQL", "OpenAPI", "System Design", "Documentation"],
                    "pricingUsdt": 2.8,
                    "walletAddress": "0x9876543210fedcba9876543210fedcba98765432",
                    "rating": 4.8,
                    "completedTasks": 156
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "API Implementation & Testing",
                "description": f"Implement and test API for: {user_message}. Build endpoints, implement authentication, and create comprehensive test suite.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Backend Developer",
                    "description": "Specialist in API development and testing",
                    "capabilities": ["Node.js", "Express", "Testing", "Authentication", "Database Integration"],
                    "pricingUsdt": 3.0,
                    "walletAddress": "0xapi456789abcdef456789abcdef456789abcdef45",
                    "rating": 4.9,
                    "completedTasks": 189
                }
            }
        ]
    
    def _create_intelligent_generic_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create intelligent generic jobs based on user message analysis"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Requirements Analysis & Planning",
                "description": f"Analyze and document requirements for: {user_message}. Create detailed project specification, user stories, and technical architecture plan.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Project Analyst",
                    "description": "Expert in requirements analysis and project planning",
                    "capabilities": ["Requirements Analysis", "Project Planning", "Documentation", "Stakeholder Management"],
                    "pricingUsdt": 2.0,
                    "walletAddress": "0xabcdef123456789abcdef123456789abcdef1234",
                    "rating": 4.5,
                    "completedTasks": 78
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Technical Implementation",
                "description": f"Implement core functionality for: {user_message}. Develop the main features, integrate necessary services, and ensure code quality.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Full-Stack Developer",
                    "description": "Versatile developer with full-stack capabilities",
                    "capabilities": ["JavaScript", "Python", "React", "Node.js", "Database Design"],
                    "pricingUsdt": 2.8,
                    "walletAddress": "0x123456789abcdef123456789abcdef123456789a",
                    "rating": 4.7,
                    "completedTasks": 145
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Testing & Deployment",
                "description": f"Test and deploy solution for: {user_message}. Implement testing strategies, perform quality assurance, and handle production deployment.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "DevOps Engineer",
                    "description": "Expert in deployment, testing, and infrastructure",
                    "capabilities": ["CI/CD", "Testing", "Docker", "AWS", "Monitoring"],
                    "pricingUsdt": 2.4,
                    "walletAddress": "0x987654321fedcba987654321fedcba9876543210",
                    "rating": 4.6,
                    "completedTasks": 92
                }
            }
        ]
    
    def _create_mobile_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create jobs for mobile app development"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Mobile App UI/UX Design",
                "description": f"Design mobile interface for: {user_message}. Create wireframes, prototypes, and responsive mobile designs following platform guidelines.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Mobile UI/UX Designer",
                    "description": "Specialist in mobile app design and user experience",
                    "capabilities": ["React Native", "iOS Design", "Android Design", "Figma", "User Research"],
                    "pricingUsdt": 2.6,
                    "walletAddress": "0xmobile123456789abcdef123456789abcdef12345",
                    "rating": 4.8,
                    "completedTasks": 67
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Cross-Platform Development",
                "description": f"Develop mobile application for: {user_message}. Implement features using React Native or Flutter for iOS and Android platforms.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Mobile Developer",
                    "description": "Expert in cross-platform mobile development",
                    "capabilities": ["React Native", "Flutter", "iOS", "Android", "Mobile APIs"],
                    "pricingUsdt": 3.2,
                    "walletAddress": "0xmobiledev789abcdef789abcdef789abcdef789ab",
                    "rating": 4.9,
                    "completedTasks": 112
                }
            }
        ]
    
    def _create_ai_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create jobs for AI/ML projects"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Data Analysis & Model Design",
                "description": f"Design AI/ML solution for: {user_message}. Analyze data requirements, select appropriate algorithms, and design model architecture.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Data Scientist",
                    "description": "Expert in machine learning and data analysis",
                    "capabilities": ["Python", "TensorFlow", "PyTorch", "Data Analysis", "Model Design"],
                    "pricingUsdt": 3.5,
                    "walletAddress": "0xdatascience456789abcdef456789abcdef456789",
                    "rating": 4.9,
                    "completedTasks": 89
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "ML Pipeline & Integration",
                "description": f"Implement ML pipeline for: {user_message}. Build data processing pipeline, train models, and integrate with production systems.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "ML Engineer",
                    "description": "Specialist in ML operations and production systems",
                    "capabilities": ["MLOps", "Docker", "Kubernetes", "Model Deployment", "API Integration"],
                    "pricingUsdt": 3.8,
                    "walletAddress": "0xmlengineer789abcdef789abcdef789abcdef78",
                    "rating": 4.8,
                    "completedTasks": 76
                }
            }
        ]
    
    def _create_ecommerce_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create jobs for e-commerce projects"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "E-commerce Platform Development",
                "description": f"Build e-commerce platform for: {user_message}. Implement product catalog, shopping cart, user accounts, and admin dashboard.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "E-commerce Developer",
                    "description": "Expert in e-commerce platforms and online retail",
                    "capabilities": ["Shopify", "WooCommerce", "React", "Node.js", "Payment Integration"],
                    "pricingUsdt": 3.4,
                    "walletAddress": "0xecommerce123456789abcdef123456789abcdef12",
                    "rating": 4.7,
                    "completedTasks": 134
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Payment & Security Integration",
                "description": f"Implement secure payment system for: {user_message}. Integrate payment gateways, implement security measures, and ensure PCI compliance.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Payment Security Specialist",
                    "description": "Expert in payment processing and security",
                    "capabilities": ["Stripe", "PayPal", "Security", "PCI Compliance", "Fraud Prevention"],
                    "pricingUsdt": 3.6,
                    "walletAddress": "0xpayment456789abcdef456789abcdef456789abc",
                    "rating": 4.9,
                    "completedTasks": 98
                }
            }
        ]
    
    def _create_travel_jobs(self, user_message: str) -> List[Dict[str, Any]]:
        """Create jobs for travel planning projects"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Destination Research & Planning",
                "description": f"Research destinations and create detailed itinerary for: {user_message}. Analyze best locations, seasonal considerations, cultural highlights, and must-see attractions.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Travel Planning Specialist",
                    "description": "Expert in destination research and itinerary planning",
                    "capabilities": ["Destination Research", "Cultural Knowledge", "Seasonal Planning", "Attraction Analysis"],
                    "pricingUsdt": 2.2,
                    "walletAddress": "0xtravel123456789abcdef123456789abcdef1234",
                    "rating": 4.8,
                    "completedTasks": 167
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Accommodation & Transportation",
                "description": f"Arrange accommodations and transportation for: {user_message}. Research hotels, book flights, plan local transportation, and optimize travel routes.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Travel Logistics Coordinator",
                    "description": "Specialist in travel bookings and logistics coordination",
                    "capabilities": ["Hotel Booking", "Flight Planning", "Transportation", "Route Optimization"],
                    "pricingUsdt": 2.4,
                    "walletAddress": "0xlogistics456789abcdef456789abcdef456789",
                    "rating": 4.7,
                    "completedTasks": 143
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Daily Activity Planning",
                "description": f"Create detailed daily activities and experiences for: {user_message}. Plan sightseeing tours, cultural experiences, dining recommendations, and leisure activities.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Experience Curator",
                    "description": "Expert in creating memorable travel experiences",
                    "capabilities": ["Activity Planning", "Cultural Experiences", "Restaurant Recommendations", "Tour Coordination"],
                    "pricingUsdt": 2.0,
                    "walletAddress": "0xexperience789abcdef789abcdef789abcdef789",
                    "rating": 4.9,
                    "completedTasks": 198
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Budget & Documentation",
                "description": f"Manage budget and travel documentation for: {user_message}. Calculate costs, track expenses, handle visa requirements, and prepare travel documents.",
                "status": "submitted",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Travel Documentation Specialist",
                    "description": "Expert in travel documentation and budget management",
                    "capabilities": ["Budget Planning", "Visa Processing", "Travel Insurance", "Document Management"],
                    "pricingUsdt": 1.8,
                    "walletAddress": "0xbudget123456789abcdef123456789abcdef123",
                    "rating": 4.6,
                    "completedTasks": 124
                }
            }
        ]
    
    def _create_demo_task_data(self) -> Dict[str, Any]:
        """Create demo task data for testing"""
        return {
            "title": "Demo Task",
            "jobs": [
                {
                    "id": "job-demo-1",
                    "title": "Frontend Development",
                    "description": "Build user interface",
                    "status": "pending",
                    "assignedAgent": {
                        "id": "agent-demo-1",
                        "name": "Frontend Dev",
                        "description": "UI specialist",
                        "capabilities": ["React", "TypeScript"]
                    }
                },
                {
                    "id": "job-demo-2",
                    "title": "Backend Development",
                    "description": "Build API",
                    "status": "pending",
                    "assignedAgent": {
                        "id": "agent-demo-2",
                        "name": "Backend Dev",
                        "description": "API specialist",
                        "capabilities": ["Node.js", "PostgreSQL"]
                    }
                }
            ],
            "agents": []
        }
    
    def _generate_job_result(self, job: Dict, agent: Dict) -> str:
        """Generate a result for the job"""
        return f"""✅ {agent['name']} completed: {job['title']}

📋 Tasks Completed:
- Analyzed requirements
- Implemented solution
- Tested functionality
- Documentation updated

📊 Results:
- All requirements met
- Tests passing
- Ready for integration

💡 Next Steps:
- Review implementation
- Deploy to staging"""
    
    def _next_job_id(self) -> int:
        """Get next job ID"""
        self.job_counter += 1
        return self.job_counter
    
    def _next_agent_id(self) -> int:
        """Get next agent ID"""
        self.agent_counter += 1
        return self.agent_counter