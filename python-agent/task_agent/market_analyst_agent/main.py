import asyncio
import os
from manager import FinancialResearchManager
import dotenv

dotenv.load_dotenv()

async def main() -> None:
    # query = input("Enter a financial research query: ")
    query = "NVDA 2025-08-25"
    
    mgr = FinancialResearchManager()
    await mgr.run(query)

if __name__ == "__main__":
    asyncio.run(main())
