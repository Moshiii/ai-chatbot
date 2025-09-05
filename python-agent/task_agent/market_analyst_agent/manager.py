from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence

from openai.types.responses import ResponseTextDeltaEvent
from rich.console import Console

from agents import Runner, RunResult, custom_span, gen_trace_id, trace

from .market_agent import market_agent, MarketAnalysisSummary
from .writer_agent import FinancialReportData, writer_agent


class FinancialResearchManager:
    """
    Orchestrates the market analysis and report writing flow.
    """

    def __init__(self) -> None:
        self.console = Console()

    async def run(self, query: str) -> None:
        trace_id = gen_trace_id()
        with trace("Financial research trace", trace_id=trace_id):
            market_analysis = await self._market_analysis(query)
            report = await self._write_report(query, market_analysis)
        # Print to stdout
        # print("\n\n=====REPORT=====\n\n")
        # print(f"Report summary:\n{report.short_summary}")
        # print(f"Report:\n{report.markdown_report}")
        return report.markdown_report
        
    async def _market_analysis(self, query: str) -> MarketAnalysisSummary:
        result = await Runner.run(market_agent, f"Query: {query}")
        return result.final_output_as(MarketAnalysisSummary)

    async def _write_report(self, query: str, market_analysis: MarketAnalysisSummary) -> FinancialReportData:
        input_data = f"Original query: {query}\nMarket analysis: {market_analysis}"
        result = Runner.run_streamed(writer_agent, input_data)
        update_messages = [
            "Planning report structure...",
            "Writing sections...",
            "Finalizing report...",
        ]
        last_update = time.time()
        next_message = 0
        async for _ in result.stream_events():
            if time.time() - last_update > 5 and next_message < len(update_messages):
                self.console.print(f"[INFO] {update_messages[next_message]}")
                next_message += 1
                last_update = time.time()
        return result.final_output_as(FinancialReportData)
