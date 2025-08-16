# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `pnpm dev` - Start development server with Turbo (http://localhost:3000)
- `pnpm build` - Run database migrations and build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run Next.js and Biome linting with auto-fix
- `pnpm format` - Format code with Biome
- `pnpm test` - Run Playwright e2e tests (requires PLAYWRIGHT=True env var)

### Database Operations
- `pnpm db:migrate` - Run database migrations
- `pnpm db:studio` - Open Drizzle Studio
- `pnpm db:generate` - Generate migration files
- `pnpm db:push` - Push schema changes directly to database
- `pnpm db:pull` - Pull schema from database
- `pnpm db:check` - Check migration files

### Testing
Tests use Playwright and are located in `/tests/`. Two test suites:
- `e2e` tests: Browser-based integration tests
- `routes` tests: API route testing
Run specific test: `pnpm exec playwright test --grep "test-name"`

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 15 with App Router and React Server Components
- **AI**: Vercel AI SDK with streaming, tool calls, and multiple providers (xAI Grok, OpenAI, A2A Python agents)
- **Database**: PostgreSQL with Drizzle ORM
- **UI**: shadcn/ui components with Tailwind CSS
- **Auth**: Auth.js with GitHub OAuth
- **Storage**: Vercel Blob for file uploads
- **Package Manager**: pnpm

### Core Application Flow

The app implements a sophisticated real-time streaming chatbot with visual workflow management:

1. **Chat API Route** (`app/(chat)/api/chat/route.ts`): Central orchestration layer handling authentication, tool selection, and stream management
2. **Tool System**: AI-powered utilities including `planTasks`, `createTask`, `updateTask`, `createDocument`, `updateDocument`, `getWeather`, and `requestSuggestions`
3. **Canvas System**: Interactive ReactFlow-based visual interface for task decomposition and agent workflows
4. **Streaming Architecture**: Uses AI SDK's streaming with custom data events for real-time UI updates

### Key Components

**Chat Route**: Supports multiple models including reasoning model (no tools) and regular chat model (full tools). Tools are conditionally enabled based on model selection.

**Data Stream Handler** (`components/data-stream-handler.tsx`): Processes streaming events including `data-textDelta`, `data-kind`, `data-id`, `data-title`, `data-clear`, and `data-finish`.

**Canvas Flow** (`components/canvas-flow.tsx`): ReactFlow-based component with specialized node types for tasks, agents, and responses. Supports visual task management with agent assignment and execution.

**AI Tools** (`lib/ai/tools/`): Server-side tools that stream responses to UI, including task planning and canvas creation with agent simulation.

### Database Schema

**Core Tables**:
- `User`: User accounts with credit balance
- `Chat`: Chat sessions with visibility settings
- `Message_v2`: Messages with parts-based content structure
- `Document`: Artifacts (text, code, canvas, image, sheet) with versioning
- `Suggestion`: Document editing suggestions
- `Stream`: Stream state management

**Migration Pattern**: Uses timestamped SQL migrations in `lib/db/migrations/` with Drizzle schema definitions.

### Python Task Agent Integration

Optional Python task agent system (`python-agent/task_agent/`) for task decomposition and job execution:
- **Setup**: Set `ENABLE_A2A=true` and `A2A_AGENT_URL=http://localhost:9999`
- **Tools**: Uses `createTask` and `updateTask` tools for seamless integration
- **Features**: Decomposes projects into jobs, assigns agents, executes work, streams updates
- **Usage**: Select "Python Agent (A2A)" model in chatbot interface
- **Execution**: Job execution via `/api/agent/execution` endpoint
- **Run**: `cd python-agent && python -m task_agent`

### File Organization

- `app/`: Next.js App Router pages and API routes
- `components/`: React components including UI primitives and complex features
- `lib/`: Core utilities, database, AI configuration, and tools
- `artifacts/`: Artifact handlers for different content types
- `hooks/`: Custom React hooks
- `tests/`: Playwright test suites

### Authentication & Rate Limiting

Uses Auth.js with GitHub OAuth. Implements per-user message limits based on user type (guest vs authenticated). Chat visibility can be public or private.

### Development Considerations

- Database migrations are run automatically during build
- Uses Biome for linting and formatting instead of ESLint/Prettier
- Environment variables should be in `.env.local`
- Redis URL is optional for resumable streams
- Production deployments use OpenTelemetry instrumentation

### Common Patterns

**Tool Creation**: Tools receive `session` and `dataStream` parameters for user context and real-time streaming. Use `dataStream.write()` for incremental UI updates.

**Component Streaming**: Components handle `onStreamPart` callbacks to process incremental data updates from AI tools.

**Error Handling**: Custom `ChatSDKError` class for consistent API error responses with specific error codes.