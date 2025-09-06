
import asyncio
from typing import Any, AsyncGenerator

from pydantic_ai import Agent
from a2a.server.tasks import TaskUpdater
from a2a.types import TaskState, AgentCard, AgentCapabilities, AgentSkill
from a2a.utils import new_agent_text_message, new_task

from common import (
    log_error,
    google_search,
    create_agent_a2a_server,
    run_server,
)

import dotenv
dotenv.load_dotenv()


class AnalyzerAgent:
    """Agent for analyzing trends using Pydantic AI."""

    SYSTEM_INSTRUCTION = """
    You are a data analyst specializing in trend analysis. When given a trending topic,
    perform deep research to find quantitative data and insights.

    For each trend you analyze:
    1. Search for statistics, numbers, and metrics related to the trend
    2. Look for:
       - Engagement metrics (views, shares, mentions)
       - Growth rates and timeline
       - Geographic distribution
       - Related hashtags or keywords
    3. Provide concrete numbers and data points

    Keep it somehow concise

    Always prioritize quantitative information over qualitative descriptions.
    """

    def __init__(self):
        self.agent = Agent(model="gpt-4", tools=[google_search], system_prompt=self.SYSTEM_INSTRUCTION)

    async def stream(self, query: str, context_id: str) -> AsyncGenerator[dict[str, Any], None]:
        """Stream the agent response."""

        try:
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "Analyzing trend data...",
            }

            response = await self.agent.run(query)

            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": response.output,
            }

        except Exception as e:
            log_error(f"AnalyzerAgent.stream() error: {str(e)} - query: '{query[:30]}...', context_id: {context_id}")
            yield {
                "is_task_complete": False,
                "require_user_input": True,
                "content": f"Error processing request: {str(e)}",
            }


class AnalyzerAgentExecutor:
    """Executor for the Analyzer Agent."""

    def __init__(self):
        self.agent = AnalyzerAgent()

    async def execute(self, context, event_queue):
        """Execute the analyzer agent."""
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

                    await updater.add_artifact(parts, name="analysis_results")

                    await updater.complete()
                    break

        except Exception as e:
            log_error(
                f"AnalyzerAgentExecutor.execute() error: {str(e)} - context_id: {context.context_id}, task_id: {task.id if task else 'None'}"
            )
            from a2a.utils.errors import ServerError
            from a2a.types import InternalError

            raise ServerError(error=InternalError()) from e

def main():
    analyzer_agent_card = AgentCard(
        name="Trend Analyzer Agent",
        url="http://localhost:10021",
        description="Performs deep analysis of trends with quantitative data",
        version="1.0",
        capabilities=AgentCapabilities(streaming=True),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["application/json"],
        skills=[
            AgentSkill(
                id="analyze_trend",
                name="Analyze Trend",
                description="Provides quantitative analysis of a specific trend",
                tags=["analysis", "data", "metrics", "statistics"],
                examples=[
                    "Analyze the #ClimateChange trend",
                    "Get metrics for the Taylor Swift trend",
                    "Provide data analysis for AI adoption trend",
                ],
            )
        ],
    )

    def create_agent():
        return create_agent_a2a_server(AnalyzerAgentExecutor(), analyzer_agent_card)

    asyncio.run(run_server(create_agent, 10021, "Analyzer Agent"))

if __name__ == "__main__":
    main()
