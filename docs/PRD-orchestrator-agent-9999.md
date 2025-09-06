### Orchestrator Agent Server on Port 9999 — PRD

#### Document Status

- Owner: Platform/Agents
- Stakeholders: Web App (Next.js), Backend, DevOps
- Status: Proposal
- Target Release: v1 (dev usage), v1.1 (DX polish)

## 1) Context

The Next.js app is already configured to communicate with an A2A agent at `http://localhost:9999`. Our Python agent repository contains multiple entry points and helpers that can run an A2A server and several specialized agents (Trending, Analyzer, Host, Market Analysis). Today, there are overlapping ways to start the orchestrator server, making it unclear which command should be used in development and which process should be long-lived for the Next.js app to reach.

This PRD proposes a clear, single entry point that launches an always-on A2A server exposing the Orchestrator agent on port 9999 (localhost). It also proposes small, low-risk code/config changes to ensure robust startup, consistent dependency management, and compatibility with the Next.js tool `requestA2AAgent`.

## 2) Goals

- Provide a single, reliable command to run an A2A server that exposes the Orchestrator agent on port 9999.
- Ensure compatibility with the Next.js client, which is already configured to talk to `http://localhost:9999`.
- Make startup resilient and developer-friendly: clear logs, sensible defaults, `.env`-driven configuration.
- Keep specialized agents (10020/10021/10022/10023) available for orchestration.

## 3) Non‑Goals

- Production hardening (Docker, Kubernetes, TLS, autoscaling) is out of scope for this iteration, but see Future Work.
- Changing Next.js integration beyond confirming the port and URL is out of scope.

## 4) Current State (Findings)

- There are two ways to start an A2A server:
  - `task_agent/__main__.py` starts an A2AStarlette application on port 9999 and concurrently `run_all_agents()` (specialized agents).
  - `task_agent/orchestrator_executor.py` also defines a `main()` that starts an A2A server on port 9999.
    This duplication creates ambiguity and potential port conflicts if both are started.

- `task_agent/run.sh` currently launches `orchestrator_executor.py` in the background, then runs a client test, and kills the server — not suitable as a long‑running service the Next.js app can talk to.

- Packaging mismatch:
  - `python-agent/pyproject.toml` declares project name `canvas-agent` and a console script targeting a non‑existent `canvas_agent.__main__`. The actual package is `task_agent`. Many required dependencies (openai, pandas, yfinance, stockstats, rich) are only present in `requirements.txt`, not in `pyproject.toml`.

- Orchestrator agent mapping:
  - `orchestrator_executor.py` defines `available_agents` for `trending`, `analyzer`, `host`. `market_analysis` is commented out, yet `_determine_best_agent()` can return `market_analysis` on finance/stock queries, leading to “Agent not available” responses.

- Environment & key loading:
  - `orchestrator_executor.Orchestrator` supports `openai_api_key` but some entry points instantiate it without passing the key, falling back to rule‑based task generation.

## 5) Proposed Changes (Summary)

1. Single official entry point: `python -m task_agent` runs the server on port 9999 and starts specialized agents. This will be our canonical dev command.
2. Enable market analysis agent in orchestrator mappings and ensure ports are aligned:
   - Add `"market_analysis": "http://localhost:10023"` to `available_agents`.
3. Pass `OPENAI_API_KEY` into `Orchestrator` in `__main__.py` to unlock LLM‑based task generation when available.
4. Packaging alignment for DX:
   - Update `pyproject.toml` to: set project name to `task-agent` (or `a2a-task-agent`), include runtime dependencies currently only in `requirements.txt`, and add a console script `task-orchestrator = task_agent.__main__:main`.
   - Keep `requirements.txt` for quick pip installs; ensure both methods work.
5. Developer ergonomics:
   - Replace `run.sh` with a simple “dev server” script that only starts the long‑running orchestrator (`python -m task_agent`), and optionally a separate script to start all specialized agents individually if needed.
6. Optional: add a minimal `GET /healthz` endpoint to the A2A Starlette app for health checks (200 OK body: `"ok"`).

## 6) Architecture & Flow

- Orchestrator A2A server
  - Port: 9999
  - Host: 127.0.0.1 (bind to localhost for dev; can be made 0.0.0.0 via env if needed)
  - Agent: `Orchestrator` (task decomposition + delegations)
  - Reads `OPENAI_API_KEY` from `.env` (if set) to enable LLM‑based task generation; otherwise uses rule‑based fallback.

- Specialized Agents (launched by `run_all_agents()`):
  - Trending (10020), Analyzer (10021), Host (10022)
  - Market Analysis (10023) - **Disabled due to TensorFlow dependency issues**
  - Orchestrator’s `available_agents` must include all running agents to enable hand‑offs.

- Next.js integration
  - Next.js `requestA2AAgent` tool sends requests to `http://localhost:9999`.
  - Blocking responses (streaming) are supported; structured artifacts/task parts are emitted in A2A format.

## 7) Detailed Implementation Plan

Minimal, localized edits (no API surface changes to the web app):

1. `task_agent/__main__.py`
   - Ensure Orchestrator is instantiated with `openai_api_key=os.getenv("OPENAI_API_KEY")`.
   - Keep server at port 9999. Optionally allow `AGENT_PORT` env var with default 9999.

2. `task_agent/orchestrator_executor.py`
   - In `__init__`: include `"market_analysis": "http://localhost:10023"` in `self.available_agents`.
   - No functional changes to A2A protocol.

3. `python-agent/pyproject.toml`
   - Set `[project] name = "task-agent"` (or `a2a-task-agent`).
   - Add all runtime dependencies currently in `requirements.txt` into `[project].dependencies`.
   - Add console script:
     - `task-orchestrator = task_agent.__main__:main`

4. `python-agent/task_agent/run.sh`
   - Replace with a simple dev starter that runs only `python -m task_agent` (remove the client test that kills the server). Optionally provide a separate `run-all-agents.sh` for launching sub‑agents if needed outside `__main__.py`.

5. Optional `healthz`
   - Extend the Starlette application builder to mount `GET /healthz` returning `200 ok` for monitoring/diagnostics.

## 8) Configuration

- `.env` (in `python-agent/`):
  - `OPENAI_API_KEY=...` (optional; enables LLM task generation)
  - `DATA_DIR=python-agent/data_cache` (used by market analysis tools)
  - `AGENT_HOST=127.0.0.1` (optional)
  - `AGENT_PORT=9999` (optional)

## 9) Developer Experience (Commands)

- One‑time setup:
  - `cd python-agent`
  - `python -m venv .venv && source .venv/bin/activate`
  - `pip install -r requirements.txt` (fast path) OR `pip install -e .` after `pyproject.toml` fix
  - `cp .env.example .env` and set `OPENAI_API_KEY` if available

- Start orchestrator server (recommended):
  - `python -m task_agent`
  - Expected log: "Starting Task Agent Server on port 9999" and sub‑agents on 10020/10021/10022/10023

- Next.js app already points to `http://localhost:9999`; no further client changes are needed.

## 10) Acceptance Criteria

- Starting the agent via `python -m task_agent` launches an A2A server on port 9999 and the sub‑agents.
- `GET http://localhost:9999/.well-known/agent.json` returns a valid Agent Card.
- Next.js `requestA2AAgent` tool can send a blocking request and receives:
  - A TaskArtifactUpdateEvent containing A2A‑compliant `data` parts with tasks.
  - A final TaskStatusUpdateEvent with state `completed`.
- For market/stock queries, Orchestrator selects the `analyzer` agent (market analysis agent disabled due to dependency issues).

## 11) Risks & Mitigations

- Port conflicts (9999 already in use): allow overriding host/port via `.env`.
- Missing `OPENAI_API_KEY`: fallback path remains rule‑based; clearly log the mode.
- Dependency drift between `pyproject.toml` and `requirements.txt`: unify in `pyproject.toml` and keep `requirements.txt` as a mirror for quick installs.

## 12) Rollout Plan

1. Implement minimal code edits listed above.
2. Update `pyproject.toml` and add console script.
3. Replace `run.sh` with a persistent dev server starter.
4. Validate locally:
   - Start orchestrator; verify agent card and health.
   - From Next.js app, run a task and observe artifacts.
5. Document commands in `python-agent/README.md` (add a “Quick Start (Next.js integration)” section).

## 13) Future Work

- Dockerfile and `docker-compose` for Next.js + agents.
- Production observability (structured logs, metrics, traces).
- Graceful shutdown and readiness checks.
- CI job that lints, runs mypy/ruff (for Python) and a headless A2A smoke test (`/.well-known/agent.json`).
