"""Canvas Agent Executor - Handles message processing and canvas operations"""

import asyncio
import json
from datetime import datetime
from typing import Any, Dict, List, AsyncGenerator

from a2a.server.agent_execution import RequestContext, AgentExecutor
from a2a.server.events import EventQueue
from a2a.types import Artifact, Part, TaskArtifactUpdateEvent, TaskStatusUpdateEvent, TaskState
from a2a.utils import new_agent_text_message
import uuid


class CanvasAgentExecutor(AgentExecutor):
    """Agent executor for canvas operations"""
    
    def __init__(self):
        super().__init__()
        self.task_counter = 0
        self.agent_counter = 0
    
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Execute using clean A2A streaming pattern"""
        
        print(f"[AGENT] Starting A2A execution - Task: {context.task_id}")
        
        try:
            # Extract user message
            user_message = self._extract_user_message(context)
            print(f"[AGENT] Processing: '{user_message}'")
            
            # 1. Initial status update (final=False)
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "working"},
                final=False
            ))
            
            if self._is_canvas_request(user_message):
                print(f"[AGENT] Canvas request detected, calling createCanvas tool")
                await self._call_create_canvas_tool(event_queue, context, user_message)
                print(f"[AGENT] Canvas tool call completed")
            else:
                print(f"[AGENT] Non-canvas request, sending default response")
                await self._send_default_response(event_queue, context)
                print(f"[AGENT] Default response sent")
            
            print(f"[AGENT] Sending final completion status")
            # 3. Final completion status (final=True)
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "completed"},
                final=True
            ))
            
            print(f"[AGENT] Execution completed successfully")
                
        except Exception as e:
            print(f"[AGENT] Error: {e}")
            await event_queue.enqueue_event(TaskStatusUpdateEvent(
                taskId=context.task_id,
                contextId=context.context_id,
                status={"state": "failed"},
                final=True
            ))
            
            print(f"[AGENT] Error event sent")
    
    async def cancel(self) -> None:
        """Cancel the current execution"""
        raise NotImplementedError("Cancellation not supported")
    
    def _extract_user_message(self, context: RequestContext) -> str:
        """Extract the user message from the request context"""
        if hasattr(context, 'message') and context.message:
            if hasattr(context.message, 'parts') and context.message.parts:
                for part in context.message.parts:
                    # The Part object has a 'root' attribute containing the actual TextPart
                    if hasattr(part, 'root') and part.root:
                        if hasattr(part.root, 'text') and part.root.text:
                            print(f"[AGENT] Extracted full text: {part.root.text}")
                            # Extract just the current request from the full text
                            text = part.root.text
                            if "Current request:" in text:
                                current_request = text.split("Current request:")[-1].strip()
                                print(f"[AGENT] Extracted current request: '{current_request}'")
                                return current_request
                            return text
        return ""
    
    
    async def _send_default_response(self, event_queue: EventQueue, context: RequestContext) -> None:
        """Send default response as simple text message"""
        
        print(f"[AGENT] Sending default text response")
        response_text = "Hello! I can help you create task canvases. Try asking me to 'create a canvas for building a web application'."
        
        await event_queue.enqueue_event(new_agent_text_message(response_text))
        print(f"[AGENT] Default response sent")
    
    async def _call_create_canvas_tool(self, event_queue: EventQueue, context: RequestContext, user_message: str) -> None:
        """Call the createCanvas tool to properly initialize the canvas"""
        
        print(f"[AGENT] Calling createCanvas tool")
        
        # Generate tasks first
        tasks = await self._generate_fake_tasks(user_message)
        project_title = self._extract_project_title(user_message)
        
        # Create toolcall initiation event
        toolcall_id = str(uuid.uuid4())
        
        toolcall_data = {
            "type": "toolcall_initiated",
            "toolcall": {
                "id": toolcall_id,
                "function": "createCanvas",
                "arguments": {
                    "title": project_title,
                    "tasks": [task_data["task"] for task_data in tasks]
                },
                "status": "initiated"
            },
            "context_id": context.context_id,
            "timestamp": datetime.now().isoformat()
        }
        
        # Send toolcall as artifact - note: kind should be generic, part.kind is 'data'
        await event_queue.enqueue_event(TaskArtifactUpdateEvent(
            taskId=context.task_id,
            contextId=context.context_id,
            artifact=Artifact(
                artifactId=f"toolcall-{toolcall_id}",
                parts=[Part(kind="data", data=toolcall_data)]
            ),
            lastChunk=False
        ))
        
        # Wait a bit then mark as completed
        await asyncio.sleep(0.5)
        
        completion_data = {
            "type": "toolcall_completed",
            "toolcall": {
                "id": toolcall_id,
                "function": "createCanvas",
                "status": "completed",
                "result": f"Canvas created with {len(tasks)} tasks"
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
        
        print(f"[AGENT] CreateCanvas tool call completed")
    
    def _extract_project_title(self, user_message: str) -> str:
        """Extract a project title from the user message"""
        if "web" in user_message.lower():
            return "Web Application Development"
        elif "scraping" in user_message.lower():
            return "Web Scraping System"
        elif "api" in user_message.lower():
            return "API Development Project"
        else:
            return "Project Planning Canvas"
    def _is_canvas_request(self, message: str) -> bool:
        """Check if the message is requesting canvas creation"""
        canvas_keywords = [
            "canvas", "create canvas", "task breakdown", "decompose", 
            "plan", "project", "build", "develop", "create"
        ]
        message_lower = message.lower()
        return any(keyword in message_lower for keyword in canvas_keywords)
    
    
    
    async def _generate_fake_tasks(self, user_message: str) -> List[Dict[str, Any]]:
        """Generate fake tasks based on user request"""
        
        # Simple keyword-based task generation
        if "web" in user_message.lower() or "website" in user_message.lower():
            return self._create_web_project_tasks()
        elif "scraping" in user_message.lower() or "scrape" in user_message.lower():
            return self._create_scraping_tasks()
        elif "api" in user_message.lower():
            return self._create_api_tasks()
        else:
            return self._create_generic_tasks(user_message)
    
    def _create_web_project_tasks(self) -> List[Dict[str, Any]]:
        """Create tasks for web project"""
        return [
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "Frontend Development",
                    "description": "Create responsive user interface with React/Next.js",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "Frontend Specialist",
                        "description": "Expert in React, TypeScript, and modern frontend frameworks",
                        "capabilities": ["React", "TypeScript", "CSS", "UI/UX"],
                        "pricingUsdt": 1.5,
                        "walletAddress": "0x742d35cc6565c1c6e9e9f8e8d8f5c4b3a2f1e0d9"
                    }
                }
            },
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "Backend API Development",
                    "description": "Build REST API with authentication and database integration",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "Backend Engineer",
                        "description": "Specialized in Node.js, databases, and API design",
                        "capabilities": ["Node.js", "PostgreSQL", "REST APIs", "Authentication"],
                        "pricingUsdt": 2.0,
                        "walletAddress": "0x851e46ec6695d2c7f0f0a9a9e9f8c5d4c3b2a1f0"
                    }
                }
            },
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "Database Design",
                    "description": "Design database schema and optimization",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "Database Architect",
                        "description": "Expert in database design, optimization, and migrations",
                        "capabilities": ["PostgreSQL", "Schema Design", "Performance Tuning", "Migrations"],
                        "pricingUsdt": 1.8,
                        "walletAddress": "0xa1b2c3d4e5f6789012345678901234567890abcd"
                    }
                }
            }
        ]
    
    def _create_scraping_tasks(self) -> List[Dict[str, Any]]:
        """Create tasks for scraping project"""
        return [
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "Web Scraper Development",
                    "description": "Build robust web scraper with rate limiting and error handling",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "Scraping Specialist",
                        "description": "Expert in web scraping, data extraction, and automation",
                        "capabilities": ["Python", "Scrapy", "BeautifulSoup", "Selenium"],
                        "pricingUsdt": 1.2,
                        "walletAddress": "0xef1234567890abcdef1234567890abcdef123456"
                    }
                }
            },
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "Data Processing Pipeline",
                    "description": "Process and clean scraped data for storage",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "Data Engineer",
                        "description": "Specialized in data processing and ETL pipelines",
                        "capabilities": ["Python", "Pandas", "Data Cleaning", "ETL"],
                        "pricingUsdt": 1.4,
                        "walletAddress": "0x123456789abcdef123456789abcdef123456789a"
                    }
                }
            }
        ]
    
    def _create_api_tasks(self) -> List[Dict[str, Any]]:
        """Create tasks for API project"""
        return [
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "API Design & Documentation",
                    "description": "Design RESTful API endpoints and create comprehensive documentation",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "API Architect",
                        "description": "Expert in API design, documentation, and best practices",
                        "capabilities": ["REST API", "OpenAPI", "Documentation", "Design Patterns"],
                        "pricingUsdt": 1.6,
                        "walletAddress": "0x9876543210fedcba9876543210fedcba98765432"
                    }
                }
            }
        ]
    
    def _create_generic_tasks(self, user_message: str) -> List[Dict[str, Any]]:
        """Create generic tasks"""
        return [
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "Project Analysis",
                    "description": f"Analyze requirements for: {user_message[:100]}...",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "Project Analyst",
                        "description": "Expert in requirement analysis and project planning",
                        "capabilities": ["Analysis", "Planning", "Documentation", "Strategy"],
                        "pricingUsdt": 1.0,
                        "walletAddress": "0xabcdef123456789abcdef123456789abcdef1234"
                    }
                }
            },
            {
                "task": {
                    "id": f"task-{self._next_task_id()}",
                    "title": "Implementation",
                    "description": "Implement the core functionality and features",
                    "status": "pending",
                    "assignedAgent": {
                        "id": f"agent-{self._next_agent_id()}",
                        "name": "Development Specialist",
                        "description": "Full-stack developer with broad technology expertise",
                        "capabilities": ["Full Stack", "Multiple Languages", "Problem Solving", "Testing"],
                        "pricingUsdt": 1.3,
                        "walletAddress": "0x567890abcdef567890abcdef567890abcdef5678"
                    }
                }
            }
        ]
    
    
    
    def _next_task_id(self) -> int:
        """Get next task ID"""
        self.task_counter += 1
        return self.task_counter
    
    def _next_agent_id(self) -> int:
        """Get next agent ID"""
        self.agent_counter += 1
        return self.agent_counter