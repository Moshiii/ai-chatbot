"""Agent Launcher - Handles spinning up all agents concurrently"""

import asyncio
import logging
from typing import List, Coroutine

from .trending_agent import main as trending_main
from .analyzer_agent import main as analyzer_main
from .host_agent import main as host_main
from .market_analysis_agent import main as market_analysis_main

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_all_agents():
    """Run all agents concurrently"""
    logger.info("Starting all agents...")
    
    # Create tasks for each agent
    tasks: List[Coroutine] = [
        trending_main(),
        analyzer_main(),
        host_main(),
        market_analysis_main(),
    ]
    
    try:
        # Run all agents concurrently
        await asyncio.gather(*tasks)
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
