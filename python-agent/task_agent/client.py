import asyncio
import json
import uuid
from typing import Any, List, Dict
import httpx
from a2a.client import A2AClient
from a2a.types import AgentCard, MessageSendParams, SendMessageRequest
from openai import AsyncOpenAI
from common import log_error, Colors, log_a2a_api_call, log_a2a_protocol
import os
import dotenv
dotenv.load_dotenv()

class A2ASimpleClient:
    """A2A Simple client to call A2A servers with OpenAI LLM integration."""

    def __init__(self, default_timeout: float = 240.0, openai_api_key: str = None):
        self._agent_info_cache: dict[str, dict[str, Any] | None] = {}
        self.default_timeout = default_timeout
        
        # Initialize OpenAI client
        self.openai_client = AsyncOpenAI(api_key=openai_api_key) if openai_api_key else None
        
        # Define available agents
        self.available_agents = {
            "trending": "http://localhost:10020",
            "analyzer": "http://localhost:10021", 
            "host": "http://localhost:10022",
            "market_analysis": "http://localhost:10023"
        }
        
        log_a2a_api_call("A2ASimpleClient.__init__", f"timeout: {default_timeout}, openai_configured: {self.openai_client is not None}")
        log_a2a_protocol(f"Available agents: {list(self.available_agents.keys())}")

    async def create_task(self, agent_url: str, message: str) -> str:
        """Create a task with a specific A2A agent."""
        log_a2a_api_call("create_task", f"agent_url: {agent_url}, message_length: {len(message)}")
        
        timeout_config = httpx.Timeout(
            timeout=self.default_timeout,
            connect=10.0,
            read=self.default_timeout,
            write=10.0,
            pool=5.0,
        )
        
        log_a2a_protocol(f"Timeout config: {timeout_config}")

        try:
            log_a2a_protocol(f"Creating HTTP client with timeout: {self.default_timeout}s")
            async with httpx.AsyncClient(timeout=timeout_config) as httpx_client:
                log_a2a_protocol("HTTP client created successfully")

                # Fetch agent card
                if agent_url in self._agent_info_cache and self._agent_info_cache[agent_url] is not None:
                    agent_card_data = self._agent_info_cache[agent_url]
                    log_a2a_protocol(f"Using cached agent card for {agent_url}")
                else:
                    agent_card_url = f"{agent_url}/.well-known/agent.json"
                    log_a2a_protocol(f"Fetching agent card from: {agent_card_url}")
                    
                    try:
                        agent_card_response = await httpx_client.get(agent_card_url)
                        log_a2a_protocol(f"Agent card response status: {agent_card_response.status_code}")
                        
                        if agent_card_response.status_code != 200:
                            log_error(f"Failed to fetch agent card. Status: {agent_card_response.status_code}, Response: {agent_card_response.text}")
                            return f"Error: Failed to fetch agent card from {agent_url}. Status: {agent_card_response.status_code}"
                        
                        agent_card_data = self._agent_info_cache[agent_url] = agent_card_response.json()
                        log_a2a_protocol(f"Agent card cached successfully for {agent_url}")
                        
                    except httpx.ConnectError as e:
                        log_error(f"Connection error fetching agent card from {agent_url}: {e}")
                        return f"Error: Cannot connect to agent at {agent_url}. Please ensure the agent server is running."
                    except httpx.TimeoutException as e:
                        log_error(f"Timeout error fetching agent card from {agent_url}: {e}")
                        return f"Error: Timeout connecting to agent at {agent_url}. Please check if the agent server is responsive."
                    except Exception as e:
                        log_error(f"Unexpected error fetching agent card from {agent_url}: {e}")
                        return f"Error: Unexpected error connecting to agent at {agent_url}: {str(e)}"

                agent_card = AgentCard(**agent_card_data)
                log_a2a_protocol(f"Agent card parsed successfully: {agent_card.name}")

                client = A2AClient(httpx_client=httpx_client, agent_card=agent_card)
                log_a2a_protocol("A2A client created successfully")

                # Create message payload
                message_id = uuid.uuid4().hex
                send_message_payload = {
                    "message": {
                        "role": "user",
                        "parts": [{"kind": "text", "text": message}],
                        "messageId": message_id,
                    }
                }

                request_id = str(uuid.uuid4())
                request = SendMessageRequest(id=request_id, params=MessageSendParams(**send_message_payload))
                
                log_a2a_protocol(f"Sending message to agent. Request ID: {request_id}, Message ID: {message_id}")

                try:
                    response = await client.send_message(request)
                    log_a2a_protocol(f"Received response from agent. Request ID: {request_id}")
                    
                    response_dict = response.model_dump(mode="json", exclude_none=True)
                    log_a2a_protocol(f"Response processed successfully. Request ID: {request_id}")

                    if "result" in response_dict and "artifacts" in response_dict["result"]:
                        artifacts = response_dict["result"]["artifacts"]
                        log_a2a_protocol(f"Found {len(artifacts)} artifacts in response")
                        
                        for i, artifact in enumerate(artifacts):
                            if "parts" in artifact:
                                parts = artifact["parts"]
                                log_a2a_protocol(f"Artifact {i} has {len(parts)} parts")
                                
                                for j, part in enumerate(parts):
                                    if "text" in part:
                                        text_content = part["text"]
                                        log_a2a_protocol(f"Extracted text content from artifact {i}, part {j}")
                                        return text_content

                    log_a2a_protocol(f"No text content found in artifacts, returning full response")
                    return json.dumps(response_dict, indent=2)
                    
                except httpx.ConnectError as e:
                    log_error(f"Connection error sending message to {agent_url}: {e}")
                    return f"Error: Cannot connect to agent at {agent_url}. Please ensure the agent server is running."
                except httpx.TimeoutException as e:
                    log_error(f"Timeout error sending message to {agent_url}: {e}")
                    return f"Error: Timeout sending message to agent at {agent_url}. Please check if the agent server is responsive."
                except Exception as e:
                    log_error(f"Unexpected error sending message to {agent_url}: {e}")
                    return f"Error: Unexpected error sending message to agent at {agent_url}: {str(e)}"
                    
        except Exception as e:
            log_error(f"A2ASimpleClient.create_task() error: {e} - agent_url: {agent_url}")
            return f"Error: Failed to create task with agent at {agent_url}: {str(e)}"

    def _get_tools_schema(self) -> List[Dict[str, Any]]:
        """Define the tools schema for OpenAI function calling."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "create_task",
                    "description": "Create a task with a specific A2A agent. Use this to interact with different specialized agents.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "agent_name": {
                                "type": "string",
                                "enum": list(self.available_agents.keys()),
                                "description": "The name of the agent to call. Available agents: trending (for trending topics), analyzer (for analysis), host (for comprehensive analysis)"
                            },
                            "message": {
                                "type": "string",
                                "description": "The message or query to send to the agent"
                            }
                        },
                        "required": ["agent_name", "message"]
                    }
                }
            }
        ]

    async def process_with_llm(self, user_query: str, model: str = "gpt-4") -> str:
        """Process user query using OpenAI LLM to decide which agent to call."""
        log_a2a_api_call("process_with_llm", f"model: {model}, query_length: {len(user_query)}")
        
        if not self.openai_client:
            log_error("OpenAI client not configured - missing API key")
            raise ValueError("OpenAI API key is required for LLM processing. Please provide it in the constructor.")
        
        # Prepare the system message
        system_message = f"""You are an intelligent assistant that can interact with different specialized A2A agents. 
Available agents:
- trending: For finding trending topics and current events
- analyzer: For analyzing specific topics or trends
- host: For comprehensive analysis with quantitative data
- market_analysis: For comprehensive financial market analysis and detailed reports

Based on the user's query, decide which agent would be most appropriate and use the create_task function to interact with it.
Choose the agent that best matches the user's needs.

For complex requests that require multiple steps (like finding trends and then analyzing one), you can make multiple tool calls.
After getting a response from one agent, you can continue the conversation to fulfill the complete request.
client paid for the agent response so it is critical that you keep all the response from the agent.
"""

        log_a2a_protocol(f"Prepared system message for LLM processing")

        # Initialize conversation messages
        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_query}
        ]

        try:
            max_iterations = 5  # Prevent infinite loops
            iteration = 0
            
            while iteration < max_iterations:
                iteration += 1
                log_a2a_protocol(f"Starting iteration {iteration}")
                
                # Call OpenAI with function calling
                response = await self.openai_client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=self._get_tools_schema(),
                    tool_choice="auto"
                )

                log_a2a_protocol(f"OpenAI API call completed successfully for iteration {iteration}")
                
                # Process the response
                message = response.choices[0].message
                log_a2a_protocol(f"Processing OpenAI response for iteration {iteration}")
                
                # Add the assistant's message to the conversation
                messages.append(message)
                
                # Check if the LLM wants to call a function
                if message.tool_calls:
                    log_a2a_protocol(f"LLM wants to make {len(message.tool_calls)} tool call(s)")
                    
                    # Process all tool calls in this iteration
                    for i, tool_call in enumerate(message.tool_calls):
                        function_name = tool_call.function.name
                        function_args = json.loads(tool_call.function.arguments)
                        
                        log_a2a_protocol(f"Processing tool call {i+1}: {function_name}")
                        
                        if function_name == "create_task":
                            agent_name = function_args["agent_name"]
                            message_content = function_args["message"]
                            agent_url = self.available_agents[agent_name]
                            
                            log_a2a_protocol(f"Calling agent: {agent_name} at URL: {agent_url}")
                            print(f"{Colors.BOLD}{Colors.LIGHT_MAGENTA}LLM decided to call {agent_name} agent{Colors.ENDC}")
                            print(f"{Colors.LIGHT_BLUE}Query: {message_content}{Colors.ENDC}")
                            
                            # Call the actual agent
                            result = await self.create_task(agent_url, message_content)
                            log_a2a_protocol(f"Agent call completed, result length: {len(result) if result else 0}")
                            
                            # Add the tool result to the conversation
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": result
                            })
                    
                    # Continue the conversation to see if more tool calls are needed
                    continue
                else:
                    log_a2a_protocol(f"LLM response does not include tool calls")
                    # If no function call, return the LLM's final response
                    response_content = message.content or "No response generated"
                    log_a2a_protocol(f"Returning final LLM response, length: {len(response_content)}")
                    return response_content
            
            # If we've reached max iterations, return the last response
            log_a2a_protocol(f"Reached max iterations ({max_iterations}), returning last response")
            last_message = messages[-1]
            return last_message.get("content", "Max iterations reached")
            
        except Exception as e:
            log_error(f"process_with_llm() error: {e}")
            import traceback
            log_error(f"Full traceback: {traceback.format_exc()}")
            return f"Error processing with LLM: {str(e)}"

    async def smart_query(self, query: str) -> str:
        """Smart query that uses LLM to decide which agent to call."""
        log_a2a_api_call("smart_query", f"query_length: {len(query)}")
        log_a2a_protocol(f"Starting smart query processing")
        result = await self.process_with_llm(query)
        log_a2a_protocol(f"Smart query completed, result length: {len(result) if result else 0}")
        return result


async def run_client_tests():
    log_a2a_api_call("run_client_tests", "Starting client tests")
    
    # You'll need to set your OpenAI API key here or via environment variable
    openai_api_key = os.getenv("OPENAI_API_KEY")
    log_a2a_protocol(f"OpenAI API key configured: {openai_api_key is not None}")
    
    if not openai_api_key:
        log_error("OPENAI_API_KEY environment variable not set")
        print(f"{Colors.BOLD}{Colors.FAIL}Error: OPENAI_API_KEY environment variable not set{Colors.ENDC}")
        return
    
    a2a_client = A2ASimpleClient(openai_api_key=openai_api_key)
    log_a2a_protocol("A2A client initialized successfully")

    # Test the smart query functionality
    test_queries = [
        # "What's trending today?",
        # "Analyze the trend of AI in Social Media",
        "Find the most relevant trends in the web today, choose randomly one of the top trends, and give me a complete analysis of it with quantitative data",
        # "What are the latest developments in technology?",
        # "Give me a detailed analysis of cryptocurrency trends",
        # "Analyze the current state of the technology sector",
        # "Provide a market analysis for renewable energy stocks"
        "Analyze the current state of the NVDA stock"
    ]

    for i, query in enumerate(test_queries, 1):
        print(f"\n{Colors.BOLD}{Colors.HEADER}=== Test {i} ==={Colors.ENDC}")
        print(f"{Colors.BOLD}User Query:{Colors.ENDC} {Colors.LIGHT_BLUE}{query}{Colors.ENDC}")
        
        log_a2a_protocol(f"Starting test {i}: {query[:50]}...")
        
        try:
            result = await a2a_client.smart_query(query)
            print(f"{Colors.BOLD}{Colors.OKGREEN}Result:{Colors.ENDC}\n{Colors.LIGHT_BLUE}{result}{Colors.ENDC}")
            log_a2a_protocol(f"Test {i} completed successfully")
        except Exception as e:
            print(f"{Colors.BOLD}{Colors.FAIL}Error:{Colors.ENDC} {Colors.LIGHT_RED}{str(e)}{Colors.ENDC}")
            log_error(f"Test {i} failed: {str(e)}")
            import traceback
            log_error(f"Test {i} full traceback: {traceback.format_exc()}")
        
        print(f"{Colors.DARK_GRAY}{'='*50}{Colors.ENDC}")
    
    log_a2a_api_call("run_client_tests", "All tests completed")


if __name__ == "__main__":
    log_a2a_api_call("client.py", "Starting client.py main execution")
    asyncio.run(run_client_tests())
