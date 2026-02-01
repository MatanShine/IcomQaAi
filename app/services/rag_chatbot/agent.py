"""Simple LangGraph agent with streaming support."""

from __future__ import annotations
import logging
from typing import AsyncIterator
from app.services.rag_chatbot.nodes.planning import think_node, mcq_response_node
from langgraph.graph import StateGraph, END, START
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage, BaseMessage
from app.core.config import settings
from .nodes.routers import build_ticket_or_start_router_node
from .nodes.retrieval_and_answer import build_ticket_node, capability_explanation_node
from .state import AgentState

CHECKPOINTER = MemorySaver()


class Agent:
    """Simple LangGraph agent that streams responses and node transitions."""

    def __init__(self, logger: logging.Logger):
        self.logger = logger
        self.graph = self._build_graph()

    def _build_graph(self) -> StateGraph:
        """Build the LangGraph agent graph."""
        graph = StateGraph(AgentState)

        # ---------------------- Node registrations ----------------------
        graph.add_node("think_node", think_node)
        graph.add_node("mcq_response_node", mcq_response_node)
        graph.add_node("capability_explanation_node", capability_explanation_node)
        graph.add_node("build_ticket_or_start", build_ticket_or_start_router_node)
        graph.add_node("build_ticket", build_ticket_node)

        # ---------------------------- Edges -----------------------------
        # Start the graph at think_node
        graph.add_edge(START, "think_node")

        # Tool loop: think_node can loop back to itself
        # MCQ checkpoint: think_node -> mcq_checkpoint -> mcq_response_node -> think_node
        # Capability explanation: think_node -> capability_explanation_node -> build_ticket_or_start
        # Final answer: think_node -> END
        # Build ticket: build_ticket_or_start -> build_ticket -> END

        graph.add_edge("build_ticket", END)
        graph.add_edge("mcq_response_node", "think_node")

        # Routing function for think_node conditional edge
        def think_router(state: AgentState) -> str:
            """Route based on thinking_process."""
            decision = state.get("thinking_process", "__end__")
            if decision == "mcq_checkpoint":
                # For MCQ, we'll interrupt and wait for user input
                # Route to END but checkpoint will save state
                return "__end__"
            if decision == "capability_explanation_node":
                return "capability_explanation_node"
            if decision == "think_node":
                return "think_node"  # Loop back to think_node for more tool calls
            # Default: end the graph
            return "__end__"

        graph.add_conditional_edges(
            "think_node",
            think_router,
            {
                "think_node": "think_node",  # Allow looping back
                "capability_explanation_node": "capability_explanation_node",
                "__end__": END,
            },
        )
        
        graph.add_edge("capability_explanation_node", "build_ticket_or_start")

        # Routing function for build_ticket_or_start conditional edge
        def build_ticket_router(state: AgentState) -> str:
            """Route based on whether user wants to build a ticket or send a different message."""
            routing_decision = state.get("thinking_process") or "think_node"
            if routing_decision not in ["build_ticket", "think_node"]:
                return "think_node"
            return routing_decision

        graph.add_conditional_edges(
            "build_ticket_or_start",
            build_ticket_router,
            {
                "build_ticket": "build_ticket",
                "think_node": "think_node",
            }
        )

        # Interrupt after think_node to check for MCQ or capability checkpoints
        # This allows us to save state and wait for user input when needed
        return graph.compile(
            interrupt_after=["think_node"],
            checkpointer=CHECKPOINTER
        )

    async def stream(
        self, message: str, history: list[BaseMessage] = None, thread_id: str = None
    ) -> AsyncIterator[tuple[str, str]]:
        """
        Stream the agent execution, yielding (event_type, data) tuples.

        Args:
            message: The user's message
            history: Optional conversation history (list of BaseMessage objects)
            thread_id: Thread ID for checkpointing (uses session_id)

        Yields:
            - ("node", node_name) when entering a new node
            - ("tool", tool_name) when a tool is called
            - ("output", output_dict) when there's output to stream
            - ("done", "") when complete
        """
        if not thread_id:
            raise ValueError("thread_id is required when using a checkpointer")

        config = {"configurable": {"thread_id": thread_id}}

        # Check if we're resuming from a checkpoint
        snapshot = None
        try:
            snapshot = self.graph.get_state(config)
        except Exception:
            snapshot = None

        is_interrupted = bool(snapshot and getattr(snapshot, "next", None))

        # Check what type of checkpoint we're resuming from
        awaiting_mcq = False
        awaiting_capability = False
        if snapshot:
            try:
                if hasattr(snapshot, "values") and snapshot.values:
                    # Check if we're awaiting MCQ response
                    thinking_process = snapshot.values.get("thinking_process", "")
                    output_type = snapshot.values.get("output_type", "")
                    if thinking_process == "mcq_checkpoint" or output_type == "mcq":
                        awaiting_mcq = True
                    elif thinking_process == "capability_explanation_node" or output_type == "tool":
                        # Check if it's capability explanation tool
                        output = snapshot.values.get("output", "")
                        if "capability_explanation" in output:
                            awaiting_capability = True
                    self.logger.info(
                        f"Checkpoint state: thinking_process={thinking_process}, "
                        f"output_type={output_type}, awaiting_mcq={awaiting_mcq}, "
                        f"awaiting_capability={awaiting_capability}"
                    )
            except (AttributeError, TypeError) as e:
                self.logger.warning(f"Could not access checkpoint state: {e}")

        # Handle checkpoint resumption
        if is_interrupted:
            if awaiting_mcq:
                # Resuming after MCQ: add user's answer and route to mcq_response_node
                await self.graph.aupdate_state(
                    config,
                    values={
                        "history": [HumanMessage(content=message)],
                        "thinking_process": "mcq_response_node",
                    },
                )
                # Invoke mcq_response_node directly, then continue to think_node
                # We'll manually invoke the node
                from app.services.rag_chatbot.nodes.planning import mcq_response_node
                current_state = snapshot.values if snapshot and hasattr(snapshot, "values") else {}
                current_state["history"] = current_state.get("history", []) + [HumanMessage(content=message)]
                updated_state = mcq_response_node(current_state)
                await self.graph.aupdate_state(config, values=updated_state)
                # Now continue execution from think_node
                run_input = {}
                self.logger.info("Resuming after MCQ: processed response, continuing to think_node")
            elif awaiting_capability:
                # Resuming after capability explanation: add user's response
                await self.graph.aupdate_state(
                    config,
                    values={
                        "history": [HumanMessage(content=message)],
                    },
                )
                # Continue execution - it will route to build_ticket_or_start
                run_input = {}
                self.logger.info("Resuming after capability explanation: routing to build_ticket_or_start")
            else:
                # Check if we're at a checkpoint that needs continuation
                # (e.g., after a tool call that should loop back)
                current_state = snapshot.values if snapshot and hasattr(snapshot, "values") else {}
                thinking_process = current_state.get("thinking_process", "")
                output_type = current_state.get("output_type", "")
                
                # If thinking_process is "think_node" and output_type is "tool", 
                # we're in a loop and should continue execution
                if thinking_process == "think_node" and output_type == "tool":
                    # This means we just called a tool and should loop back
                    # Don't add new message, just continue execution
                    run_input = {}
                    self.logger.info("Continuing tool loop after BM25 call")
                elif thinking_process == "__end__":
                    # Graph ended normally - check if it was build_ticket or final_answer
                    # Only reset tool_counts for these two cases, not for MCQ
                    output_type = current_state.get("output_type", "")
                    if output_type in ["ticket", "text"]:
                        # This is a new conversation turn after build_ticket or final_answer
                        # Start fresh with reset tool_counts
                        if not history:
                            history = [HumanMessage(content=message)]
                        else:
                            history = history + [HumanMessage(content=message)]
                        
                        run_input = {
                            "history": history,
                            "tool_counts": {"bm25": 0, "mcq": 0, "final_answer": 0, "capability_explanation": 0},
                            "bm25_results": [],
                        }
                        self.logger.info(f"Starting new run after {output_type}, tool_counts reset")
                    else:
                        # Graph ended but not build_ticket/final_answer - don't reset
                        run_input = None
                else:
                    # Unknown checkpoint state - try to continue
                    run_input = {}
        else:
            # New run: prepare history
            if not history:
                history = [HumanMessage(content=message)]
            else:
                # Add the current message to history
                history = history + [HumanMessage(content=message)]

            # Initialize state with history and tool counts
            run_input = {
                "history": history,
                "tool_counts": {"bm25": 0, "mcq": 0, "final_answer": 0, "capability_explanation": 0},
                "bm25_results": [],
            }
            self.logger.info(
                f"Starting new run with {len(history)} history messages"
            )

        # Skip execution if run_input is None (graph already ended)
        if run_input is None:
            yield ("done", "")
            return
        
        previous_node = None
        last_emitted_output = None
        
        # Use a while loop to handle tool call iterations
        max_iterations = 10  # Safety limit
        iteration = 0
        
        while iteration < max_iterations:
            iteration += 1
            should_continue_loop = False
            hit_tool_call = False
            
            self.logger.info(f"Starting iteration {iteration} with run_input keys: {list(run_input.keys()) if run_input else 'None'}")
            
            async for chunk in self.graph.astream(run_input, config=config, stream_mode="updates"):
                for node_name, node_state_update in chunk.items():
                    if node_name != previous_node:
                        if node_name != "__interrupt__":
                            yield ("node", node_name)
                        previous_node = node_name

                    if isinstance(node_state_update, dict):
                        output = node_state_update.get("output")
                        output_type = node_state_update.get("output_type")
                        thinking_process = node_state_update.get("thinking_process", "")
                        
                        # Debug: log what's in the chunk
                        if output_type == "tool":
                            self.logger.info(f"Chunk update from {node_name}: keys={list(node_state_update.keys())}, thinking_process={thinking_process}, output_type={output_type}")
                        
                        # Check if we hit an MCQ checkpoint - need to stop and wait for user
                        if thinking_process == "mcq_checkpoint":
                            # Emit the MCQ output first
                            if output and output_type == "mcq":
                                mcq_question = node_state_update.get("mcq_question", "")
                                mcq_answers = node_state_update.get("mcq_answers", [])
                                yield ("output", {
                                    "output_type": output_type,
                                    "question": mcq_question,
                                    "answers": mcq_answers
                                })
                            # Stop execution here - checkpoint is saved, wait for user response
                            self.logger.info("MCQ checkpoint reached, stopping execution to wait for user input")
                            yield ("done", "")
                            return
                        
                        # Check if we hit capability explanation checkpoint
                        if thinking_process == "capability_explanation_node" and output_type == "tool":
                            # Emit tool event
                            if output:
                                tool_name = output.replace("tool: ", "") if output.startswith("tool: ") else output
                                yield ("tool", tool_name)
                            # Stop execution here - checkpoint is saved, wait for user response
                            self.logger.info("Capability explanation checkpoint reached, stopping execution to wait for user input")
                            yield ("done", "")
                            return
                        
                        # Emit tool name if it's a tool call
                        if output_type == "tool":
                            tool_name = output.replace("tool: ", "") if output.startswith("tool: ") else output
                            yield ("tool", tool_name)
                            # Don't set last_emitted_output for tool events, allow text output after
                        
                        # Emit output if it exists and is different from last emitted
                        if output and output_type and output != last_emitted_output:
                            if output_type == "mcq":
                                # MCQ output with question and answers as separate fields
                                mcq_question = node_state_update.get("mcq_question", "")
                                mcq_answers = node_state_update.get("mcq_answers", [])
                                yield ("output", {
                                    "output_type": output_type,
                                    "question": mcq_question,
                                    "answers": mcq_answers
                                })
                                last_emitted_output = output
                            elif output_type == "text":
                                # Final answer - stream it
                                yield ("output", {
                                    "output_type": output_type,
                                    "token": output
                                })
                                last_emitted_output = output
                            elif output_type == "ticket":
                                # Ticket output - parse JSON and include fields directly
                                try:
                                    import json
                                    ticket_data = json.loads(output)
                                    yield ("output", {
                                        "output_type": output_type,
                                        "category": ticket_data.get("category", ""),
                                        "title": ticket_data.get("title", ""),
                                        "description": ticket_data.get("description", "")
                                    })
                                except (json.JSONDecodeError, AttributeError, TypeError) as e:
                                    # Fallback if JSON parsing fails (in Hebrew)
                                    self.logger.warning(f"Failed to parse ticket JSON: {e}")
                                    yield ("output", {
                                        "output_type": output_type,
                                        "category": "בקשת תמיכה",
                                        "title": "בקשת תמיכת לקוחות",
                                        "description": output if isinstance(output, str) else "המשתמש ביקש סיוע מתמיכת לקוחות."
                                    })
                                last_emitted_output = output
                        
                        # Check if we should continue looping (tool call that loops back)
                        # Also check if output_type is "tool" - that means we called a tool and should loop
                        if output_type == "tool":
                            hit_tool_call = True
                            self.logger.info(f"Detected tool call (output_type=tool) in iteration {iteration}")
                            if thinking_process == "think_node":
                                should_continue_loop = True
                                self.logger.info(f"thinking_process is 'think_node', will continue loop")
                            else:
                                self.logger.info(f"thinking_process is '{thinking_process}', will check state after stream")
            
            # After stream completes, check the actual state to see if we should continue
            current_snapshot = None
            try:
                current_snapshot = self.graph.get_state(config)
            except Exception as e:
                self.logger.warning(f"Error getting state snapshot: {e}")
                current_snapshot = None
            
            is_current_interrupted = False
            current_thinking_process = ""
            current_output_type = ""
            
            if current_snapshot:
                is_current_interrupted = bool(getattr(current_snapshot, "next", None))
                if hasattr(current_snapshot, "values") and current_snapshot.values:
                    current_thinking_process = current_snapshot.values.get("thinking_process", "")
                    current_output_type = current_snapshot.values.get("output_type", "")
            
            self.logger.info(
                f"After iteration {iteration}: thinking_process={current_thinking_process}, "
                f"output_type={current_output_type}, interrupted={is_current_interrupted}, "
                f"should_continue_flag={should_continue_loop}, hit_tool_call={hit_tool_call}"
            )
            
            # Check if we should continue looping
            # Priority: If we hit a tool call OR output_type is "tool", always continue
            # The tool was called, so we need to loop back to think_node to process the result
            if hit_tool_call or current_output_type == "tool":
                # Force thinking_process to "think_node" to ensure router routes correctly
                try:
                    await self.graph.aupdate_state(
                        config,
                        values={"thinking_process": "think_node"}
                    )
                except Exception as e:
                    self.logger.warning(f"Error updating state: {e}")
                run_input = {}
                self.logger.info(f"Continuing tool loop iteration {iteration} (tool was called: hit_tool_call={hit_tool_call}, output_type={current_output_type})")
                continue
            elif hit_tool_call and is_current_interrupted:
                # We hit a tool call and are interrupted - continue the loop
                # Pass empty dict to continue from checkpoint (LangGraph will resume automatically)
                run_input = {}
                self.logger.info(f"Continuing tool loop iteration {iteration} (hit_tool_call=True, interrupted=True)")
                continue
            elif current_thinking_process == "think_node" and current_output_type == "tool" and is_current_interrupted:
                # Continue the loop with empty input
                run_input = {}
                self.logger.info(f"Continuing tool loop iteration {iteration} (from state check)")
                continue
            elif current_thinking_process == "__end__":
                # Graph ended normally
                self.logger.info("Graph ended normally with __end__")
                break
            elif should_continue_loop and is_current_interrupted:
                # Also check the flag we set during processing
                run_input = {}
                self.logger.info(f"Continuing tool loop iteration {iteration} (from flag)")
                continue
            elif not is_current_interrupted and not hit_tool_call and current_output_type != "tool":
                # Graph completed without interruption and no tool call
                self.logger.info("Graph completed without interruption and no tool call")
                break
            
            # If we get here, either the graph ended or we hit a checkpoint
            self.logger.info(f"Breaking loop after iteration {iteration}")
            break
        
        yield ("done", "")
