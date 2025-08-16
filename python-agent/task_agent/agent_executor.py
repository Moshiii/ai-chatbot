"""Task Agent Executor - Handles task decomposition into jobs and job execution"""

import asyncio
import json
from datetime import datetime
from typing import Any, Dict, List

from a2a.server.agent_execution import RequestContext, AgentExecutor
from a2a.server.events import EventQueue
from a2a.types import Artifact, Part, TaskArtifactUpdateEvent, TaskStatusUpdateEvent
from a2a.utils import new_agent_text_message
import uuid


class TaskAgentExecutor(AgentExecutor):
    """Agent executor for task decomposition and job execution"""
    
    def __init__(self):
        super().__init__()
        self.job_counter = 0
        self.agent_counter = 0
        self.tasks_store = {}  # Store task data by taskId
    
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Execute using clean A2A streaming pattern"""
        
        print(f"[TaskAgent] Starting execution - Task: {context.task_id}")
        
        try:
            # Extract user message
            user_message = self._extract_user_message(context)
            print(f"[TaskAgent] Processing: '{user_message}'")
            
            # Initial status update
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "working"},
                final=False
            ))
            
            # Check request type
            if self._is_job_execution_request(user_message):
                print(f"[TaskAgent] Job execution request detected")
                await self._execute_jobs(event_queue, context, user_message)
            elif self._is_task_creation_request(user_message):
                print(f"[TaskAgent] Task creation request detected")
                await self._create_task_with_jobs(event_queue, context, user_message)
            else:
                print(f"[TaskAgent] Default response")
                await self._send_default_response(event_queue, context)
            
            # Final completion status
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "completed"},
                final=True
            ))
            
            print(f"[TaskAgent] Execution completed")
                
        except Exception as e:
            print(f"[TaskAgent] Error: {e}")
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "failed"},
                final=True
            ))
    
    async def cancel(self) -> None:
        """Cancel the current execution"""
        raise NotImplementedError("Cancellation not supported")
    
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
        """Create a task and decompose it into jobs"""
        
        print(f"[TaskAgent] Creating task decomposition")
        
        # Generate jobs based on the request
        jobs = await self._generate_jobs(user_message)
        project_title = self._extract_project_title(user_message)
        
        # Generate unique task ID (proper UUID)
        task_id = str(uuid.uuid4())
        print(f"[TaskAgent] Generated taskId: {task_id}")
        
        # Store task data for later execution
        self.tasks_store[task_id] = {
            "title": project_title,
            "jobs": jobs,
            "agents": [job["assignedAgent"] for job in jobs if job.get("assignedAgent")]
        }
        print(f"[TaskAgent] Stored task {task_id} with {len(jobs)} jobs")
        
        # Create toolcall for createTask
        toolcall_id = str(uuid.uuid4())
        
        toolcall_data = {
            "type": "toolcall_initiated",
            "toolcall": {
                "id": toolcall_id,
                "function": "createTask",
                "arguments": {
                    "title": project_title,
                    "taskId": task_id,
                    "jobs": jobs
                },
                "status": "initiated"
            },
            "context_id": context.context_id,
            "task_id": task_id,
            "timestamp": datetime.now().isoformat()
        }
        
        # Send toolcall as artifact
        await event_queue.enqueue_event(TaskArtifactUpdateEvent(
            taskId=context.task_id,
            contextId=context.context_id,
            artifact=Artifact(
                artifactId=f"toolcall-{toolcall_id}",
                parts=[Part(kind="data", data=toolcall_data)]
            ),
            lastChunk=False
        ))
        
        await asyncio.sleep(0.5)
        
        # Send completion
        completion_data = {
            "type": "toolcall_completed",
            "toolcall": {
                "id": toolcall_id,
                "function": "createTask",
                "status": "completed",
                "result": f"Task {task_id} created with {len(jobs)} jobs"
            },
            "context_id": context.context_id,
            "timestamp": datetime.now().isoformat()
        }
        
        await event_queue.enqueue_event(TaskArtifactUpdateEvent(
            taskId=context.task_id,
            contextId=context.context_id,
            artifact=Artifact(
                artifactId=f"toolcall-result-{toolcall_id}",
                parts=[Part(kind="data", data=completion_data)]
            ),
            lastChunk=True
        ))
        
        print(f"[TaskAgent] CreateTask completed")
    
    async def _execute_jobs(self, event_queue: EventQueue, context: RequestContext, user_message: str) -> None:
        """Execute jobs for a given task"""
        
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
            print(f"[TaskAgent] Executing {len(jobs)} jobs")
            
            # Execute each job
            for i, job in enumerate(jobs):
                job_id = job.get("id")
                agent = job.get("assignedAgent")
                
                if agent:
                    print(f"[TaskAgent] [{i+1}/{len(jobs)}] Executing job {job_id}")
                    
                    # Send in-progress update
                    await self._send_job_update(
                        event_queue, context, job_id, agent,
                        "in-progress", f"Agent {agent['name']} is working on: {job['title']}"
                    )
                    
                    # Simulate work
                    await asyncio.sleep(2)
                    
                    # Send completion update
                    result = self._generate_job_result(job, agent)
                    await self._send_job_update(
                        event_queue, context, job_id, agent,
                        "completed", result
                    )
                    
                    if i < len(jobs) - 1:
                        await asyncio.sleep(0.5)
            
            # Send summary
            await self._send_execution_summary(event_queue, context, task_id, jobs, execution_mode)
            
            print(f"[TaskAgent] Job execution completed")
            
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