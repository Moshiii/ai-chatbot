"""Task Agent Server - Main entry point"""

import uvicorn
import asyncio
import logging

from a2a.server.apps import A2AStarletteApplication
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)
from .agent_executor import TaskAgentExecutor
from .client_customized_executor import ClientCustomizedExecutor
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
    agent_card = AgentCard(
        name='Task Agent',
        description='A Python A2A agent that handles task decomposition and job execution',
        url='http://localhost:9999/',
        version='1.0.0',
        defaultInputModes=['text'],
        defaultOutputModes=['text'],
        capabilities=AgentCapabilities(streaming=True),
        skills=[task_creation_skill, task_execution_skill],
    )

    # Create request handler
    request_handler = DefaultRequestHandler(
        agent_executor=ClientCustomizedExecutor(),
        task_store=InMemoryTaskStore(),
    )

    # Create server application
    server = A2AStarletteApplication(
        agent_card=agent_card,
        http_handler=request_handler,
    )
    
    app = server.build()

    # Start server
    logger.info("[TaskAgent] Starting Task Agent Server on port 9999")
    config = uvicorn.Config(app, host="127.0.0.1", port=9999, log_level="info")
    server_instance = uvicorn.Server(config)
    await server_instance.serve()

async def main():
    """Main entry point that starts both the task agent server and all other agents"""
    logger.info("Starting Task Agent system...")
    
    # Create tasks for both the main server and all agents
    tasks = [
        start_task_agent_server(),
        run_all_agents(),
    ]
    
    try:
        # Run both the main server and all agents concurrently
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        logger.info("Received interrupt signal, shutting down...")
    except Exception as e:
        logger.error(f"Error running task agent system: {e}")
        raise

if __name__ == '__main__':
    asyncio.run(main())
