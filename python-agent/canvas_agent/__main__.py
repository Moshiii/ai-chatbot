#!/usr/bin/env python3
"""Canvas A2A Agent - Main Entry Point"""

import uvicorn
from a2a.server.apps.jsonrpc.starlette_app import A2AStarletteApplication
from a2a.server.request_handlers.default_request_handler import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCard, AgentSkill, AgentCapabilities

from .agent_executor import CanvasAgentExecutor


def create_agent_card() -> AgentCard:
    """Create the agent card describing this agent's capabilities"""
    
    canvas_skill = AgentSkill(
        id="canvas_management",
        name="Canvas Management",
        description="Creates and manages interactive task canvases with agent coordination",
        examples=[
            "Create a canvas for building a web scraping system",
            "Break down complex projects into manageable tasks",
            "Coordinate multiple agents for task execution"
        ],
        tags=["canvas", "project-management", "task-coordination"]
    )
    
    return AgentCard(
        name="Canvas Agent",
        description="Specialized agent for creating interactive task canvases and coordinating multi-agent workflows",
        skills=[canvas_skill],
        version="0.1.0",
        url="http://localhost:9999",
        capabilities={"streaming": True},
        defaultInputModes=["text"],
        defaultOutputModes=["text"]
    )


def main():
    """Main entry point for the Canvas A2A Agent"""
    
    # Create agent card
    agent_card = create_agent_card()
    
    # Create agent executor
    agent_executor = CanvasAgentExecutor()
    
    # Create task store
    task_store = InMemoryTaskStore()
    
    # Create request handler
    request_handler = DefaultRequestHandler(
        agent_executor=agent_executor,
        task_store=task_store
    )
    
    # Create A2A server application
    a2a_app = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=request_handler
    )
    
    # Build the Starlette application
    app = a2a_app.build()
    
    # Run the server
    print("🚀 Starting Canvas A2A Agent on http://localhost:9999")
    print("📋 Agent capabilities: Canvas management and task coordination")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=9999,
        log_level="debug"
    )


if __name__ == "__main__":
    main()