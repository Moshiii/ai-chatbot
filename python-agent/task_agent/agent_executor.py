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
            # Generate sample jobs based on user message
            jobs = await self._generate_jobs(user_message)

            # Create text part for human-readable confirmation
            text_part = Part(
                kind="text",
                text=f"I've analyzed your request and created {len(jobs)} tasks for execution."
            )

            # Create data parts for each task in A2A-compliant format
            data_parts = []
            for job in jobs:
                # A2A-compliant task data structure that TaskCollector expects
                task_data = {
                    "type": "task",  # Changed from "data-task" to match A2A spec
                    "task": {
                        "id": job.get("id", str(uuid.uuid4())),
                        "title": job.get("title", "Unnamed Task"),
                        "description": job.get("description", ""),
                        "status": "submitted",
                        "assignedAgent": job.get("assignedAgent"),
                        "contextId": context.context_id,
                        "createdAt": datetime.utcnow().isoformat() + 'Z',
                        "webhookToken": str(uuid.uuid4())  # Generate token for webhook auth
                    }
                }
                data_parts.append(Part(
                    kind="data",
                    data=task_data
                ))

            # Combine all parts into single message
            all_parts = [text_part] + data_parts

            # Create and enqueue the response message using A2A-compliant format
            response_message = new_agent_text_message(
                f"Created {len(jobs)} tasks successfully. The frontend will now create a canvas to track their progress."
            )

            # Replace the message parts with our structured task data
            response_message.parts = all_parts

            await event_queue.enqueue_event(response_message)

            print(f"[TaskAgent] ✅ Successfully generated {len(jobs)} A2A-compliant tasks")
            print(f"[TaskAgent] 📋 Task IDs: {[job.get('id', 'unknown') for job in jobs]}")

        except Exception as e:
            print(f"[TaskAgent] ❌ Error generating tasks: {e}")
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
        """Generate jobs based on user request"""
        
        if "web" in user_message.lower() or "website" in user_message.lower():
            return self._create_web_project_jobs()
        elif "scraping" in user_message.lower():
            return self._create_scraping_jobs()
        elif "api" in user_message.lower():
            return self._create_api_jobs()
        else:
            return self._create_generic_jobs()
    
    def _create_web_project_jobs(self) -> List[Dict[str, Any]]:
        """Create jobs for web project"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Frontend Development",
                "description": "Create responsive user interface with React/Next.js",
                "status": "pending",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Frontend Specialist",
                    "description": "Expert in React, TypeScript, and modern frontend",
                    "capabilities": ["React", "TypeScript", "CSS", "UI/UX"],
                    "pricingUsdt": 1.5,
                    "walletAddress": "0x742d35cc6565c1c6e9e9f8e8d8f5c4b3a2f1e0d9"
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Backend API Development",
                "description": "Build REST API with authentication",
                "status": "pending",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Backend Engineer",
                    "description": "Specialized in Node.js and databases",
                    "capabilities": ["Node.js", "PostgreSQL", "REST APIs"],
                    "pricingUsdt": 2.0,
                    "walletAddress": "0x851e46ec6695d2c7f0f0a9a9e9f8c5d4c3b2a1f0"
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Database Design",
                "description": "Design and optimize database schema",
                "status": "pending",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Database Architect",
                    "description": "Expert in database design and optimization",
                    "capabilities": ["PostgreSQL", "Schema Design", "Performance"],
                    "pricingUsdt": 1.8,
                    "walletAddress": "0xa1b2c3d4e5f6789012345678901234567890abcd"
                }
            }
        ]
    
    def _create_scraping_jobs(self) -> List[Dict[str, Any]]:
        """Create jobs for scraping project"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Web Scraper Development",
                "description": "Build robust web scraper",
                "status": "pending",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Scraping Specialist",
                    "description": "Expert in web scraping",
                    "capabilities": ["Python", "Scrapy", "BeautifulSoup"],
                    "pricingUsdt": 1.2,
                    "walletAddress": "0xef1234567890abcdef1234567890abcdef123456"
                }
            },
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Data Processing Pipeline",
                "description": "Process scraped data",
                "status": "pending",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Data Engineer",
                    "description": "ETL pipeline specialist",
                    "capabilities": ["Python", "Pandas", "ETL"],
                    "pricingUsdt": 1.4,
                    "walletAddress": "0x123456789abcdef123456789abcdef123456789a"
                }
            }
        ]
    
    def _create_api_jobs(self) -> List[Dict[str, Any]]:
        """Create jobs for API project"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "API Design & Documentation",
                "description": "Design RESTful API endpoints",
                "status": "pending",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "API Architect",
                    "description": "API design expert",
                    "capabilities": ["REST API", "OpenAPI", "Documentation"],
                    "pricingUsdt": 1.6,
                    "walletAddress": "0x9876543210fedcba9876543210fedcba98765432"
                }
            }
        ]
    
    def _create_generic_jobs(self) -> List[Dict[str, Any]]:
        """Create generic jobs"""
        return [
            {
                "id": f"job-{self._next_job_id()}",
                "title": "Requirements Analysis",
                "description": "Analyze project requirements",
                "status": "pending",
                "assignedAgent": {
                    "id": f"agent-{self._next_agent_id()}",
                    "name": "Project Analyst",
                    "description": "Requirements expert",
                    "capabilities": ["Analysis", "Planning", "Documentation"],
                    "pricingUsdt": 1.0,
                    "walletAddress": "0xabcdef123456789abcdef123456789abcdef1234"
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