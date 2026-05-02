import { InputValidationError } from "./errors.js";
import type { ActionInputs } from "./inputs.js";
import type { ProbeResult, RuntimeClient } from "./runtime.js";

export interface ProbePlan {
  name: string;
  description: string;
  run: (runtime: RuntimeClient) => Promise<ProbeResult>;
}

export function buildProbePlans(inputs: ActionInputs): ProbePlan[] {
  const plans: ProbePlan[] = [];

  if (inputs.testSql) {
    const sql = inputs.testSql;
    plans.push({
      name: "sql",
      description: `SQL: ${truncate(sql, 80)}`,
      run: (rt) => rt.probeSql(sql),
    });
  }

  if (inputs.testNsql) {
    const nsql = inputs.testNsql;
    plans.push({
      name: "nsql",
      description: `NSQL: ${truncate(nsql, 80)}`,
      run: (rt) => rt.probeNsql(nsql, inputs.testChatModel),
    });
  }

  if (inputs.testChat) {
    const body = buildChatBody(inputs);
    plans.push({
      name: "chat",
      description: "Chat completion",
      run: (rt) => rt.probeChat(body),
    });
  }

  if (inputs.testSearch) {
    const body = parseJsonInput("test-search", inputs.testSearch);
    plans.push({
      name: "search",
      description: "Search query",
      run: (rt) => rt.probeSearch(body),
    });
  }

  if (inputs.testMcpTool) {
    const args = inputs.testMcpArguments
      ? parseJsonInput("test-mcp-arguments", inputs.testMcpArguments)
      : {};
    const body = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/call" as const,
      params: { name: inputs.testMcpTool, arguments: args },
    };
    plans.push({
      name: "mcp",
      description: `MCP tool: ${inputs.testMcpTool}`,
      run: (rt) => rt.probeMcp(body),
    });
  }

  return plans;
}

function buildChatBody(inputs: ActionInputs): unknown {
  const trimmed = (inputs.testChat ?? "").trim();
  if (trimmed.startsWith("{")) {
    return parseJsonInput("test-chat", trimmed);
  }
  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: trimmed }],
  };
  if (inputs.testChatModel) body.model = inputs.testChatModel;
  return body;
}

function parseJsonInput(name: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new InputValidationError(`Input "${name}" must be valid JSON: ${(err as Error).message}`);
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}
