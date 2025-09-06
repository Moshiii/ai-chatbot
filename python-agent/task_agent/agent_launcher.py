"""Agent Launcher - Handles spinning up all agents concurrently"""

import asyncio
import logging
from typing import List, Coroutine

from .trending_agent import main as trending_main
from .analyzer_agent import main as analyzer_main
from .host_agent import main as host_main
# from .market_analysis_agent import main as market_analysis_main  # Disabled due to dependency issues

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from .common import run_server, is_port_in_use, log_system_event

async def run_all_agents():
    """Run all agents concurrently and shut them down when cancelled."""
    logger.info("Starting all agents...")

    # Import the agent creation functions directly
    from .trending_agent import create_agent as create_trending_agent
    from .analyzer_agent import create_agent as create_analyzer_agent
    from .host_agent import create_agent as create_host_agent

    # Create tasks for each agent server if ports are free
    tasks = []
    if not is_port_in_use(10020):
        tasks.append(run_server(create_trending_agent, 10020, "Trending Agent"))
    else:
        log_system_event("Skipping Trending Agent startup - port 10020 in use")

    if not is_port_in_use(10021):
        tasks.append(run_server(create_analyzer_agent, 10021, "Analyzer Agent"))
    else:
        log_system_event("Skipping Analyzer Agent startup - port 10021 in use")

    if not is_port_in_use(10022):
        tasks.append(run_server(create_host_agent, 10022, "Host Agent"))
    else:
        log_system_event("Skipping Host Agent startup - port 10022 in use")

    try:
        # Run all agents concurrently until cancelled
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        logger.info("Cancellation requested, stopping agents...")
    except KeyboardInterrupt:
        logger.info("Received interrupt signal, shutting down agents...")
    except Exception as e:
        logger.error(f"Error running agents: {e}")
        raise

def main():
    """Main entry point for running all agents"""
    asyncio.run(run_all_agents())

if __name__ == "__main__":
    main()
