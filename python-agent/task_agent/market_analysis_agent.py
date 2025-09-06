import asyncio
from typing import Any, AsyncGenerator

from a2a.server.tasks import TaskUpdater
from a2a.types import TaskState, AgentCard, AgentCapabilities, AgentSkill
from a2a.utils import new_agent_text_message, new_task

from .common import (
    log_error,
    create_agent_a2a_server,
    run_server,
)

from .market_analyst_agent.manager import FinancialResearchManager

import dotenv
dotenv.load_dotenv()


class MarketAnalysisAgent:
    """Agent for performing financial market analysis and report generation."""

    def __init__(self):
        self.manager = FinancialResearchManager()

    async def stream(self, query: str, context_id: str) -> AsyncGenerator[dict[str, Any], None]:
        """Stream the agent response."""

        try:
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "Starting financial market analysis...",
            }

            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "Performing market research and analysis...",
            }

            # Run the financial research manager
            report = await self.manager.run(query)

            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": report,
            }

        except Exception as e:
            log_error(f"MarketAnalysisAgent.stream() error: {str(e)} - query: '{query[:30]}...', context_id: {context_id}")
            yield {
                "is_task_complete": False,
                "require_user_input": True,
                "content": f"Error processing request: {str(e)}",
            }


class MarketAnalysisAgentExecutor:
    """Executor for the Market Analysis Agent."""

    def __init__(self):
        self.agent = MarketAnalysisAgent()

    async def execute(self, context, event_queue):
        """Execute the market analysis agent."""
        from a2a.server.agent_execution import RequestContext
        from a2a.server.events import EventQueue
        from a2a.types import Part, TextPart

        query = context.get_user_input()

        task = context.current_task
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)
        else:
            pass

        updater = TaskUpdater(event_queue, task.id, task.context_id)

        try:
            async for item in self.agent.stream(query, task.context_id):
                is_task_complete = item["is_task_complete"]
                require_user_input = item["require_user_input"]
                content = item["content"]

                if not is_task_complete and not require_user_input:
                    message = new_agent_text_message(content, task.context_id, task.id)

                    await updater.update_status(TaskState.working, message)
                elif require_user_input:
                    message = new_agent_text_message(content, task.context_id, task.id)

                    await updater.update_status(TaskState.input_required, message, final=True)
                    break
                else:
                    parts = [Part(root=TextPart(text=content))]

                    await updater.add_artifact(parts, name="market_analysis_report")

                    await updater.complete()
                    break

        except Exception as e:
            log_error(
                f"MarketAnalysisAgentExecutor.execute() error: {str(e)} - context_id: {context.context_id}, task_id: {task.id if task else 'None'}"
            )
            from a2a.utils.errors import ServerError
            from a2a.types import InternalError

            raise ServerError(error=InternalError()) from e


def main():
    market_analysis_agent_card = AgentCard(
        name="Market Analysis Agent",
        url="http://localhost:10023",
        description="Performs comprehensive financial market analysis and generates detailed reports",
        version="1.0",
        capabilities=AgentCapabilities(streaming=True),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["text/markdown"],
        skills=[
            AgentSkill(
                id="analyze_market",
                name="Analyze Market",
                description="Performs deep financial market analysis and generates comprehensive reports",
                tags=["finance", "market analysis", "stocks", "investment", "research"],
                examples=[
                    "Analyze the current state of the technology sector",
                    "Provide a market analysis for renewable energy stocks",
                    "Generate a financial report on the banking industry",
                ],
            )
        ],
    )

    def create_agent():
        return create_agent_a2a_server(MarketAnalysisAgentExecutor(), market_analysis_agent_card)

    asyncio.run(run_server(create_agent, 10023, "Market Analysis Agent"))


if __name__ == "__main__":
    main() 