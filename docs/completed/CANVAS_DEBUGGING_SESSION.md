# Canvas Component Debugging Session

## Issue Summary

After refactoring the Canvas component for better React/Next.js practices, the Canvas was not rendering tasks despite successful backend task creation and storage.

## Problem Diagnosis

### Symptoms

- Canvas shows "Canvas Initializing" indefinitely
- Tasks are created and stored in database correctly ✅
- Canvas document is created with proper `taskIds` ✅
- Canvas client component receives empty `content` prop ❌

### Investigation Process

#### 1. Component Refactor Analysis

**Status**: ✅ **COMPLETED**

- Simplified Canvas component from ~980 lines to ~446 lines
- Removed conflicting metadata vs useSWR data management
- Made useSWR the single source of truth for data fetching
- Fixed React hooks usage and TypeScript issues

#### 2. Backend Flow Verification

**Status**: ✅ **VERIFIED WORKING**

- A2A Tool creates tasks correctly
- Canvas document handler returns document ID: `"aaacd8e1-3554-4286-98df-55f5cb1bcb58"`
- Document Handler logs: `"📤 Returning content to AI SDK"`
- Tasks are stored in database with correct `taskIds` linkage

#### 3. Frontend Content Flow Debugging

**Status**: ❌ **ISSUE IDENTIFIED**

**Expected vs Actual:**

```typescript
// Expected in Canvas component
content: "aaacd8e1-3554-4286-98df-55f5cb1bcb58"; // Document ID

// Actual received
content: ""; // Empty string
contentType: "string";
contentLength: 0;
```

#### 4. AI SDK v5 Artifact Streaming Investigation

**Status**: ✅ **ROOT CAUSE FOUND**

**Problem**: AI SDK v5 doesn't automatically use tool return content for artifact content.

**Evidence**:

- Tool returns `{ content: canvasArtifactContent }` correctly
- But this content never reaches the Canvas artifact component
- AI SDK requires explicit streaming of artifact content

## Solution Applied

### Fix: Explicit Content Streaming

**File**: `lib/ai/tools/request-a2a-agent.ts`

**Change**:

```typescript
// Added before data-finish
dataStream.write({
  type: "data-content",
  data: canvasArtifactContent, // Document ID from Canvas handler
  transient: false, // Persist as artifact content
});
```

**Explanation**:
The AI SDK v5 requires explicit streaming of artifact content via `data-content` type. Simply returning content from the tool isn't sufficient.

### Expected Result

1. A2A tool creates Canvas document ✅
2. Canvas handler returns document ID ✅
3. A2A tool streams document ID as artifact content ✅ **NEW**
4. Canvas component receives document ID in `content` prop ✅ **SHOULD WORK**
5. Canvas fetches tasks via useSWR and renders ✅ **SHOULD WORK**

## Technical Lessons Learned

### 1. AI SDK v5 Artifact Content Flow

- Tool return values ≠ Artifact content
- Must explicitly stream content via `dataStream.write({ type: 'data-content' })`
- `transient: false` is crucial for persistent content

### 2. Debugging Complex React/AI SDK Integration

- Add comprehensive logging at each boundary (tool → AI SDK → artifact → component)
- Verify data at each stage of the pipeline
- Don't assume AI SDK behaviors - verify explicitly

### 3. useSWR Best Practices with AI SDK

- Dynamic keys prevent stale data: `canvas-document-${documentId}`
- Include dependency data in keys: `tasks-${docId}-${taskIds.join(',')}`
- Handle conditional fetching properly with null keys

## Files Modified

1. **`artifacts/canvas/client.tsx`** - Simplified and debugged Canvas component
2. **`lib/ai/tools/request-a2a-agent.ts`** - Added explicit content streaming
3. **`docs/CANVAS_COMPONENT_REFACTOR.md`** - Documented refactor and fix
4. **`docs/CANVAS_DEBUGGING_SESSION.md`** - This debugging log

## Testing Required

- [ ] Test Canvas task rendering after content streaming fix
- [ ] Verify useSWR data fetching works with proper document ID
- [ ] Confirm agent nodes render correctly
- [ ] Test task execution functionality
- [ ] Verify no regressions in other artifact types

## Success Criteria

✅ **Canvas receives document ID in content prop**  
✅ **Canvas fetches document and task data via useSWR**  
✅ **Task nodes render in CanvasFlow component**  
✅ **Agent nodes display properly**  
✅ **No console errors or TypeScript issues**

---

**Session Date**: January 2024  
**Duration**: ~2 hours  
**Result**: Root cause identified and fix applied  
**Status**: Ready for testing 🧪
