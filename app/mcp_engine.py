import asyncio
import json
import traceback
from typing import Dict, Any, Optional
import os

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class MCPEngineManager:
    """
    Manages background MCP Server processes and their active ClientSessions.
    Provides methods to start, stop, and retrieve connections for autonomous orchestration.
    """
    def __init__(self):
        self.active_servers: Dict[int, dict] = {} # agent_id -> context dict

    async def start_mcp_server(self, agent_id: int, command: str, args: list, env: dict = None):
        """Starts a background process for an MCP server via stdio and stores the session."""
        if agent_id in self.active_servers:
            await self.stop_mcp_server(agent_id)
            
        try:
            # Prepare environment gracefully merging with host env
            full_env = os.environ.copy()
            if env:
                full_env.update(env)
                
            server_params = StdioServerParameters(command=command, args=args, env=full_env)
            stdio_ctx = stdio_client(server_params)
            read_stream, write_stream = await stdio_ctx.__aenter__()
            
            session_ctx = ClientSession(read_stream, write_stream)
            session = await session_ctx.__aenter__()
            
            await session.initialize()
            
            self.active_servers[agent_id] = {
                "stdio_ctx": stdio_ctx,
                "session_ctx": session_ctx,
                "session": session,
                "command": command
            }
            print(f"[MCP Engine] Successfully started MCP Server for Agent {agent_id} ({command})")
            return True
        except Exception as e:
            # Detailed debug for process failure
            print(f"[MCP Engine] Error starting MCP Server for Agent {agent_id}: {repr(e)}. (Is the server script/command correct?)")
            return False

    async def start_mcp_client(self, agent_id: int, url: str, auth_token: str = None):
        """Starts a background connection to a remote MCP server via SSE."""
        if agent_id in self.active_servers:
            await self.stop_mcp_server(agent_id)
            
        try:
            from mcp.client.sse import sse_client
            headers = {}
            if auth_token:
                headers["Authorization"] = f"Bearer {auth_token}"
                
            sse_ctx = sse_client(url, headers=headers)
            read_stream, write_stream = await sse_ctx.__aenter__()
            
            sess_ctx = ClientSession(read_stream, write_stream)
            session = await sess_ctx.__aenter__()
            
            await session.initialize()
            
            self.active_servers[agent_id] = {
                "stdio_ctx": sse_ctx, # mapped identically to stdio_ctx for stop_mcp_server compat
                "session_ctx": sess_ctx,
                "session": session,
                "command": f"SSE Client -> {url}"
            }
            print(f"[MCP Engine] Successfully connected SSE Client for Agent {agent_id} ({url})")
            return True
        except Exception as e:
            print(f"[MCP Engine] Error connecting SSE for Agent {agent_id}: {repr(e)}. (Is the SSE endpoint running locally?)")
            return False

    async def stop_mcp_server(self, agent_id: int):
        """Safely tears down the MCP session and sub-process."""
        if agent_id in self.active_servers:
            srv = self.active_servers[agent_id]
            try:
                # Order matters: exit session first, then stdio pipes
                await srv["session_ctx"].__aexit__(None, None, None)
                await srv["stdio_ctx"].__aexit__(None, None, None)
            except Exception as e:
                print(f"[MCP Engine] Error stopping Agent {agent_id}: {e}")
            finally:
                del self.active_servers[agent_id]
                print(f"[MCP Engine] Stopped MCP Server {agent_id}")

    async def stop_all(self):
        """Safely stops all active MCP servers."""
        agent_ids = list(self.active_servers.keys())
        for a_id in agent_ids:
            await self.stop_mcp_server(a_id)
        print("[MCP Engine] All servers stopped gracefully.")

    def get_session(self, agent_id: int) -> Optional[ClientSession]:
        """Returns the active ClientSession object for tool calling."""
        return self.active_servers.get(agent_id, {}).get("session")

    async def get_all_tools(self) -> list:
        """
        Gathers tools from all currently active MCP servers.
        Useful for the Autonomous Multi-Agent orchestrator.
        """
        all_tools = []
        for a_id, srv in self.active_servers.items():
            session = srv.get("session")
            if session:
                try:
                    tools_res = await session.list_tools()
                    # Tag tools with the agent_id to route execution properly later
                    for tool in tools_res.tools:
                        all_tools.append({
                            "agent_id": a_id,
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.inputSchema
                        })
                except Exception as e:
                    print(f"[MCP Engine] Failed to list tools for Agent {a_id}: {e}")
        return all_tools

    async def call_tool(self, agent_id: int, tool_name: str, arguments: dict) -> Any:
        """Executes a specific tool on a specific hooked MCP server."""
        session = self.get_session(agent_id)
        if not session:
            raise RuntimeError(f"Agent {agent_id} MCP session not active or not found.")
        
        result = await session.call_tool(tool_name, arguments)
        return result

import asyncio
import json

hitl_events = {}

def resolve_hitl_approval(session_id: str, approved: bool):
    if session_id in hitl_events:
        hitl_events[session_id]["approved"] = approved
        hitl_events[session_id]["event"].set()
        return True
    return False

async def Autonomous_Agent_async_stream(agent_name: str, prompt_text: str, system_prompt: str, history_text: str, combined_context: str, mcp_manager: MCPEngineManager, hitl_enabled: bool = False, session_id: str = None, user_id: int = None):
    """
    Agentic loop that uses Google GenAI to automatically resolve tools
    and return the final streamed (chunked) answer to the frontend.
    """
    mcp_tools = await mcp_manager.get_all_tools()
    
    from google import genai
    from google.genai import types
    
    declarations = []
    tool_map = {}
    for t in mcp_tools:
        safe_name = f"a{t['agent_id']}_{t['name']}".replace("-", "_")
        decl = types.FunctionDeclaration(
            name=safe_name,
            description=t["description"] or "No description provided",
            parameters=t["input_schema"]
        )
        declarations.append(decl)
        tool_map[safe_name] = t
        
    gemini_tools = [types.Tool(function_declarations=declarations)] if declarations else None
    
    api_key = os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    full_prompt = f"""
당신은 사내 지식 기반 사용자 맞춤형 자율(Autonomous) 에이전트 '{agent_name}'입니다.

[Agent System Prompt]
{system_prompt}

[RAG Document Context] (Use this heavily to answer if relevant)
{combined_context}

[Previous Conversation Context]
{history_text}

[User Question]
{prompt_text}

CRITICAL INSTRUCTIONS:
1. You MUST answer the user in Korean.
2. Formulate your final response in Markdown, but CRITICALLY: DO NOT output any raw Python source code, script blocks (e.g., ````python ... ````), or internal thought processes in your final answer. You must ONLY output the final extracted results, summary, and human-readable explanation.
3. You have access to various tools through the MCP clients. Use them if necessary to answer the user's question, execute actions, or fulfill the request. 
4. If you execute a tool, analyze the result and determine if you need to use another tool or if you have enough information to provide the final answer to the user.
"""

    messages = [types.Content(role="user", parts=[types.Part.from_text(text=full_prompt)])]
    
    max_turns = 15
    turn = 0
    
    while turn < max_turns:
        turn += 1
        
        config_args = {"temperature": 0}
        if gemini_tools:
            config_args["tools"] = gemini_tools
            
        try:
            response = await client.aio.models.generate_content(
                model='gemini-flash-lite-latest',
                contents=messages,
                config=types.GenerateContentConfig(**config_args)
            )
            
            if not response.candidates:
                yield json.dumps({"type": "chunk", "data": "\n\n❌ 에러: 응답을 생성하지 못했습니다."}) + "\n"
                break
                
            candidate = response.candidates[0]
            
            # Save model response to history immediately
            if candidate.content:
                messages.append(candidate.content)
            
            has_func_calls = False
            if candidate.content and candidate.content.parts:
                for part in candidate.content.parts:
                    if part.function_call:
                        has_func_calls = True
                        fc = part.function_call
                        func_name = fc.name
                        
                        args_dict = {}
                        if hasattr(fc, 'args'):
                            if isinstance(fc.args, dict):
                                args_dict = fc.args
                            elif hasattr(fc.args, 'items'): # Struct representation handling
                                args_dict = dict((k, v) for k, v in fc.args.items())
                                
                        if hitl_enabled and session_id:
                            yield json.dumps({"type": "hitl_request", "data": {"func_name": func_name, "args": args_dict}}) + "\n"
                            
                            event = asyncio.Event()
                            hitl_events[session_id] = {"event": event, "approved": False}
                            
                            is_approved = False
                            wait_time = 0
                            while wait_time < 300: # 5 minutes max wait
                                try:
                                    await asyncio.wait_for(event.wait(), timeout=2.0)
                                    is_approved = hitl_events.get(session_id, {}).get("approved", False)
                                    break
                                except asyncio.TimeoutError:
                                    wait_time += 2
                                    yield json.dumps({"type": "ping"}) + "\n"
                            
                            hitl_events.pop(session_id, None)
                            
                            if not is_approved:
                                yield json.dumps({"type": "status", "data": f"❌ **실행 거절:** 사용자가 `{func_name}` 실행을 취소했습니다."}) + "\n"
                                res_text = "Action explicitly denied by User. Do something else or tell the user."
                                messages.append(types.Content(
                                    role="user",
                                    parts=[types.Part.from_function_response(name=func_name, response={"result": res_text})]
                                ))
                                continue
                                
                        yield json.dumps({"type": "status", "data": f"🛠️ **도구 호출 중:** `{func_name}`"}) + "\n"
                        
                        try:
                            if func_name in tool_map:
                                t_info = tool_map[func_name]
                                result = await mcp_manager.call_tool(t_info["agent_id"], t_info["name"], args_dict)
                                res_text = str(result)
                                yield json.dumps({"type": "status", "data": f"✅ **도구 성공:** 데이터를 분석 중입니다."}) + "\n"
                            else:
                                res_text = f"Tool {func_name} not found"
                                yield json.dumps({"type": "status", "data": f"❌ **도구 실패:** 존재하지 않는 도구입니다."}) + "\n"
                        except Exception as e:
                            res_text = str(e)
                            yield json.dumps({"type": "status", "data": f"❌ **도구 호출 에러:** {str(e)}"}) + "\n"
                            
                        # Append tool response
                        messages.append(types.Content(
                            role="user",
                            parts=[types.Part.from_function_response(name=func_name, response={"result": res_text})]
                        ))
                        
            if not has_func_calls:
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.text:
                            yield json.dumps({"type": "chunk", "data": part.text}) + "\n"
              
            if hasattr(response, 'usage_metadata') and response.usage_metadata and user_id:
                pt = getattr(response.usage_metadata, 'prompt_token_count', 0)
                ct = getattr(response.usage_metadata, 'candidates_token_count', 0)
                if pt > 0 or ct > 0:
                    from pageindex.utils import log_token_usage_async
                    asyncio.create_task(log_token_usage_async(user_id, 'gemini-flash-lite-latest', pt, ct))
                    
            if not has_func_calls:
                break
        except Exception as e:
            import traceback
            yield json.dumps({"type": "chunk", "data": f"\n\n**에이전트 추론 루프 중 오류가 발생했습니다:** {str(e)}\n\n```text\n{traceback.format_exc()}\n```\n"}) + "\n"
            break


# Global singleton manager
mcp_manager = MCPEngineManager()
