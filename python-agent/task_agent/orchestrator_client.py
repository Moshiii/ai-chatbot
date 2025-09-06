import asyncio
import os
import uuid
import httpx
from a2a.client import A2AClient
from a2a.types import AgentCard, MessageSendParams, SendMessageRequest, AgentCapabilities, AgentSkill
from common import log_error, log_a2a_api_call, log_a2a_protocol
from orchestrator_executor import Orchestrator

async def main():
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        log_error("OPENAI_API_KEY environment variable not set")
        print("Error: OPENAI_API_KEY environment variable not set")
        return

    orchestrator = Orchestrator(openai_api_key=openai_api_key)
    log_a2a_api_call("main", "Orchestrator initialized successfully")

    # Example query
    example_query = "Analyze the current state of the NVDA stock"
    log_a2a_protocol(f"Sending example query: {example_query}")

    # Generate real task_id and context_id using UUID
    task_id = str(uuid.uuid4())
    context_id = str(uuid.uuid4())

    # Create message payload following A2A standard
    message_id = uuid.uuid4().hex
    send_message_payload = {
        "message": {
            "role": "user",
            "parts": [{"kind": "text", "text": example_query}],
            "messageId": message_id,
        }
    }

    request_id = str(uuid.uuid4())
    request = SendMessageRequest(id=request_id, params=MessageSendParams(**send_message_payload))

    # Use A2AClient to ensure protocol alignment
    async with httpx.AsyncClient(timeout=60.0) as httpx_client:  # Increased timeout to 60 seconds
        agent_card = AgentCard(
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

        client = A2AClient(httpx_client=httpx_client, agent_card=agent_card)
        log_a2a_protocol(f"Sending message to agent. Request ID: {request_id}, Message ID: {message_id}")
        response = await client.send_message(request)
        log_a2a_protocol(f"Response received: {response}")

if __name__ == "__main__":
    asyncio.run(main())
