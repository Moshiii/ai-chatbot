from pydantic import BaseModel
import os
from openai import OpenAI
import dotenv
from .interface import get_YFin_data_online, get_stock_stats_indicators_window
from typing import Annotated
from agents import Agent, function_tool

dotenv.load_dotenv()


@function_tool
def get_YFin_data_online_tool(
    symbol: Annotated[str, "ticker symbol of the company"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
):
    print(f"DEBUG: get_YFin_data_online called with symbol: {symbol}, start_date: {start_date}, end_date: {end_date}")
    return get_YFin_data_online(symbol, start_date, end_date)

@function_tool
def get_stock_stats_indicators_window_tool(
    symbol: Annotated[str, "ticker symbol of the company"],
    indicator: Annotated[str, "technical indicator to get the analysis and report of"],
    curr_date: Annotated[str, "The current trading date you are trading on, YYYY-mm-dd"],
    look_back_days: Annotated[int, "how many days to look back"],
):
    print(f"DEBUG: get_stock_stats_indicators_window called with symbol: {symbol}, indicator: {indicator}, curr_date: {curr_date}, look_back_days: {look_back_days}")
    return get_stock_stats_indicators_window(symbol, indicator, curr_date, look_back_days)

# Market analysis agent focused on technical analysis and market trends
MARKET_PROMPT = (
    "You are a trading assistant tasked with analyzing financial markets. Your role is to select the **most relevant indicators** for a given market condition or trading strategy from the following list. The goal is to choose up to **8 indicators** that provide complementary insights without redundancy. Categories and each category's indicators are:\n\n"
    "Moving Averages:\n"
    "- close_50_sma: 50 SMA: A medium-term trend indicator. Usage: Identify trend direction and serve as dynamic support/resistance. Tips: It lags price; combine with faster indicators for timely signals.\n"
    "- close_200_sma: 200 SMA: A long-term trend benchmark. Usage: Confirm overall market trend and identify golden/death cross setups. Tips: It reacts slowly; best for strategic trend confirmation rather than frequent trading entries.\n"
    "- close_10_ema: 10 EMA: A responsive short-term average. Usage: Capture quick shifts in momentum and potential entry points. Tips: Prone to noise in choppy markets; use alongside longer averages for filtering false signals.\n\n"
    "MACD Related:\n"
    "- macd: MACD: Computes momentum via differences of EMAs. Usage: Look for crossovers and divergence as signals of trend changes. Tips: Confirm with other indicators in low-volatility or sideways markets.\n"
    "- macds: MACD Signal: An EMA smoothing of the MACD line. Usage: Use crossovers with the MACD line to trigger trades. Tips: Should be part of a broader strategy to avoid false positives.\n"
    "- macdh: MACD Histogram: Shows the gap between the MACD line and its signal. Usage: Visualize momentum strength and spot divergence early. Tips: Can be volatile; complement with additional filters in fast-moving markets.\n\n"
    "Momentum Indicators:\n"
    "- rsi: RSI: Measures momentum to flag overbought/oversold conditions. Usage: Apply 70/30 thresholds and watch for divergence to signal reversals. Tips: In strong trends, RSI may remain extreme; always cross-check with trend analysis.\n\n"
    "Volatility Indicators:\n"
    "- boll: Bollinger Middle: A 20 SMA serving as the basis for Bollinger Bands. Usage: Acts as a dynamic benchmark for price movement. Tips: Combine with the upper and lower bands to effectively spot breakouts or reversals.\n"
    "- boll_ub: Bollinger Upper Band: Typically 2 standard deviations above the middle line. Usage: Signals potential overbought conditions and breakout zones. Tips: Confirm signals with other tools; prices may ride the band in strong trends.\n"
    "- boll_lb: Bollinger Lower Band: Typically 2 standard deviations below the middle line. Usage: Indicates potential oversold conditions. Tips: Use additional analysis to avoid false reversal signals.\n"
    "- atr: ATR: Averages true range to measure volatility. Usage: Set stop-loss levels and adjust position sizes based on current market volatility. Tips: It's a reactive measure, so use it as part of a broader risk management strategy.\n\n"
    "Volume-Based Indicators:\n"
    "- vwma: VWMA: A moving average weighted by volume. Usage: Confirm trends by integrating price action with volume data. Tips: Watch for skewed results from volume spikes; use in combination with other volume analyses.\n\n"
    "Select indicators that provide diverse and complementary information. Avoid redundancy (e.g., do not select both rsi and stochrsi). Also briefly explain why they are suitable for the given market context. When you tool call, please use the exact name of the indicators provided above as they are defined parameters, otherwise your call will fail. Please make sure to call get_YFin_data first to retrieve the CSV that is needed to generate indicators. Write a very detailed and nuanced report of the trends you observe. Do not simply state the trends are mixed, provide detailed and finegrained analysis and insights that may help traders make decisions. Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read.\n\n"
    "Based on your analysis, provide a specific recommendation to buy, sell, or hold. End with a firm decision and always conclude your response with 'FINAL TRANSACTION PROPOSAL: **BUY/HOLD/SELL**' to confirm your recommendation."
)


class MarketAnalysisSummary(BaseModel):
    summary: str
    """Short text summary for this aspect of the analysis."""


market_agent = Agent(
    name="MarketAnalystAgent",
    instructions=MARKET_PROMPT,
    model="gpt-4o",
    output_type=MarketAnalysisSummary,
    tools=[get_YFin_data_online_tool, get_stock_stats_indicators_window_tool]
) 