# Workflow Strategy

This document outlines the design strategy for workflows in the Sesamy FM API.

## Core Principles

### 1. Single File Management

- The workflow is managed in a single file that orchestrates all steps
- This central file sends the needed information to each step
- Data can be output from the previous step or fetched from any previous step as needed

### 2. Minimal Input/Output

- Each step should take the minimum input possible
- Each step should return as little as possible
- Focus on essential data transfer between steps

### 3. Raw Data Handling

- Raw data (such as audio files) should **never** be passed as properties
- All raw data must be persisted to R2 storage
- Pass signed URLs/links instead of raw data
- This ensures efficient memory usage and reliable data handling

### 4. Debug REST Endpoints

- All services (encoding, transcription, etc.) should be available as REST endpoints
- Routes should be defined in the respective workflow folder
- Debug endpoints should follow the pattern: `/wf-debug/audio-processing/{step-name}`
  - Example: `/wf-debug/audio-processing/transcribe`
- These endpoints enable easy debugging and manual testing
- Debug endpoints can be easily commented out before production deployment

### 5. Signed Link Outputs

- Each step should output signed links to any created files
- This enables easy manual invocation and debugging
- Provides transparency into what files are created at each step
- Facilitates troubleshooting and validation

### 6. Input/Output Validation

- All step inputs and outputs should be validated using Zod schemas
- This ensures data integrity and type safety throughout the workflow
- Validation helps catch errors early and provides clear error messages
- Schema definitions should be co-located with step implementations

## Implementation Guidelines

### Workflow Structure

```
src/workflows/{workflow-name}/
├── index.ts              # Main workflow orchestrator
├── routes.ts             # Debug REST endpoints
├── {step-name}.ts        # Individual workflow steps
└── types.ts              # Type definitions
```

### Step Interface Pattern

```typescript
import { z } from "zod";

// Define input/output schemas with Zod
const StepInputSchema = z.object({
  // Define your input structure
});

const StepOutputSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  signedUrls: z.array(z.string()).optional(),
  error: z.string().optional(),
});

interface WorkflowStep<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
  validateInput(input: unknown): TInput;
  validateOutput(output: unknown): TOutput;
}

// Example implementation
class ExampleStep implements WorkflowStep<StepInput, StepOutput> {
  validateInput(input: unknown): StepInput {
    return StepInputSchema.parse(input);
  }

  validateOutput(output: unknown): StepOutput {
    return StepOutputSchema.parse(output);
  }

  async execute(input: StepInput): Promise<StepOutput> {
    const validInput = this.validateInput(input);
    // Step logic here
    const result = { success: true, signedUrls: ["..."] };
    return this.validateOutput(result);
  }
}
```

### Debug Endpoint Pattern

```typescript
// In routes.ts
app.post("/wf-debug/{workflow-name}/{step-name}", async (c) => {
  // Individual step execution for debugging
});
```

## Benefits

1. **Modularity**: Each step is independent and testable
2. **Efficiency**: Minimal data transfer and memory usage
3. **Debuggability**: REST endpoints for manual testing
4. **Reliability**: Signed URLs ensure data persistence and access
5. **Maintainability**: Clear separation of concerns
6. **Scalability**: Steps can be optimized independently
7. **Type Safety**: Zod validation ensures data integrity and catches errors early

## Production Considerations

- Comment out or remove debug endpoints before production deployment
- Ensure signed URL expiration times are appropriate for workflow duration
- Monitor R2 storage usage and implement cleanup strategies
- Consider implementing step retry logic for robustness
