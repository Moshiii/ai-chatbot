"""Task Agent Server - Main entry point"""

import uvicorn
import asyncio
import logging
import signal
import os

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)
from starlette.responses import JSONResponse
from .agent_executor import TaskAgentExecutor
from .orchestrator_executor import Orchestrator
from .agent_launcher import run_all_agents

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def start_task_agent_server():
    """Start the main task agent server"""
    # Define agent skills
    task_creation_skill = AgentSkill(
        id='create_task',
        name='Create Task with Job Decomposition',
        description='Creates a task and decomposes it into executable jobs with pre-assigned agents',
        tags=['task', 'decomposition', 'planning'],
        examples=['Create a task for building a web app', 'Plan a data analysis project'],
    )
    
    task_execution_skill = AgentSkill(
        id='execute_jobs',
        name='Execute Task Jobs',
        description='Executes jobs within a task and provides real-time progress updates',
        tags=['execution', 'jobs', 'progress'],
        examples=['Execute jobs for task-123', 'Run the planned tasks'],
    )

    # Public agent card

    client_agent_card = AgentCard(
        name="A2A Customized Task Agent",
        url="http://localhost:9999",
        description="Intelligent task decomposition agent with real OpenAI integration and A2A agent orchestration",
        version="1.0",
        capabilities=AgentCapabilities(streaming=True),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["application/json"],
        skills=[
            AgentSkill(
                id="task_decomposition",
                name="Intelligent Task Decomposition",
                description="Break down complex requests into actionable tasks using OpenAI and execute them with specialized A2A agents",
                tags=["task-management", "ai", "agents", "decomposition", "orchestration"],
                examples=[
                    "Plan a comprehensive trip to Japan",
                    "Build a modern web application with authentication",
                    "Create an e-commerce platform with payment integration",
                    "Develop a machine learning pipeline for data analysis",
                    "Design and implement a RESTful API"
                ],
            )
        ],
    )

    # Create request handler
    request_handler = DefaultRequestHandler(
        agent_executor=Orchestrator(openai_api_key=os.getenv("OPENAI_API_KEY")),
        task_store=InMemoryTaskStore(),
    )

    # Create server application
    server = A2AStarletteApplication(
        agent_card=client_agent_card,
        http_handler=request_handler,
    )

    app = server.build()

    # Add health check endpoint using Starlette's route system
    async def healthz(request):
        return JSONResponse({"status": "ok"})

    app.add_route("/healthz", healthz, methods=["GET"])

    # Start server
    agent_host = os.getenv("AGENT_HOST", "127.0.0.1")
    agent_port = int(os.getenv("AGENT_PORT", "9999"))
    logger.info(f"[TaskAgent] Starting Task Agent Server on port {agent_port}")
    config = uvicorn.Config(app, host=agent_host, port=agent_port, log_level="info")
    server_instance = uvicorn.Server(config)
    await server_instance.serve()

async def main():
    """Main entry point that starts both the task agent server and all other agents"""
    logger.info("Starting Task Agent system...")

    # Create tasks for both the main server and all agents
    orchestrator_task = asyncio.create_task(start_task_agent_server(), name="orchestrator")
    agents_task = asyncio.create_task(run_all_agents(), name="agents")

    stop_event = asyncio.Event()

    def _handle_stop_signal():
        stop_event.set()

    try:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, _handle_stop_signal)
            except NotImplementedError:
                pass
    except RuntimeError:
        pass

    try:
        # Wait until either orchestrator exits/fails OR a stop signal arrives
        done, pending = await asyncio.wait(
            {orchestrator_task, agents_task, asyncio.create_task(stop_event.wait())},
            return_when=asyncio.FIRST_COMPLETED,
        )

        # If a stop signal triggered, cancel running tasks
        if stop_event.is_set():
            for task in (orchestrator_task, agents_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(orchestrator_task, agents_task, return_exceptions=True)
        else:
            # If one of the service tasks completed (success or failure), cancel the other
            for task in (orchestrator_task, agents_task):
                if task not in done and not task.done():
                    task.cancel()
            await asyncio.gather(orchestrator_task, agents_task, return_exceptions=True)
    except KeyboardInterrupt:
        logger.info("Received interrupt signal, shutting down...")
        for task in (orchestrator_task, agents_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(orchestrator_task, agents_task, return_exceptions=True)
    except Exception as e:
        logger.error(f"Error running task agent system: {e}")
        for task in (orchestrator_task, agents_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(orchestrator_task, agents_task, return_exceptions=True)
        raise

if __name__ == '__main__':
    asyncio.run(main())
