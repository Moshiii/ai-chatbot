
import asyncio
from typing import Any, AsyncGenerator

from pydantic_ai import Agent
from a2a.server.tasks import TaskUpdater
from a2a.types import TaskState, AgentCard, AgentCapabilities, AgentSkill
from a2a.utils import new_agent_text_message, new_task

from .common import (
    log_error,
    create_agent_a2a_server,
    run_server,
)

import dotenv
dotenv.load_dotenv()

class HostAgent:
    """Host agent for orchestrating other agents using Pydantic AI."""

    SYSTEM_INSTRUCTION = """
    You are an expert AI Orchestrator.
    Your primary responsibility is to intelligently interpret user requests, plan the necessary sequence of actions if multiple steps are involved, and delegate them to the most appropriate specialized remote agents.
    You do not perform the tasks yourself but manage their assignment, sequence, and can monitor their status.

    Core Workflow & Decision Making:

    1.  Understand User Intent & Complexity:
        - Carefully analyze the user's request to determine the core task(s) they want to achieve. Pay close attention to keywords and the overall goal.
        - Identify if the request requires a single agent or a sequence of actions from multiple agents.

    2.  Agent Discovery & Selection:
        - You have access to sub_agents with specific capabilities.
        - Based on the user's intent:
            - For single-step requests, select the single most appropriate agent.
            - For multi-step requests, identify all necessary agents and determine the logical order of their execution.

    3.  Task Planning & Sequencing (for Multi-Step Requests):
        - Before delegating, outline the sequence of agent tasks.
        - Identify dependencies: Does Agent B need information from Agent A's completed task?
        - Execute tasks sequentially if there are dependencies.

    4.  Task Delegation & Management:
        - For the first step, provide the message extracted from the user's input.
        - For subsequent steps, include outputs from previous agents as needed.

    Communication with User:
        - Clearly inform which agent handles each task and report results.
        - Ask for clarification if necessary information is missing.
    """

    def __init__(self, trending_agent_url: str, analyzer_agent_url: str):
        self.trending_agent_url = trending_agent_url
        self.analyzer_agent_url = analyzer_agent_url
        self.agent = Agent(model="gpt-4", system_prompt=self.SYSTEM_INSTRUCTION)

    async def stream(self, query: str, context_id: str) -> AsyncGenerator[dict[str, Any], None]:
        """Stream the agent response."""

        try:
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "Analyzing your request and planning the workflow...",
            }

            # For now, we'll use a simple approach where the host agent
            # determines the workflow and provides guidance
            workflow_request = f"""
            User request: {query}
            
            Available agents:
            - Trending Topics Agent: {self.trending_agent_url}
            - Trend Analyzer Agent: {self.analyzer_agent_url}
            
            Please provide a workflow plan and guidance for this request.
            """

            response = await self.agent.run(workflow_request)

            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": response.output,
            }

        except Exception as e:
            log_error(f"HostAgent.stream() error: {str(e)} - query: '{query[:30]}...', context_id: {context_id}")
            yield {
                "is_task_complete": False,
                "require_user_input": True,
                "content": f"Error processing request: {str(e)}",
            }


class HostAgentExecutor:
    """Executor for the Host Agent."""

    def __init__(self, trending_agent_url: str, analyzer_agent_url: str):
        self.agent = HostAgent(trending_agent_url, analyzer_agent_url)

    async def execute(self, context, event_queue):
        """Execute the host agent."""
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

                    await updater.add_artifact(parts, name="orchestration_results")

                    await updater.complete()
                    break

        except Exception as e:
            log_error(
                f"HostAgentExecutor.execute() error: {str(e)} - context_id: {context.context_id}, task_id: {task.id if task else 'None'}"
            )
            from a2a.utils.errors import ServerError
            from a2a.types import InternalError

            raise ServerError(error=InternalError()) from e

def create_agent():
    host_agent_card = AgentCard(
        name="Trend Analysis Host",
        url="http://localhost:10022",
        description="Orchestrates trend discovery and analysis using specialized agents",
        version="1.0",
        capabilities=AgentCapabilities(streaming=True),
        defaultInputModes=["text/plain"],
        defaultOutputModes=["application/json"],
        skills=[
            AgentSkill(
                id="comprehensive_trend_analysis",
                name="Comprehensive Trend Analysis",
                description="Finds trending topics and provides deep analysis of the most relevant one",
                tags=["trends", "analysis", "orchestration", "insights"],
                examples=[
                    "Analyze current trends",
                    "What's trending and why is it important?",
                    "Give me a comprehensive trend report",
                ],
            )
        ],
    )
    return create_agent_a2a_server(
        HostAgentExecutor("http://localhost:10020", "http://localhost:10021"), host_agent_card
    )

def main():
    asyncio.run(run_server(create_agent, 10022, "Host Agent"))

if __name__ == "__main__":
    main()
